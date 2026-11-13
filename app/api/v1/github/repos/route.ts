import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { account } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";

const GITHUB_USER_AGENT = "vinext-cloud";

export interface GitHubRepoItem {
  id: number;
  name: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  isPrivate: boolean;
  description: string | null;
  updatedAt: string | null;
  starsCount?: number;
  language?: string | null;
}

function parseGhRepo(raw: any): GitHubRepoItem {
  return {
    id: raw.id,
    name: raw.name,
    fullName: raw.full_name,
    url: raw.html_url,
    defaultBranch: raw.default_branch || "main",
    isPrivate: Boolean(raw.private),
    description: raw.description ?? null,
    updatedAt: raw.updated_at ?? null,
    starsCount: raw.stargazers_count ?? 0,
    language: raw.language ?? null,
  };
}

export async function GET(request: NextRequest) {
  try {
    await assertRateLimit(`rl:github:repos:get:${clientIp(request)}`, {
      limit: 60,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const db = await getDb();

    const [ghAccount] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, user.id), eq(account.providerId, "github")))
      .limit(1);

    if (!ghAccount) {
      return jsonOk({
        connected: false,
        username: null,
        repos: [],
      });
    }

    let repos: GitHubRepoItem[] = [];
    const token = ghAccount.accessToken;

    if (token) {
      try {
        const ghRes = await fetch("https://api.github.com/user/repos?sort=updated&per_page=30", {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "User-Agent": GITHUB_USER_AGENT,
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (ghRes.ok) {
          const list = (await ghRes.json()) as any[];
          repos = list.map(parseGhRepo);
        }
      } catch (err) {
        console.warn("[github] failed to fetch repos with token:", err);
      }
    } else if (ghAccount.accountId) {
      // Fallback: fetch public repos by username
      try {
        const ghRes = await fetch(
          `https://api.github.com/users/${encodeURIComponent(ghAccount.accountId)}/repos?sort=updated&per_page=30`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": GITHUB_USER_AGENT,
            },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (ghRes.ok) {
          const list = (await ghRes.json()) as any[];
          repos = list.map(parseGhRepo);
        }
      } catch (err) {
        console.warn("[github] failed to fetch public repos for user:", err);
      }
    }

    return jsonOk({
      connected: true,
      username: ghAccount.accountId,
      repos,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

const connectSchema = z
  .object({
    token: z.string().trim().optional(),
    username: z.string().trim().optional(),
  })
  .refine((data) => data.token || data.username, {
    message: "Either token or username is required to connect GitHub.",
  });

export async function POST(request: NextRequest) {
  try {
    await assertRateLimit(`rl:github:repos:connect:${clientIp(request)}`, {
      limit: 20,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const input = connectSchema.parse(await readJson(request));
    const db = await getDb();

    let resolvedUsername = input.username?.trim();
    let token = input.token?.trim() || null;
    let repos: GitHubRepoItem[] = [];

    if (token) {
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": GITHUB_USER_AGENT,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!userRes.ok) {
        throw new HttpError("VALIDATION_ERROR", "Invalid GitHub Personal Access Token.", 400);
      }

      const userData = (await userRes.json()) as { login: string };
      resolvedUsername = userData.login;

      const reposRes = await fetch("https://api.github.com/user/repos?sort=updated&per_page=30", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": GITHUB_USER_AGENT,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (reposRes.ok) {
        const list = (await reposRes.json()) as any[];
        repos = list.map(parseGhRepo);
      }
    } else if (resolvedUsername) {
      const reposRes = await fetch(
        `https://api.github.com/users/${encodeURIComponent(resolvedUsername)}/repos?sort=updated&per_page=30`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": GITHUB_USER_AGENT,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!reposRes.ok) {
        throw new HttpError(
          "VALIDATION_ERROR",
          `Could not find GitHub user or repositories for "${resolvedUsername}".`,
          400,
        );
      }

      const list = (await reposRes.json()) as any[];
      repos = list.map(parseGhRepo);
    }

    if (!resolvedUsername) {
      throw new HttpError("VALIDATION_ERROR", "GitHub username could not be determined.", 400);
    }

    // Upsert into account table
    const existing = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, user.id), eq(account.providerId, "github")))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(account)
        .set({
          accountId: resolvedUsername,
          accessToken: token,
          updatedAt: new Date(),
        })
        .where(eq(account.id, existing[0].id));
    } else {
      await db.insert(account).values({
        id: crypto.randomUUID(),
        userId: user.id,
        providerId: "github",
        accountId: resolvedUsername,
        accessToken: token,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return jsonOk({
      connected: true,
      username: resolvedUsername,
      repos,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser();
    const db = await getDb();

    await db
      .delete(account)
      .where(and(eq(account.userId, user.id), eq(account.providerId, "github")));

    return jsonOk({ connected: false });
  } catch (error) {
    return errorResponse(error);
  }
}
