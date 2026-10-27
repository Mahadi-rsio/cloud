import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/authz";
import { checkGitHubRepository, parseGitHubUrl } from "@/lib/build/github";
import { getEnv } from "@/lib/env";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";
import { validateDeploymentSchema } from "@/lib/validators/deployment";

/**
 * Check a GitHub repository URL without creating a deployment. Always answers
 * 200 for a well-formed URL so the UI can render inline feedback.
 */
export async function POST(request: NextRequest) {
  try {
    await assertRateLimit(`rl:deployments:validate:${clientIp(request)}`, {
      limit: 30,
      windowSeconds: 60,
    });
    await requireUser();
    const input = validateDeploymentSchema.parse(await readJson(request));

    const repository = parseGitHubUrl(input.url);
    if (!repository) {
      throw new HttpError("VALIDATION_ERROR", "Enter a valid GitHub repository URL.", 400);
    }

    const env = await getEnv();
    const status = await checkGitHubRepository(repository, env.GITHUB_API_TOKEN);

    if (!status.ok) {
      return jsonOk({
        valid: false,
        reason: status.reason,
        message: status.message,
      });
    }

    return jsonOk({
      valid: true,
      repository: {
        owner: repository.owner,
        name: repository.repo,
        url: repository.url,
        defaultBranch: status.defaultBranch,
        fork: status.fork,
        pushedAt: status.pushedAt,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}