import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import {
  extractBearer,
  validateJWT,
  createEnvContext,
  resolveLinkedMemberIdHashForUser,
  resolveSupabaseConfig,
} from "../utils";

const app = new Hono<{ Bindings: Bindings }>();

function maskMemberIdHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length <= 10) {
    return normalized;
  }
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
 * Retrieves the current user's member_id mapping.
 *
 * Responses:
 * - 200: Returns mapping data (or null if not found)
 * - 401: Authentication failed
 * - 500: Server error
 */
app.get("/member-map", async (c) => {
  const authHeader = c.req.header("Authorization");
  const cookieHeader = c.req.header("Cookie");
  const cookieMatch = cookieHeader?.match(
    /(?:^|;\s*)(?:sb-access-token|__Secure-sb-access-token)=([^;]+)/,
  );
  const cookieToken = cookieMatch
    ? (() => {
        try {
          return decodeURIComponent(cookieMatch[1]);
        } catch {
          return cookieMatch[1];
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

  // Get Supabase config
  const envCtx = createEnvContext(c);
  const { url, serviceRoleKey } = resolveSupabaseConfig(envCtx);

  if (!url || !serviceRoleKey) {
    console.error("Supabase configuration missing");
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  // Create service role client
  const supabaseAdmin = createClient(url, serviceRoleKey);

  try {
    const currentUserId = supabaseUser.id;
    const resolved = await resolveLinkedMemberIdHashForUser({
      supabaseAdmin,
      userId: currentUserId,
      jwtPayload: supabaseUser.payload,
    });
    const memberIdHash = resolved.memberIdHash;
    const linked = Boolean(memberIdHash);

    return c.json({
      ok: true,
      linked,
      map: memberIdHash
        ? {
            linked: true,
            member_id_hash_masked: maskMemberIdHash(memberIdHash),
            source: resolved.source,
          }
        : null,
    });
  } catch (err) {
    console.error("[/user/member-map] Unexpected error:", err);
    return c.json(
      {
        error: "INTERNAL_ERROR",
        message:
          err instanceof Error ? err.message : "An unexpected error occurred",
      },
      500,
    );
  }
});

export default app;
