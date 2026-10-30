import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/authz";
import { parseGitHubUrl, checkGitHubRepository, resolveGitHubHeadSha } from "@/lib/build/github";
import { callBuilderDiscover, ensureBuilderAwake } from "@/lib/build/builder-client";
import { getEnv } from "@/lib/env";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";
import { z } from "zod";

const discoverRequestSchema = z
  .object({
    url: z.string().trim().min(1).max(2048),
    branch: z
      .string()
      .trim()
      .min(1)
      .max(250)
      .regex(/^[A-Za-z0-9._\-\/]+$/)
      .optional(),
  })
  .strict();

/**
 * POST /api/v1/deployments/discover
 *
 * Analyze a GitHub repository without creating a deployment.
 * Wakes the builder, clones the repo, runs discovery, returns application candidates.
 */
export async function POST(request: NextRequest) {
  try {
    await assertRateLimit(`rl:deployments:discover:${clientIp(request)}`, {
      limit: 10,
      windowSeconds: 60,
    });
    await requireUser();

    const input = discoverRequestSchema.parse(await readJson(request));

    const repository = parseGitHubUrl(input.url);
    if (!repository) {
      throw new HttpError(
        "VALIDATION_ERROR",
        "Enter a valid GitHub repository URL, e.g. https://github.com/username/repository",
        400,
      );
    }

    const env = await getEnv();
    const repoStatus = await checkGitHubRepository(repository, env.GITHUB_API_TOKEN);
    if (!repoStatus.ok) {
      const code =
        repoStatus.reason === "rate-limited"
          ? "RATE_LIMITED"
          : repoStatus.reason === "error"
            ? "PROVIDER_ERROR"
            : "VALIDATION_ERROR";
      throw new HttpError(
        code,
        repoStatus.message,
        repoStatus.reason === "rate-limited" ? 429 : 400,
      );
    }

    const branch = input.branch ?? repoStatus.defaultBranch;

    // Resolve the head SHA now so discovery and any subsequent build use the same commit
    const commitSha = await resolveGitHubHeadSha(repository, branch, env.GITHUB_API_TOKEN);

    // Wake the builder before calling it
    await ensureBuilderAwake();

    const result = await callBuilderDiscover({
      repositoryUrl: repository.url,
      branch,
      ...(commitSha ? { commitSha } : {}),
    });

    return jsonOk({ discovery: result, commitSha });
  } catch (error) {
    return errorResponse(error);
  }
}
