import app from "@/server/app";
import { env as cfEnv } from "cloudflare:workers";
import type { APIContext } from "astro";

export const prerender = false;

function stripApiPrefix(req: Request): Request {
  try {
    const url = new URL(req.url);
    // Pages under `src/pages/api` are served at `/api/...`.
    // Hono app routes are defined without the `/api` prefix, so strip it.
    if (url.pathname.startsWith("/api/")) {
      url.pathname = url.pathname.replace(/^\/api\//, "/");
    } else if (url.pathname === "/api") {
      url.pathname = "/";
    }
    return new Request(url.toString(), req);
  } catch {
    return req;
  }
}

type ApiRequestContext = Pick<APIContext, "request">;

const handleRequest = async ({ request }: ApiRequestContext) =>
  app.fetch(stripApiPrefix(request), cfEnv);

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const DELETE = handleRequest;
export const PATCH = handleRequest;
export const OPTIONS = handleRequest;
