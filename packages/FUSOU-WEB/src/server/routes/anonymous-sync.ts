import { Hono, type Context } from "hono";
import { createClient } from "@supabase/supabase-js";
import {
  createEnvContext,
  getEnv,
  resolveSupabaseConfig,
  verifyAdminToken,
} from "../utils";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

function rejectLegacyAnonymousSyncV1(c: Context<{ Bindings: Bindings }>) {
  c.header("Deprecation", "true");
  c.header("Sunset", "Thu, 31 Dec 2026 23:59:59 GMT");
  return c.json(
    {
      error: "legacy anonymous-sync v1 is deprecated and disabled",
      code: "legacy_anonymous_sync_v1_disabled",
      replacement: {
        register: "/api/auth/anonymous-sync/v2/register",
        challenge: "/api/auth/anonymous-sync/v2/challenge",
        refresh: "/api/auth/anonymous-sync/v2/refresh",
        revoke: "/api/auth/anonymous-sync/v2/revoke",
      },
    },
    410,
  );
}

/**
 * GET /anonymous-sync/diagnostics
 *
 * Provides environment and Supabase configuration diagnostics to help
 * troubleshoot anonymous sign-in issues.
 */
app.get("/anonymous-sync/diagnostics", async (c) => {
  const envCtx = createEnvContext({ env: c.env });
  const check = verifyAdminToken(envCtx, c.req.header("X-ADMIN-TOKEN"));
  if (!check.ok) {
    return c.json({ error: check.error }, check.status);
  }

  try {
    const supabaseConfig = resolveSupabaseConfig(envCtx);

    const datasetTokenSecret = getEnv(envCtx, "DATASET_TOKEN_SECRET");

    // Attempt to read auth config via service role
    let authConfig: any = null;
    if (supabaseConfig.url && supabaseConfig.serviceRoleKey) {
      const admin = createClient(
        supabaseConfig.url,
        supabaseConfig.serviceRoleKey,
      );
      const { data, error } = await admin
        .from("auth.config" as any)
        .select("enable_anonymous_sign_ins, external_url")
        .limit(1);
      if (!error && data && data.length > 0) {
        authConfig = data[0];
      }
    }

    // Fetch GoTrue settings directly (if possible)
    let authSettings: any = null;
    if (supabaseConfig.url && supabaseConfig.serviceRoleKey) {
      try {
        const resp = await fetch(`${supabaseConfig.url}/auth/v1/settings`, {
          headers: {
            apikey: supabaseConfig.serviceRoleKey,
            Authorization: `Bearer ${supabaseConfig.serviceRoleKey}`,
          },
        });
        if (resp.ok) {
          authSettings = await resp.json();
        }
      } catch (e) {
        console.warn(
          "[anonymous-sync/diagnostics] Failed to fetch GoTrue settings:",
          e,
        );
      }
    }

    return c.json({
      supabase: {
        url: supabaseConfig.url,
        hasServiceRoleKey: Boolean(supabaseConfig.serviceRoleKey),
        hasPublishableKey: Boolean(supabaseConfig.publishableKey),
        authConfig,
        authSettings,
      },
      datasetTokenSecret: {
        configured: Boolean(datasetTokenSecret),
        length: datasetTokenSecret ? datasetTokenSecret.length : 0,
        valid: Boolean(datasetTokenSecret && datasetTokenSecret.length >= 32),
      },
    });
  } catch (err) {
    console.error("[anonymous-sync/diagnostics] Unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * POST /anonymous-sync
 *
 * Legacy v1 endpoint is permanently disabled.
 * Clients must use /anonymous-sync/v2/{register,challenge,refresh,revoke}.
 */
app.post("/anonymous-sync", async (c) => {
  return rejectLegacyAnonymousSyncV1(c);
});

export default app;
