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
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS })
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
    typeof body?.client_version === "string" ? body.client_version.trim() : null;

  // Get Supabase config (service role key)
  const envCtx = createEnvContext(c);
  const { url, serviceRoleKey } = resolveSupabaseConfig(envCtx);

  if (!url || !serviceRoleKey) {
    console.error("Supabase configuration missing");
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  // Create service role client to call RPC securely
  const supabaseAdmin = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    // Forward the user's JWT so PostgREST uses it for auth.uid()
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  try {
    // Call the RPC function with the authenticated user's JWT
    // The RPC will use auth.uid() from the JWT to ensure user_id matches
    const { data, error } = await supabaseAdmin.rpc(
      "rpc_upsert_user_member_map",
      {
        member_id_hash: memberIdHash,
        client_version: clientVersion,
      }
    );

    if (error) {
      console.error("RPC rpc_upsert_user_member_map failed:", error);
      
      // Check for specific errors
      if (error.message?.includes("already mapped to another user")) {
        return c.json(
          {
            error: "member_id_already_mapped",
            message: "This game account is already linked to another FUSOU account",
            resolution_options: {
              switch_account: "Switch to the original account",
              transfer_ownership: "Transfer ownership (Generate code in old account → Enter in new account)",
              contact_support: "Contact support if you cannot access the old account"
            },
            member_id_hash: memberIdHash
          },
          409
        );
      }
      
      if (error.message?.includes("not authenticated")) {
        return c.json({ error: "Authentication required" }, 401);
      }

      return c.json({ error: error.message || "Failed to upsert mapping" }, 400);
    }

    return c.json({
      ok: true,
      map: data,
      message: "Member ID mapping updated successfully",
    });
  } catch (err) {
    console.error("Unexpected error in member-map upsert:", err);
    return c.json({ error: "Internal server error" }, 500);
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
  const supabaseAdmin = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  try {
    const { data, error } = await supabaseAdmin.rpc(
      "rpc_get_current_user_member_map",
      {}
    );

    if (error) {
      console.error("RPC rpc_get_current_user_member_map failed:", error);
      return c.json({ error: error.message || "Failed to retrieve mapping" }, 400);
    }

    return c.json({
      ok: true,
      map: data,
    });
  } catch (err) {
    console.error("Unexpected error in member-map get:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default app;
