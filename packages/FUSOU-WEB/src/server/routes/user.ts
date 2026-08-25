import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import {
  extractBearer,
  validateJWT,
  createEnvContext,
  resolvePublicIdsForUser,
  resolveSupabaseConfig,
} from "../utils";

const app = new Hono<{ Bindings: Bindings }>();

function maskPublicId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length <= 10) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

// OPTIONS（CORS）
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

/**
 * GET /user/member-map
 *
 * Retrieves the current user's pseudonymous game-identifier associations.
 *
 * Responses:
 * - 200: Returns association data (or null if not linked)
 * - 401: Authentication failed
 * - 500: Server error
 */
app.get("/member-map", async (c) => {
  const authHeader = c.req.header("Authorization");
  const cookieHeader = c.req.header("Cookie");
  const cookieMatch = cookieHeader?.match(
    /(?:^|;\s*)(?:sb-access-token|__Secure-sb-access-token)=([^;]+)/,
  );
  const cookieValue = cookieMatch?.[1];
  const cookieToken = cookieValue !== undefined
    ? (() => {
        try {
          return decodeURIComponent(cookieValue);
        } catch {
          return cookieValue;
        }
      })()
    : null;
  const accessToken = extractBearer(authHeader) ?? cookieToken;

  if (!accessToken) {
    return c.json({ error: "Missing Authorization bearer token" }, 401);
  }

  const supabaseUser = await validateJWT(accessToken);
  if (!supabaseUser) {
    return c.json({ error: "Invalid or expired JWT token" }, 401);
  }

  const envCtx = createEnvContext(c);
  const { url, serviceRoleKey } = resolveSupabaseConfig(envCtx);
  if (!url || !serviceRoleKey) {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  try {
    const resolved = await resolvePublicIdsForUser({
      supabaseAdmin: createClient(url, serviceRoleKey),
      ...(supabaseUser.id === undefined ? {} : { userId: supabaseUser.id }),
    });
    const maps = resolved.publicIds.map((publicId) => ({
      linked: true,
      public_id_masked: maskPublicId(publicId),
      source: resolved.source,
    }));
    return c.json({
      ok: true,
      linked: maps.length > 0,
      count: maps.length,
      map: maps[0] ?? null,
      maps,
    });
  } catch (error) {
    console.error("[/user/member-map] association lookup failed:", error);
    return c.json({ error: "INTERNAL_ERROR" }, 500);
  }
});

export default app;
