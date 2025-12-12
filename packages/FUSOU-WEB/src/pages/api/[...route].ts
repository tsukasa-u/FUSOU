// Thin adapter forwarding Astro API routes to the composed Hono app.
import app from "@/server/app";
import { injectEnv } from "@/server/utils";

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

export const GET = async ({ request, locals }: any) =>
  app.fetch(stripApiPrefix(request), injectEnv(locals));
export const POST = async ({ request, locals }: any) =>
  app.fetch(stripApiPrefix(request), injectEnv(locals));
export const PUT = async ({ request, locals }: any) =>
  app.fetch(stripApiPrefix(request), injectEnv(locals));
export const DELETE = async ({ request, locals }: any) =>
  app.fetch(stripApiPrefix(request), injectEnv(locals));
export const PATCH = async ({ request, locals }: any) =>
  app.fetch(stripApiPrefix(request), injectEnv(locals));
