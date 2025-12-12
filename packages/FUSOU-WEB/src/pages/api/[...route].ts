// Thin adapter forwarding Astro API routes to the composed Hono app.
import app from "@/server/app";
import type { Bindings } from "@/server/types";

export const prerender = false;

function injectEnv(locals: any): Bindings {
  return {
    ASSET_SYNC_BUCKET: locals?.runtime?.env?.ASSET_SYNC_BUCKET,
    ASSET_INDEX_DB: locals?.runtime?.env?.ASSET_INDEX_DB,
    ASSET_PAYLOAD_BUCKET: locals?.runtime?.env?.ASSET_PAYLOAD_BUCKET,
    PUBLIC_SUPABASE_URL: import.meta.env.PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: import.meta.env.SUPABASE_SECRET_KEY,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: import.meta.env
      .PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ASSET_SYNC_ALLOWED_EXTENSIONS: import.meta.env
      .ASSET_SYNC_ALLOWED_EXTENSIONS,
    ASSET_UPLOAD_SIGNING_SECRET: import.meta.env.ASSET_UPLOAD_SIGNING_SECRET,
    FLEET_SNAPSHOT_SIGNING_SECRET: import.meta.env
      .FLEET_SNAPSHOT_SIGNING_SECRET,
    MAX_SNAPSHOT_BYTES: import.meta.env.MAX_SNAPSHOT_BYTES,
    ADMIN_API_SECRET: import.meta.env.ADMIN_API_SECRET,
  };
}

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
