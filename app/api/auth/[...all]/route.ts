import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

const handler = toNextJsHandler((request) => getAuth().then((auth) => auth.handler(request)));

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
export const PATCH = handler.PATCH;
export const DELETE = handler.DELETE;