import { Hono } from "hono";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import {
  createEnvContext,
  getEnv,
  resolveSupabaseConfig,
  validateJWT,
  verifyAdminToken,
} from "../utils";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

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
 * Anonymous authentication endpoint for background session acquisition.
 * - Creates or restores per-device anonymous Supabase sessions based on member_id_hash
 * - Issues dataset_token (7-day TTL) for upload authorization
 * - Maintains a canonical dataset owner in user_member_map while allowing per-device sessions
 */
app.post("/anonymous-sync", async (c) => {
  try {
    const body = await c.req.json();
    const { member_id_hash } = body;

    if (!member_id_hash || typeof member_id_hash !== "string") {
      return c.json({ error: "member_id_hash is required" }, 400);
    }
    if (!/^[a-f0-9]{64}$/i.test(member_id_hash)) {
      return c.json(
        { error: "member_id_hash must be a 64-character SHA-256 hex string" },
        400,
      );
    }

    // Rate limiting: max 20 calls per hour per member_id_hash using KV.
    // This limits damage if a member_id_hash is leaked.
    const kv = c.env.DATA_LOADER_CACHE_KV;
    if (kv) {
      const rateKey = `anon-sync-rate:${member_id_hash}`;
      const currentRaw = await kv.get(rateKey);
      const parsed = currentRaw ? parseInt(currentRaw, 10) : 0;
      // Guard against NaN (e.g., corrupted KV value) to prevent permanent bypass.
      const current = isNaN(parsed) ? 0 : parsed;
      const limit = 20;
      if (current >= limit) {
        console.warn(
          `[anonymous-sync] Rate limit exceeded for member_id_hash prefix: ${member_id_hash.substring(0, 8)}...`,
        );
        return c.json({ error: "Too many requests" }, 429);
      }
      // Increment counter. expirationTtl resets from each write (sliding window).
      await kv.put(rateKey, String(current + 1), { expirationTtl: 3600 });
    }

    // Get environment configuration
    const envCtx = createEnvContext({ env: c.env });
    const supabaseConfig = resolveSupabaseConfig(envCtx);

    // Dataset token secret (must be configured in environment)
    const datasetTokenSecret = getEnv(envCtx, "DATASET_TOKEN_SECRET");
    if (!datasetTokenSecret) {
      console.error("[anonymous-sync] DATASET_TOKEN_SECRET not configured");
      return c.json({ error: "Server configuration error" }, 500);
    }

    // Validate dataset token secret has sufficient entropy (minimum 32 bytes recommended)
    if (datasetTokenSecret.length < 32) {
      console.error(
        "[anonymous-sync] DATASET_TOKEN_SECRET too short (minimum 32 characters recommended)",
      );
      return c.json({ error: "Server configuration error" }, 500);
    }

    // Admin client for user_member_map lookup
    if (!supabaseConfig.url || !supabaseConfig.serviceRoleKey) {
      console.error("[anonymous-sync] Supabase configuration missing");
      return c.json({ error: "Server configuration error" }, 500);
    }

    const supabaseAdmin = createClient(
      supabaseConfig.url,
      supabaseConfig.serviceRoleKey,
    );

    // Check if member_id_hash already mapped
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("user_member_map")
      .select("user_id")
      .eq("member_id_hash", member_id_hash)
      .maybeSingle();

    if (lookupError) {
      console.error("[anonymous-sync] Database lookup error:", lookupError);
      return c.json({ error: "Database error" }, 500);
    }

    let userId: string;
    let accessToken: string;
    let refreshToken: string;
    let status: "created" | "restored" | "recreated";

    // Anon client for session creation
    const anonKey = supabaseConfig.publishableKey;
    if (!anonKey) {
      console.error("[anonymous-sync] Supabase anon key missing");
      return c.json({ error: "Server configuration error" }, 500);
    }

    const anonClient = createClient(supabaseConfig.url, anonKey);

    const currentBearer = c.req.header("Authorization")?.startsWith("Bearer ")
      ? c.req.header("Authorization")!.slice(7).trim()
      : null;
    const currentSessionUser = currentBearer
      ? await validateJWT(currentBearer)
      : null;

    if (existing) {
      // Existing mapping found - validate user still exists
      userId = existing.user_id;
      status = "restored";

      // Verify user still exists and is valid
      let userExists = true;
      try {
        const { data: userData, error: userError } =
          await supabaseAdmin.auth.admin.getUserById(userId);
        if (userError || !userData?.user) {
          console.warn(
            "[anonymous-sync] Mapped user no longer exists, will create new session:",
            {
              member_id_hash,
              missing_user_id: userId,
              error: userError?.message,
            },
          );
          userExists = false;
        }
      } catch (e) {
        console.warn("[anonymous-sync] Failed to verify user existence:", e);
        userExists = false;
      }

      if (!userExists) {
        // User was deleted - create new anonymous session and update mapping
        const { data: sessionData, error: sessionError } =
          await anonClient.auth.signInAnonymously({
            options: {
              data: { member_id_hash },
            },
          });

        if (sessionError || !sessionData.session) {
          console.error(
            "[anonymous-sync] Failed to create new anonymous user after deletion:",
            {
              message: (sessionError as any)?.message,
              status: (sessionError as any)?.status,
            },
          );
          return c.json({ error: "Failed to create session" }, 500);
        }

        const newUserId = sessionData.user?.id;
        if (!newUserId) {
          console.error("[anonymous-sync] Session missing user_id");
          return c.json({ error: "Failed to create session" }, 500);
        }

        // Update mapping with new user_id
        const { error: updateError } = await supabaseAdmin
          .from("user_member_map")
          .update({ user_id: newUserId })
          .eq("member_id_hash", member_id_hash);

        if (updateError) {
          console.error(
            "[anonymous-sync] Failed to update mapping after user deletion:",
            updateError,
          );
          return c.json({ error: "Failed to update session mapping" }, 500);
        }

        userId = newUserId;
        accessToken = sessionData.session.access_token;
        refreshToken = sessionData.session.refresh_token;
        status = "recreated";
      } else if (currentSessionUser?.id) {
        // Caller already has a valid per-device session; keep using it and only refresh dataset_token.
        const now = Math.floor(Date.now() / 1000);
        const secretKey = new TextEncoder().encode(datasetTokenSecret);
        const datasetToken = await new SignJWT({
          sub: userId,
          dataset_id: member_id_hash,
          typ: "dataset",
          aud: "fusou-upload",
        })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt(now)
          .setExpirationTime(now + 7 * 24 * 60 * 60)
          .sign(secretKey);

        return c.json({
          status: "restored" as const,
          dataset_token: datasetToken,
          dataset_token_expires_at: now + 7 * 24 * 60 * 60,
        });
      } else {
        // Existing mapping found, but this device has no valid local session.
        // Create a fresh anonymous session for this device while keeping dataset ownership
        // bound to the canonical user_id already recorded in user_member_map.
        const { data: sessionData, error: sessionError } =
          await anonClient.auth.signInAnonymously({
            options: {
              data: { member_id_hash },
            },
          });

        if (sessionError || !sessionData.session) {
          console.error(
            "[anonymous-sync] Failed to create per-device anonymous session for restored mapping:",
            {
              message: (sessionError as any)?.message,
              status: (sessionError as any)?.status,
              code: (sessionError as any)?.code,
            },
          );
          return c.json({ error: "Failed to create session" }, 500);
        }

        accessToken = sessionData.session.access_token;
        refreshToken = sessionData.session.refresh_token;
      }
    } else {
      // New user - create anonymous session and mapping
      const { data: sessionData, error: sessionError } =
        await anonClient.auth.signInAnonymously({
          options: {
            data: { member_id_hash },
          },
        });

      if (sessionError || !sessionData.session) {
        console.error("[anonymous-sync] Failed to create anonymous user:", {
          message: (sessionError as any)?.message,
          status: (sessionError as any)?.status,
          code: (sessionError as any)?.code,
        });
        // No existing mapping; cannot issue dataset token safely without user_id
        return c.json({ error: "Failed to create session" }, 500);
      }

      const newUserId = sessionData.user?.id;
      if (!newUserId) {
        console.error("[anonymous-sync] Session missing user_id");
        return c.json({ error: "Failed to create session" }, 500);
      }

      userId = newUserId;
      accessToken = sessionData.session.access_token;
      refreshToken = sessionData.session.refresh_token;
      status = "created";

      // Insert into user_member_map
      const { error: insertError } = await supabaseAdmin
        .from("user_member_map")
        .insert({
          user_id: userId,
          member_id_hash: member_id_hash,
        });

      if (insertError) {
        if ((insertError as any).code === "23505") {
          // Lost concurrent-request race on the unique constraint — re-query for the winning user_id.
          const { data: winner, error: winnerErr } = await supabaseAdmin
            .from("user_member_map")
            .select("user_id")
            .eq("member_id_hash", member_id_hash)
            .maybeSingle();
          if (winnerErr || !winner) {
            console.error(
              "[anonymous-sync] Race recovery lookup failed:",
              winnerErr,
            );
            return c.json({ error: "Failed to create mapping" }, 500);
          }
          userId = winner.user_id;
          console.info(
            "[anonymous-sync] Race resolved: using existing mapping user_id",
            { member_id_hash: member_id_hash.substring(0, 8) },
          );

          // Keep the winner's user_id as canonical dataset owner, but preserve the loser's
          // fresh per-device session tokens so the current device can upload immediately.
          const raceNow = Math.floor(Date.now() / 1000);
          const raceSecretKey = new TextEncoder().encode(datasetTokenSecret);
          const raceDatasetToken = await new SignJWT({
            sub: userId,
            dataset_id: member_id_hash,
            typ: "dataset",
            aud: "fusou-upload",
          })
            .setProtectedHeader({ alg: "HS256" })
            .setIssuedAt(raceNow)
            .setExpirationTime(raceNow + 7 * 24 * 60 * 60)
            .sign(raceSecretKey);

          return c.json({
            status: "restored" as const,
            access_token: sessionData.session.access_token,
            refresh_token: sessionData.session.refresh_token,
            dataset_token: raceDatasetToken,
            dataset_token_expires_at: raceNow + 7 * 24 * 60 * 60,
          });
        } else {
          console.error(
            "[anonymous-sync] Failed to insert mapping:",
            insertError,
          );
          return c.json({ error: "Failed to create mapping" }, 500);
        }
      }
    }

    // Generate dataset_token (7-day TTL)
    const now = Math.floor(Date.now() / 1000);
    const secretKey = new TextEncoder().encode(datasetTokenSecret);
    const datasetToken = await new SignJWT({
      sub: userId,
      dataset_id: member_id_hash,
      typ: "dataset",
      aud: "fusou-upload",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 7 * 24 * 60 * 60) // 7 days
      .sign(secretKey);

    console.log(
      `[anonymous-sync] ${status} anonymous session for member_id_hash: ${member_id_hash.substring(0, 8)}...`,
    );

    return c.json({
      status,
      access_token: accessToken,
      refresh_token: refreshToken,
      dataset_token: datasetToken,
      dataset_token_expires_at: now + 7 * 24 * 60 * 60,
    });
  } catch (error) {
    console.error("[anonymous-sync] Unexpected error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default app;
