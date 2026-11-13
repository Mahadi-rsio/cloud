import { ZodError } from "zod";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL";

export class HttpError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonOk<T>(data: T, status = 200, headers?: HeadersInit) {
  return Response.json({ success: true, data }, { status, headers });
}

export function jsonError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
  headers?: HeadersInit,
) {
  return Response.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status, headers },
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError("VALIDATION_ERROR", "Request body must be valid JSON.", 400);
  }
}

export function errorResponse(error: unknown, headers?: HeadersInit) {
  if (error instanceof HttpError) {
    return jsonError(error.code, error.message, error.status, error.details, headers);
  }
  if (error instanceof ZodError) {
    return jsonError(
      "VALIDATION_ERROR",
      error.issues[0]?.message ?? "Invalid request.",
      400,
      error.issues,
      headers,
    );
  }
  console.error("[api] unhandled error", error);
  return jsonError("INTERNAL", "Something went wrong. Please try again.", 500, undefined, headers);
}
