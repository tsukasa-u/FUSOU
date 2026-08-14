/**
 * API Keys Management Routes
 *
 * Provides endpoints for managing user API keys for fusou-datasets.
 */

import { Hono } from "hono";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import { createEnvContext, getEnv } from "../utils";
import { checkAndDeductRU } from "../utils/ru";
import {
  ApiKeyCreateRowsSchema,
  ApiKeyIdRowsSchema,
  ApiKeyListRowsSchema,
  TrustedDeviceIdRowsSchema,
  TrustedDeviceListRowsSchema,
  UpdateApiKeyRequestSchema,
} from "../schemas/api-keys";
import {
  getSupabaseRestConfig,
  supabaseRestRequest,
  resolveMemberIdHashForUser,
} from "../utils/supabase-rest";

const app = new Hono<{ Bindings: Bindings }>();

// =============================================================================
// Constants
// =============================================================================

const API_KEY_PREFIX = "fsk_";
const API_KEY_LENGTH = 32;

// =============================================================================
// Helper Functions
// =============================================================================

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
 * Generate a secure random API key
 */
function generateApiKey(): string {
  const bytes = new Uint8Array(API_KEY_LENGTH);
  crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `${API_KEY_PREFIX}${base64}`;
}

/**
 * Mask API key for display (show only first 8 and last 4 chars)
 */
function maskApiKey(key: string): string {
  if (key.length <= 12) return "***";
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

type AuthResult =
  | { token: string; fromCookie: true }
  | { token: string; fromCookie: false };

function extractAccessToken(c: {
  req: { header: (name: string) => string | undefined };
}): AuthResult | null {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return { token: authHeader.slice(7).trim(), fromCookie: false };
  }

  const cookieHeader = c.req.header("Cookie");
  if (!cookieHeader) return null;

  const match = cookieHeader.match(
    /(?:^|;\s*)(?:sb-access-token|__Secure-sb-access-token)=([^;]+)/,
  );
  if (!match) return null;

  try {
    return { token: decodeURIComponent(match[1]), fromCookie: true };
  } catch {
    return { token: match[1], fromCookie: true };
  }
}

function assertCsrfSafe(
  c: { req: { header: (name: string) => string | undefined }; env: Bindings },
  auth: AuthResult,
): boolean {
  if (!auth.fromCookie) return true;

  const env = createEnvContext(c);
  const siteUrl = getEnv(env, "PUBLIC_SITE_URL")?.trim();
  if (!siteUrl) return false;

  let allowedOrigin: string;
  try {
    allowedOrigin = new URL(siteUrl).origin;
  } catch {
    return false;
  }

  const requestOrigin = c.req.header("Origin");
  if (!requestOrigin) return false;

  try {
    return new URL(requestOrigin).origin === allowedOrigin;
  } catch {
    return false;
  }
}

/**
 * Verify Supabase access token and get user info
 */
async function verifyAccessToken(
  config: { url: string; key: string },
  accessToken: string,
): Promise<{ id: string; email: string } | null> {
  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) return null;

    const user = (await response.json()) as { id: string; email: string };
    return user;
  } catch (err) {
    console.warn("[api_keys] verifyAccessToken failed:", err);
    return null;
  }
}

// =============================================================================
// Routes
// =============================================================================

