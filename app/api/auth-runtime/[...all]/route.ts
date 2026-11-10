import type { NextRequest } from "next/server";
import { getAuthForProject } from "@/lib/auth-projects/runtime";
import { HttpError } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const BASE_PATH = "/api/auth-runtime";

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-publishable-key, x-api-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

function errorJson(message: string, status: number, headers: Record<string, string>) {
  return new Response(
    JSON.stringify({ success: false, error: { code: "NOT_FOUND", message } }),
    {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    },
  );
}

async function handler(request: NextRequest) {
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(request.url);
  const publishableKey =
    request.headers.get("x-publishable-key") ??
    url.searchParams.get("publishable-key");

  if (!publishableKey) {
    return errorJson("Missing x-publishable-key header.", 400, cors);
  }

  try {
    await assertRateLimit(`rl:auth-runtime:${publishableKey}:${clientIp(request)}`, {
      limit: 120,
      windowSeconds: 60,
    });

    const auth = await getAuthForProject(
      publishableKey,
      `${url.origin}${BASE_PATH}`,
    );
    const response = await auth.handler(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: error.code, message: error.message },
        }),
        {
          status: error.status,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    console.error("[auth-runtime] request failed", error);
    return errorJson("Auth project not found or unavailable.", 404, cors);
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
