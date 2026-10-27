import { and, desc, eq, lt, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import {
  checkGitHubRepository,
  parseGitHubUrl,
  resolveGitHubHeadSha,
} from "@/lib/build/github";
import { enqueueDeployJob } from "@/lib/build/process-job";
import { getDb } from "@/lib/db";
import { deployments } from "@/lib/db/product-schema";
import { getEnv } from "@/lib/env";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";
import { createDeploymentSchema } from "@/lib/validators/deployment";

export async function POST(request: NextRequest) {
  try {
    await assertRateLimit(`rl:deployments:create:${clientIp(request)}`, {
      limit: 10,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const input = createDeploymentSchema.parse(await readJson(request));

    const repository = parseGitHubUrl(input.url);
    if (!repository) {
      throw new HttpError(
        "VALIDATION_ERROR",
        "Enter a valid GitHub repository URL, e.g. https://github.com/username/repository",
        400,
      );
    }

    const env = await getEnv();
    const status = await checkGitHubRepository(repository, env.GITHUB_API_TOKEN);
    if (!status.ok) {
      const code =
        status.reason === "rate-limited"
          ? "RATE_LIMITED"
          : status.reason === "error"
            ? "PROVIDER_ERROR"
            : "VALIDATION_ERROR";
      throw new HttpError(code, status.message, status.reason === "rate-limited" ? 429 : 400);
    }

    const branch = input.branch ?? status.defaultBranch;
    const commitSha = await resolveGitHubHeadSha(
      repository,
      branch,
      env.GITHUB_API_TOKEN,
    );

    const db = await getDb();
    const [deployment] = await db
      .insert(deployments)
      .values({
        userId: user.id,
        repoUrl: repository.url,
        repoOwner: repository.owner,
        repoName: repository.repo,
        branch,
        commitSha,
        status: "queued",
        buildNumber: 1,
      })
      .returning();

    await enqueueDeployJob({ type: "deploy-build", deploymentId: deployment.id });

    return jsonOk({ deployment: deployment }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX = 100;

type Cursor = { at: Date; id: string };

function encodeCursor(deployment: { createdAt: Date; id: string }) {
  return btoa(`${deployment.createdAt.toISOString()}|${deployment.id}`);
}

function parseCursor(raw: string): Cursor {
  const [iso, id] = atob(raw).split("|", 2);
  const at = new Date(iso);
  const parsedId = z.uuid().parse(id);
  if (Number.isNaN(at.getTime())) {
    throw new HttpError("VALIDATION_ERROR", "Invalid cursor.", 400);
  }
  return { at, id: parsedId };
}

export async function GET(request: NextRequest) {
  try {
    await assertRateLimit(`rl:deployments:list:${clientIp(request)}`, {
      limit: 120,
      windowSeconds: 60,
    });
    const user = await requireUser();

    const url = new URL(request.url);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(LIST_LIMIT_MAX)
      .default(LIST_LIMIT_DEFAULT)
      .parse(url.searchParams.get("limit") ?? undefined);
    const cursorRaw = url.searchParams.get("cursor");
    const cursor = cursorRaw ? parseCursor(cursorRaw) : undefined;

    const db = await getDb();
    const rows = await db
      .select()
      .from(deployments)
      .where(
        cursor
          ? and(
              eq(deployments.userId, user.id),
              or(
                lt(deployments.createdAt, cursor.at),
                and(
                  eq(deployments.createdAt, cursor.at),
                  lt(deployments.id, cursor.id),
                ),
              ),
            )
          : eq(deployments.userId, user.id),
      )
      .orderBy(desc(deployments.createdAt), desc(deployments.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last) : null;

    return jsonOk({ items: items, nextCursor });
  } catch (error) {
    return errorResponse(error);
  }
}