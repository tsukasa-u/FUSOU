import type { APIRoute } from "astro";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabaseServer";
import {
  sanitizeErrorMessage,
  SECURE_COOKIE_OPTIONS,
  validateInternalReturnPath,
} from "@/utils/security";
import { isValidPublicId } from "@/server/utils";
import { env as cfEnv } from "cloudflare:workers";

// Use consistent cookie options with supabaseServer.ts
// const COOKIE_OPTIONS = {
//   path: "/",
//   sameSite: "lax" as const,
//   httpOnly: true,
//   secure: import.meta.env.PROD,
//   maxAge: 60 * 60 * 24 * 7, // 7 days
// };
const COOKIE_OPTIONS = { ...SECURE_COOKIE_OPTIONS, sameSite: "lax" as const };
const PENDING_SYNC_COOKIE = "sb-pending-sync-token";

type ServerSupabaseClient = ReturnType<typeof createSupabaseServerClient>;

async function associatePendingSync(
  supabase: ServerSupabaseClient,
  pendingToken: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; discardCookie: boolean }> {
  if (!isValidPublicId(pendingToken)) {
    return { ok: false, discardCookie: true };
  }

  const pendingResult = await supabase
    .from("pending_member_syncs")
    .select("public_id, expires_at, synced_at")
    .eq("token", pendingToken)
    .maybeSingle();
  if (pendingResult.error || !pendingResult.data) {
    return { ok: false, discardCookie: !pendingResult.error };
  }

  const pending = pendingResult.data as {
    public_id?: unknown;
    expires_at?: unknown;
    synced_at?: unknown;
  };
  const publicId =
    typeof pending.public_id === "string" && isValidPublicId(pending.public_id)
      ? pending.public_id.trim().toLowerCase()
      : null;
  const expiresAt =
    typeof pending.expires_at === "string"
      ? new Date(pending.expires_at).getTime()
      : Number.NaN;
  if (!Number.isFinite(expiresAt)) {
    return { ok: false, discardCookie: true };
  }
  if (expiresAt <= Date.now()) {
    return { ok: false, discardCookie: true };
  }
  if (!publicId || !pending.synced_at) {
    return { ok: false, discardCookie: false };
  }

  const mappingResult = await supabase
    .from("web_user_member_map")
    .upsert(
      {
        user_id: userId,
        public_id: publicId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,public_id" },
    )
    .select("public_id")
    .maybeSingle();
  if (mappingResult.error) {
    return { ok: false, discardCookie: false };
  }

  const deleteResult = await supabase
    .from("pending_member_syncs")
    .delete()
    .eq("token", pendingToken);
  if (deleteResult.error) {
    console.warn("[local_auth/callback] failed to consume pending sync", {
      error: deleteResult.error,
    });
  }
  return { ok: true };
}

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const authCode = url.searchParams.get("code");
  const appOriginParam = url.searchParams.get("app_origin");
  const returnTo = validateInternalReturnPath(
    url.searchParams.get("return_to"),
    url.origin,
  );
  const provider = cookies.get("sb-local-provider")?.value;
  const oauthFlowId = url.searchParams.get("oauth_flow");
  const validOauthFlowId =
    oauthFlowId && isValidPublicId(oauthFlowId) ? oauthFlowId : null;
  const flowPendingSyncCookie = validOauthFlowId
    ? `${PENDING_SYNC_COOKIE}-${validOauthFlowId}`
    : null;
  const pendingSyncToken =
    flowPendingSyncCookie
      ? cookies.get(flowPendingSyncCookie)?.value
      : cookies.get(PENDING_SYNC_COOKIE)?.value;
  const oauthStorageKey =
    validOauthFlowId
      ? `sb-local-auth-${validOauthFlowId}`
      : undefined;
  const localCookieSuffix = validOauthFlowId ? `-${validOauthFlowId}` : "";

  if (!authCode) {
    console.error("No authorization code provided");
    return new Response("No code provided", { status: 400 });
  }

  // Supabase PKCE flow handles state validation internally
  // Must use same client config as sign-in handler (no runtimeEnv)
  // to ensure the PKCE code_verifier storage key matches
  const supabase = createSupabaseServerClient(
    cookies,
    cfEnv as Record<string, unknown>,
    oauthStorageKey ? { storageKey: oauthStorageKey } : undefined,
  );
  const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);

  if (error) {
    console.error("Session exchange error:", error);
    // Clean up provider cookie on error
    cookies.delete("sb-local-provider", { path: "/" });
    return new Response(sanitizeErrorMessage(error), { status: 500 });
  }

  const {
    access_token,
    refresh_token,
    provider_token,
    provider_refresh_token,
  } = data.session;

  cookies.set("sb-access-token", access_token, COOKIE_OPTIONS);
  cookies.set("sb-refresh-token", refresh_token, COOKIE_OPTIONS);
  if (provider_token && provider_refresh_token) {
    cookies.set("sb-provider-token", provider_token, COOKIE_OPTIONS);
    cookies.set(
      "sb-provider-refresh-token",
      provider_refresh_token,
      COOKIE_OPTIONS,
    );
  } else {
    cookies.delete("sb-provider-token", { path: "/" });
    cookies.delete("sb-provider-refresh-token", { path: "/" });
  }

  const userId = data.session.user?.id;
  if (!userId) {
    console.error("Session missing user id");
    cookies.delete("sb-local-provider", { path: "/" });
    return new Response("Session missing user id", { status: 500 });
  }

  const supabaseAdmin = createSupabaseAdminClient(
    cfEnv as Record<string, unknown>,
  );

  let associationError = false;
  if (!pendingSyncToken) {
    associationError = true;
    console.error("[local_auth/callback] pending sync token is missing");
  } else {
    try {
      const association = await associatePendingSync(
        supabaseAdmin,
        pendingSyncToken,
        userId,
      );
      if (!association.ok) {
        associationError = true;
        console.error("[local_auth/callback] pending sync association failed");
        if (association.discardCookie) {
          cookies.delete(PENDING_SYNC_COOKIE, { path: "/" });
          if (flowPendingSyncCookie) {
            cookies.delete(flowPendingSyncCookie, { path: "/" });
          }
        }
      } else {
        cookies.delete(PENDING_SYNC_COOKIE, { path: "/" });
        if (flowPendingSyncCookie) {
          cookies.delete(flowPendingSyncCookie, { path: "/" });
        }
      }
    } catch (error) {
      associationError = true;
      console.error("[local_auth/callback] pending sync association error", error);
    }
  }

  // Keep temporary copies for the desktop return page. The regular sb-*
  // cookies above are the Web session and remain available after this flow.
  cookies.set(`sb-local-access-token${localCookieSuffix}`, access_token, COOKIE_OPTIONS);
  cookies.set(`sb-local-refresh-token${localCookieSuffix}`, refresh_token, COOKIE_OPTIONS);
  // expires_at is a Unix timestamp (seconds) from Supabase session
  if (data.session.expires_at) {
    cookies.set(
      `sb-local-expires-at${localCookieSuffix}`,
      String(data.session.expires_at),
      COOKIE_OPTIONS,
    );
  }

  if (provider_token && provider_refresh_token) {
    cookies.set(
      `sb-local-provider-token${localCookieSuffix}`,
      provider_token,
      COOKIE_OPTIONS,
    );
    cookies.set(
      `sb-local-provider-refresh-token${localCookieSuffix}`,
      provider_refresh_token,
      COOKIE_OPTIONS,
    );
    console.log("✓ Set local provider tokens");
  } else {
    console.warn("Provider tokens missing in session; skipping persistence");
  }

  // Keep sb-local-provider cookie for returnLocalApp to use (local app-specific)
  const providerValue = provider || "google";
  if (!provider) {
    cookies.set("sb-local-provider", "google", COOKIE_OPTIONS);
    console.log("✓ Set sb-local-provider (default)");
  } else {
    cookies.set("sb-local-provider", provider, COOKIE_OPTIONS);
    console.log("✓ Set sb-local-provider:", provider);
  }

  // Store tokens in database only when provider tokens are present.
  // provider_token / provider_refresh_token may be absent (e.g. when Google
  // Drive scope is not granted), so guard before upsert to avoid writing nulls.
  if (provider_token && provider_refresh_token) {
    const dbInsertResult = await supabase
      .from("provider_tokens")
      .upsert([
        {
          user_id: userId,
          provider_name: providerValue,
          access_token: provider_token,
          refresh_token: provider_refresh_token,
          expires_at: null,
        },
      ])
      .select();

    if (dbInsertResult.error) {
      console.error("Failed to store provider tokens:", dbInsertResult.error);
      // Don't block redirect on DB error - tokens are still in cookies
      console.warn("Proceeding with redirect despite DB error");
    } else {
      console.log("✓ Provider tokens stored in database");
    }
  } else {
    console.warn("Provider tokens absent; skipping database upsert");
  }

  console.log("Redirecting to /auth/local/callback");
  const target = new URL("/auth/local/callback", url.origin);
  if (appOriginParam) {
    target.searchParams.set("app_origin", appOriginParam);
  }
  target.searchParams.set("return_to", returnTo);
  if (validOauthFlowId) {
    target.searchParams.set("oauth_flow", validOauthFlowId);
  }
  if (associationError) {
    target.searchParams.set("association_error", "1");
  }
  return redirect(target.toString());
};
