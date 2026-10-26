import { isAxiosError } from "axios";
import { ZodError } from "zod";

export function extractErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Please check your input.";
  }
  if (isAxiosError(error)) {
    const body = error.response?.data;
    if (body && typeof body === "object") {
      const apiError = (body as { error?: { message?: unknown } }).error;
      if (
        apiError &&
        typeof apiError === "object" &&
        typeof apiError.message === "string"
      ) {
        return apiError.message;
      }
    }
    const message = error.response?.data?.message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && typeof message[0]?.message === "string") {
      return message[0].message;
    }
    return "Something went wrong. Please try again.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}