// OPTIONS (CORS)
app.options(
  "*",
  () => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

/**
 * GET /api-keys/usage - Get current usage status for the authenticated user
 */
app.get("/usage", async (c) => {
  const auth = extractAccessToken(c);
  if (!auth) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const config = getSupabaseRestConfig(c);

  try {
    const user = await verifyAccessToken(config, auth.token);
    if (!user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    // Get RU Status
    const env = createEnvContext(c);
    const kv = env.runtime.DATA_LOADER_CACHE_KV;
    let usage = {
      remaining: 1000,
      consumed: 0,
      reset_at: null as number | null,
    };

    if (kv) {
      // Check with 0 cost to peek status
      const result = await checkAndDeductRU(kv, user.id, 0);
      usage.remaining = result.remaining;
      // Note: actual consumed isn't tracked in bucket logic (only remaining is),
      // but we can infer or leave consumed as 0 if we don't have historical data.
    }

    return jsonResponse({ success: true, usage });
  } catch (error) {
    console.error("Usage check error:", error);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});

/**
 * GET /api-keys - List user's API keys
 */
app.get("/", async (c) => {
  const auth = extractAccessToken(c);
  if (!auth) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const config = getSupabaseRestConfig(c);

  try {
    const user = await verifyAccessToken(config, auth.token);
    if (!user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    const apiKeysResponse = await supabaseRestRequest(
      config,
      "api_keys",
      {
      query: `?user_id=eq.${user.id}&order=created_at.desc&select=id,key,email,is_active,created_at,updated_at`,
      },
    );
    const parsedApiKeys = ApiKeyListRowsSchema.safeParse(apiKeysResponse);
    if (!parsedApiKeys.success) {
      console.error("API keys list response shape invalid:", parsedApiKeys.error);
      return jsonResponse({ error: "Internal error" }, 500);
    }

    const maskedKeys = parsedApiKeys.data.map((k) => ({
      id: k.id,
      key_masked: maskApiKey(k.key),
      email: k.email,
      is_active: k.is_active,
      created_at: k.created_at,
      updated_at: k.updated_at,
    }));

    return jsonResponse({ success: true, api_keys: maskedKeys });
  } catch (error) {
    console.error("API keys list error:", error);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});

/**
 * POST /api-keys - Create a new API key
 */
app.post("/", async (c) => {
  const auth = extractAccessToken(c);
  if (!auth) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (!assertCsrfSafe(c, auth)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }
  const config = getSupabaseRestConfig(c);

  try {
    const user = await verifyAccessToken(config, auth.token);
    if (!user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    const currentKeysResponse = await supabaseRestRequest(
      config,
      "api_keys",
      {
        query: `?user_id=eq.${user.id}&select=id`,
      },
    );
    const parsedCurrentKeys = ApiKeyIdRowsSchema.safeParse(
      currentKeysResponse,
    );
    if (!parsedCurrentKeys.success) {
      console.error(
        "API key current keys response shape invalid:",
        parsedCurrentKeys.error,
      );
      return jsonResponse({ error: "Internal error" }, 500);
    }
    const currentKeys = parsedCurrentKeys.data;

    if (currentKeys.length >= 5) {
      return jsonResponse(
        {
          error: "Limit exceeded",
          message: "You can create up to 5 API keys.",
        },
        403,
      );
    }

    // Verify Member ID linkage (Anti-Sybil)
    try {
      const linkedMemberIdHash = await resolveMemberIdHashForUser(
        config,
        user.id,
      );

      if (!linkedMemberIdHash) {
        return jsonResponse(
          {
            error: "Game account verification required",
            message:
              "You must link your KanColle game account (Member ID) before creating API keys.",
          },
          403,
        );
      }
    } catch (error) {
      // If RPC fails (e.g. function not found or error), log specific warning but maybe allow fail-open or fail-closed?
      // Safe bet is fail-closed for security features.
      console.error("Member verification failed:", error);
      return jsonResponse({ error: "Verification check failed" }, 500);
    }

    const newKey = generateApiKey();
    const result = await supabaseRestRequest(
      config,
      "api_keys",
      {
        method: "POST",
        body: {
          user_id: user.id,
          key: newKey,
          email: user.email,
          is_active: true,
        },
        headers: { Prefer: "return=representation" },
      },
    );

    const parsedResult = ApiKeyCreateRowsSchema.safeParse(result);
    if (!parsedResult.success) {
      console.error("API key create response shape invalid:", parsedResult.error);
      return jsonResponse({ error: "Internal error" }, 500);
    }

    const createdApiKey = parsedResult.data[0];
    if (!createdApiKey) {
      return jsonResponse({ error: "Failed to create API key" }, 500);
    }

    // Return the full key only on creation (user must copy it now)
    return jsonResponse({
      success: true,
      api_key: {
        id: createdApiKey.id,
        key: createdApiKey.key, // Full key shown only once
        email: user.email,
        message: "Copy this key now. It will not be shown again.",
      },
    });
  } catch (error) {
    console.error("API key create error:", error);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});

/**
 * DELETE /api-keys/:id - Delete an API key
 */
app.delete("/:id", async (c) => {
  const keyId = c.req.param("id");
  const auth = extractAccessToken(c);
  if (!auth) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (!assertCsrfSafe(c, auth)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }
  const config = getSupabaseRestConfig(c);

  try {
    const user = await verifyAccessToken(config, auth.token);
    if (!user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    // Verify the key exists and belongs to this user before deleting
    const existingResponse = await supabaseRestRequest(
      config,
      "api_keys",
      { query: `?id=eq.${keyId}&user_id=eq.${user.id}&select=id` },
    );
    const parsedExisting = ApiKeyIdRowsSchema.safeParse(existingResponse);
    if (!parsedExisting.success) {
      console.error(
        "API key delete lookup response shape invalid:",
        parsedExisting.error,
      );
      return jsonResponse({ error: "Internal error" }, 500);
    }

    if (parsedExisting.data.length === 0) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    // Delete only if it belongs to the user
    await supabaseRestRequest(config, "api_keys", {
      method: "DELETE",
      query: `?id=eq.${keyId}&user_id=eq.${user.id}`,
    });

    return jsonResponse({ success: true, message: "API key deleted" });
  } catch (error) {
    console.error("API key delete error:", error);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});

/**
 * PATCH /api-keys/:id - Update API key (toggle active)
 */
app.patch("/:id", async (c) => {
  const keyId = c.req.param("id");
  const auth = extractAccessToken(c);
  if (!auth) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (!assertCsrfSafe(c, auth)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }
  const config = getSupabaseRestConfig(c);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return jsonResponse({ error: "Invalid body" }, 400);
  }

  const parsedBody = UpdateApiKeyRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return jsonResponse({ error: "Invalid body" }, 400);
  }
  const body = parsedBody.data;

  try {
    const user = await verifyAccessToken(config, auth.token);
    if (!user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    const updateData: Record<string, unknown> = {};
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    if (Object.keys(updateData).length === 0) {
      return jsonResponse({ error: "No fields to update" }, 400);
    }

    // Verify the key exists and belongs to this user before updating
    const existingResponse = await supabaseRestRequest(
      config,
      "api_keys",
      { query: `?id=eq.${keyId}&user_id=eq.${user.id}&select=id` },
    );
    const parsedExisting = ApiKeyIdRowsSchema.safeParse(existingResponse);
    if (!parsedExisting.success) {
      console.error(
        "API key update lookup response shape invalid:",
        parsedExisting.error,
      );
      return jsonResponse({ error: "Internal error" }, 500);
    }

    if (parsedExisting.data.length === 0) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    await supabaseRestRequest(config, "api_keys", {
      method: "PATCH",
      query: `?id=eq.${keyId}&user_id=eq.${user.id}`,
      body: updateData,
    });

    return jsonResponse({ success: true, message: "API key updated" });
  } catch (error) {
    console.error("API key update error:", error);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});

/**
 * GET /api-keys/devices - List trusted devices
 */
app.get("/devices", async (c) => {
  const auth = extractAccessToken(c);
  if (!auth) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const config = getSupabaseRestConfig(c);

  try {
    const user = await verifyAccessToken(config, auth.token);
    if (!user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    const devicesResponse = await supabaseRestRequest(
      config,
      "trusted_devices",
      {
        query: `?user_id=eq.${user.id}&order=last_used_at.desc.nullslast&select=id,client_id,device_name,created_at,last_used_at`,
      },
    );
    const parsedDevices = TrustedDeviceListRowsSchema.safeParse(
      devicesResponse,
    );
    if (!parsedDevices.success) {
      console.error("Trusted devices response shape invalid:", parsedDevices.error);
      return jsonResponse({ error: "Internal error" }, 500);
    }

    const maskedDevices = parsedDevices.data.map((d) => ({
      id: d.id,
      client_id_masked: `${d.client_id.slice(0, 8)}...`,
      device_name: d.device_name || "Unknown Device",
      created_at: d.created_at,
      last_used_at: d.last_used_at,
    }));

    return jsonResponse({ success: true, devices: maskedDevices });
  } catch (error) {
    console.error("Devices list error:", error);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});

/**
 * DELETE /api-keys/devices/:id - Revoke a trusted device
 */
app.delete("/devices/:id", async (c) => {
  const deviceId = c.req.param("id");
  const auth = extractAccessToken(c);
  if (!auth) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (!assertCsrfSafe(c, auth)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }
  const config = getSupabaseRestConfig(c);

  try {
    const user = await verifyAccessToken(config, auth.token);
    if (!user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    // Verify the device exists and belongs to this user before revoking
    const existingResponse = await supabaseRestRequest(
      config,
      "trusted_devices",
      { query: `?id=eq.${deviceId}&user_id=eq.${user.id}&select=id` },
    );
    const parsedExisting = TrustedDeviceIdRowsSchema.safeParse(
      existingResponse,
    );
    if (!parsedExisting.success) {
      console.error(
        "Trusted device revoke lookup response shape invalid:",
        parsedExisting.error,
      );
      return jsonResponse({ error: "Internal error" }, 500);
    }

    if (parsedExisting.data.length === 0) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    await supabaseRestRequest(config, "trusted_devices", {
      method: "DELETE",
      query: `?id=eq.${deviceId}&user_id=eq.${user.id}`,
    });

    return jsonResponse({ success: true, message: "Device revoked" });
  } catch (error) {
    console.error("Device revoke error:", error);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});

export default app;
