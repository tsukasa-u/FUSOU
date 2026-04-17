/**
 * Member ID Hash Lookup Routes
 *
 * Provides member_id_hash lookup functionality for the desktop app authentication flow.
 * Allows checking if a member_id_hash already exists in the system and retrieving
 * associated user information.
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import { createEnvContext, resolveSupabaseConfig } from "@/server/utils";

const app = new Hono<{ Bindings: Bindings }>();

// Helper to return JSON responses with CORS headers
function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

/**
 * POST /member-lookup/check-hash
 *
 * Check if a member_id_hash already exists in the system.
 *
 * Request body:
 * {
 *   "member_id_hash": "hashed-member-id"
 * }
 *
 * Response:
 * {
 *   "exists": boolean,
 *   "user_id": string | null,  // Supabase user ID if exists
 *   "email": string | null,    // Email if exists
 *   "message": string          // User-friendly message
 * }
 *
 * NOTE: This endpoint checks `public.user_member_map` (canonical dataset owners) only.
 *       Anonymous-only mode: SNS links are no longer supported.
 */
app.post("/check-hash", async (c) => {
  try {
    const body = await c.req.json<{ member_id_hash: string }>();
    const { member_id_hash } = body;

    if (!member_id_hash) {
      return jsonResponse(
        {
          error: "MISSING_MEMBER_ID_HASH",
          message: "member_id_hash is required",
        },
        400,
      );
    }

    if (!/^[a-f0-9]{64}$/i.test(member_id_hash)) {
      return jsonResponse(
        {
          error: "INVALID_FORMAT",
          message: "member_id_hash must be a 64-character SHA-256 hex string",
        },
        400,
      );
    }

    // Get Supabase config from environment
    const envCtx = createEnvContext(c);
    const { url: supabaseUrl, serviceRoleKey: supabaseServiceKey } =
      resolveSupabaseConfig(envCtx);

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[check-hash] Supabase configuration missing");
      return jsonResponse(
        {
          error: "INTERNAL_ERROR",
          message: "Supabase configuration missing",
        },
        500,
      );
    }

    // Create Supabase client with service role key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Anonymous-only mode: check canonical owner only
    const { data: canonicalLink, error: canonicalLinkError } =
      await supabaseAdmin
        .from("user_member_map")
        .select("user_id")
        .eq("member_id_hash", member_id_hash)
        .maybeSingle();

    if (canonicalLinkError) {
      console.error(
        "[check-hash] user_member_map query failed:",
        canonicalLinkError,
      );
      return jsonResponse(
        {
          error: "LOOKUP_FAILED",
          message: "Failed to lookup member ID",
          details: canonicalLinkError.message,
        },
        500,
      );
    }

    if (!canonicalLink) {
      // Member ID not found - this is a new user
      return jsonResponse(
        {
          exists: false,
          message:
            "This member ID is not yet linked to any account. You can create a new account or link to an existing one.",
        },
        200,
      );
    }

    // Member ID found — deliberately omit user_id and email to prevent
    // unauthenticated enumeration of user accounts (game member IDs are a
    // small numeric space that can be brute-forced via SHA-256 preimages).
    return jsonResponse(
      {
        exists: true,
        message:
          "This member ID is already linked to an existing FUSOU account. Please log in to that account.",
      },
      200,
    );
  } catch (error) {
    console.error("Member lookup error:", error);
    return jsonResponse(
      {
        error: "INTERNAL_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      },
      500,
    );
  }
});

/**
 * POST /member-lookup/verify-ownership
 *
 * DEPRECATED: Social authentication is no longer supported.
 * This endpoint is disabled to maintain anonymous-only architecture.
 */
app.post("/verify-ownership", async (c) => {
  return jsonResponse(
    {
      error: "FEATURE_DISABLED",
      message:
        "Social authentication is no longer supported. Please use anonymous sign-in.",
    },
    410,
  ); // 410 Gone
});

export default app;
