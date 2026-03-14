import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import {
  extractBearer,
  validateJWT,
  createEnvContext,
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
 * Upserts the mapping between the authenticated user and their member_id_hash.
 * This endpoint uses a service role client to safely call the RPC function
 * without exposing the service role key to clients.
 *
 * Request body:
 * {
 *   "member_id_hash": "abc123...", // Required: SHA-256 hash of salted member_id
 *   "client_version": "0.3.4"      // Optional: Client application version
 * }
 *
 * Responses:
 * - 200: Successfully upserted mapping
 * - 400: Missing or invalid member_id_hash
 * - 401: Authentication failed
 * - 500: Server error or database error
 */
app.post("/member-map/upsert", async (c) => {
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

  // Parse request body
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const memberIdHash =
    typeof body?.member_id_hash === "string" ? body.member_id_hash.trim() : "";

  if (!memberIdHash) {
    return c.json({ error: "member_id_hash is required" }, 400);
  }

  const clientVersion =
    typeof body?.client_version === "string"
      ? body.client_version.trim()
      : null;

  // Get Supabase config (service role key)
  const envCtx = createEnvContext(c);
  const { url, serviceRoleKey } = resolveSupabaseConfig(envCtx);

  if (!url || !serviceRoleKey) {
    console.error("Supabase configuration missing");
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  // Create service role client to call RPC securely
  const supabaseAdmin = createClient(url, serviceRoleKey);

  try {
    // Get the authenticated user's ID from the JWT token
    const currentUserId = supabaseUser.id!;

    // Check if this member_id_hash already exists
    const { data: existingMapping, error: lookupError } = await supabaseAdmin
      .from("user_member_map")
      .select("user_id")
      .eq("member_id_hash", memberIdHash)
      .maybeSingle();

    if (lookupError) {
      console.error(
        "[/user/member-map/upsert] Database lookup error:",
        lookupError,
      );
      return c.json(
        {
          error: "DATABASE_ERROR",
          message: "Failed to check existing mapping",
          details: lookupError.message,
        },
        500,
      );
    }

    if (existingMapping) {
      const existingUserId = existingMapping.user_id;

      // Case 1: Already owned by the same user
      if (existingUserId === currentUserId) {
        console.log(
          "[/user/member-map/upsert] Mapping already exists for current user:",
          {
            user_id: currentUserId,
            member_id_hash: memberIdHash,
            client_version: clientVersion,
          },
        );
        return c.json(
          {
            ok: true,
            action: "already_owned",
            message: "This member ID is already linked to your account.",
          },
          200,
        );
      }

      // Case 2: Owned by a different user - check if it's an anonymous user
      let existingUser;
      try {
        const { data: existingUserData, error: userError } =
          await supabaseAdmin.auth.admin.getUserById(existingUserId);

        if (userError) {
          console.error(
            "[/user/member-map/upsert] Failed to fetch existing user:",
            {
              user_id: existingUserId,
              error: userError.message,
              code: userError.code,
            },
          );
          return c.json(
            {
              error: "USER_FETCH_FAILED",
              message: "Failed to verify existing member ID ownership",
              details: userError.message,
            },
            500,
          );
        }

        if (!existingUserData?.user) {
          // User was deleted - allow remapping to prevent stranded mappings
          console.warn(
            "[/user/member-map/upsert] Existing user not found (deleted?):",
            {
              user_id: existingUserId,
              member_id_hash: memberIdHash,
            },
          );

          const { error: updateError } = await supabaseAdmin
            .from("user_member_map")
            .update({ user_id: currentUserId })
            .eq("member_id_hash", memberIdHash);

          if (updateError) {
            console.error(
              "[/user/member-map/upsert] Failed to remap from deleted user:",
              updateError,
            );
            return c.json(
              {
                error: "UPDATE_FAILED",
                message: "Failed to update member ID mapping",
                details: updateError.message,
              },
              500,
            );
          }

          console.log(
            "[/user/member-map/upsert] Remapped member_id_hash from deleted user:",
            {
              from_user_id: existingUserId,
              to_user_id: currentUserId,
              member_id_hash: memberIdHash,
            },
          );

          return c.json(
            {
              ok: true,
              action: "remapped_from_deleted",
              message:
                "Successfully remapped member ID from deleted account to your account.",
            },
            200,
          );
        }

        existingUser = existingUserData.user;
      } catch (e) {
        console.error(
          "[/user/member-map/upsert] Unexpected error fetching user:",
          e,
        );
        return c.json(
          {
            error: "USER_FETCH_ERROR",
            message: "Failed to verify existing member ID ownership",
            details: e instanceof Error ? e.message : "Unknown error",
          },
          500,
        );
      }

      const isAnonymousUser =
        existingUser && !existingUser.email && existingUser.is_anonymous;

      if (isAnonymousUser) {
        // Allow overwrite from anonymous to social user
        console.log(
          "[/user/member-map/upsert] Migrating from anonymous to social user:",
          {
            from_user_id: existingUserId,
            to_user_id: currentUserId,
            to_user_email: supabaseUser.email || "unknown",
            member_id_hash: memberIdHash,
          },
        );

        const { error: updateError } = await supabaseAdmin
          .from("user_member_map")
          .update({ user_id: currentUserId })
          .eq("member_id_hash", memberIdHash);

        if (updateError) {
          console.error(
            "[/user/member-map/upsert] Failed to migrate mapping:",
            updateError,
          );
          return c.json(
            {
              error: "UPDATE_FAILED",
              message: "Failed to migrate member ID to your account",
              details: updateError.message,
            },
            500,
          );
        }

        return c.json(
          {
            ok: true,
            action: "updated",
            message:
              "Successfully migrated member ID from anonymous to your social account.",
          },
          200,
        );
      }

      // Case 3: Owned by a different SOCIAL user
      const existingEmail = existingUser?.email || "unknown";

      // Resolve current user's email: JWT payload may lack `email` (e.g., anonymous token)
      // Fall back to Admin API lookup when JWT email is missing
      let currentEmail = supabaseUser.email || "";
      if (!currentEmail) {
        try {
          const { data: currentUserData } =
            await supabaseAdmin.auth.admin.getUserById(currentUserId);
          currentEmail = currentUserData?.user?.email || "";
        } catch (e) {
          console.warn(
            "[/user/member-map/upsert] Failed to fetch current user email from Admin API:",
            e,
          );
        }
      }

      // Case 3a: Same email → duplicate Supabase accounts (e.g., re-signup via OAuth)
      // Allow remapping since verified email proves same person
      if (currentEmail && existingEmail === currentEmail) {
        console.log(
          "[/user/member-map/upsert] Same email, different user_id - remapping:",
          {
            from_user_id: existingUserId,
            to_user_id: currentUserId,
            email: currentEmail,
            member_id_hash: memberIdHash,
          },
        );

        const { error: updateError } = await supabaseAdmin
          .from("user_member_map")
          .update({ user_id: currentUserId })
          .eq("member_id_hash", memberIdHash);

        if (updateError) {
          console.error(
            "[/user/member-map/upsert] Failed to remap same-email user:",
            updateError,
          );
          return c.json(
            {
              error: "UPDATE_FAILED",
              message: "Failed to update member ID mapping",
              details: updateError.message,
            },
            500,
          );
        }

        return c.json(
          {
            ok: true,
            action: "remapped_same_email",
            message:
              "Successfully remapped member ID to your current account (same email detected).",
          },
          200,
        );
      }

      // Case 3b: Different email → genuine conflict
      console.warn(
        "[/user/member-map/upsert] CONFLICT: member_id_hash already owned by different social user:",
        {
          member_id_hash: memberIdHash,
          current_user: currentUserId,
          current_email: currentEmail || "unknown",
          existing_user: existingUserId,
          existing_email: existingEmail,
        },
      );

      return c.json(
        {
          error: "member_id_already_mapped",
          message:
            "This game account is already linked to another FUSOU account",
          resolution_options: {
            switch_account: "Switch to the original account",
            transfer_ownership:
              "Transfer ownership (Generate code in old account → Enter in new account)",
            contact_support:
              "Contact support if you cannot access the old account",
          },
          member_id_hash: memberIdHash,
          existing_email: existingEmail,
        },
        409,
      );
    }

    // No existing mapping - create new one
    const { error: insertError } = await supabaseAdmin
      .from("user_member_map")
      .insert({
        user_id: currentUserId,
        member_id_hash: memberIdHash,
      });

    if (insertError) {
      console.error(
        "[/user/member-map/upsert] Failed to create mapping:",
        insertError,
      );
      return c.json(
        {
          error: "INSERT_FAILED",
          message: "Failed to create member ID mapping",
          details: insertError.message,
        },
        500,
      );
    }

    console.log("[/user/member-map/upsert] New mapping created:", {
      user_id: currentUserId,
      user_email: supabaseUser.email || "unknown",
      member_id_hash: memberIdHash,
      client_version: clientVersion,
    });

    return c.json(
      {
        ok: true,
        action: "created",
        message: "Successfully linked member ID to your account.",
      },
      200,
    );
  } catch (err) {
    console.error("[/user/member-map/upsert] Unexpected error:", err);
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
    // Get the authenticated user's ID from the JWT token
    const currentUserId = supabaseUser.id;

    // Retrieve the current user's member_id mapping
    const { data: mapping, error } = await supabaseAdmin
      .from("user_member_map")
      .select("member_id_hash, user_id, created_at")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (error) {
      console.error("[/user/member-map] Database query error:", error);
      return c.json(
        {
          error: "DATABASE_ERROR",
          message: "Failed to retrieve member ID mapping",
          details: error.message,
        },
        500,
      );
    }

    return c.json({
      ok: true,
      map: mapping || null,
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
