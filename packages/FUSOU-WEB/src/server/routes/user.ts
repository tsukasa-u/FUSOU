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

// OPTIONS（CORS）
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

/**
 * POST /user/member-map/upsert
 *
 * DEPRECATED: Social authentication is no longer supported.
 * This endpoint is disabled to maintain anonymous-only architecture.
 *
 * All users are authenticated via anonymous sessions.
 * Member ID linkage is maintained only in user_member_map (canonical owner).
 */
app.post("/member-map/upsert", async (c) => {
  return c.json(
    {
      error: "FEATURE_DISABLED",
      message:
        "Social authentication is no longer supported. Please use anonymous sign-in.",
    },
    410, // 410 Gone
  );
});

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
  // Extract and validate JWT
  const authHeader = c.req.header("Authorization");
  const accessToken = extractBearer(authHeader);

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

    return c.json({
      ok: true,
      map: resolved.memberIdHash
        ? {
            member_id_hash: resolved.memberIdHash,
            user_id: currentUserId,
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
