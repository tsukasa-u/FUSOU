import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/utility/supabaseServer";
import {
  sanitizeErrorMessage,
  SECURE_COOKIE_OPTIONS,
} from "@/utility/security";
import { getEnvValue } from "@/server/utils";

const createUserScopedClient = (accessToken: string) =>
  createClient(
    getEnvValue("PUBLIC_SUPABASE_URL")!,
    getEnvValue("PUBLIC_SUPABASE_PUBLISHABLE_KEY")!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
  );

// Use consistent cookie options with supabaseServer.ts
// const COOKIE_OPTIONS = {
//   path: "/",
//   sameSite: "lax" as const,
//   httpOnly: true,
//   secure: import.meta.env.PROD,
//   maxAge: 60 * 60 * 24 * 7, // 7 days
// };
const COOKIE_OPTIONS = { ...SECURE_COOKIE_OPTIONS, sameSite: "lax" as const };

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const authCode = url.searchParams.get("code");

  if (!authCode) {
    return new Response("No code provided", { status: 400 });
  }

  // Supabase PKCE flow handles state validation internally
  const supabase = createSupabaseServerClient(cookies);
  const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);

  if (error) {
    return new Response(sanitizeErrorMessage(error), { status: 500 });
  }

  const {
    access_token,
    refresh_token,
    provider_token,
    provider_refresh_token,
    expires_at,
    user,
  } = data.session;
  const providerName =
    user?.app_metadata?.provider ??
    data.user.user_metadata?.provider ??
    "google";

  if (provider_token && provider_refresh_token) {
    const upsertPayload = {
      user_id: data.user.id,
      provider_name: providerName,
      access_token: provider_token,
      refresh_token: provider_refresh_token,
      expires_at: expires_at ? new Date(expires_at * 1000).toISOString() : null,
    };

    // Use user-scoped client with access token (RLS-compliant)
    const userClient = createUserScopedClient(access_token);
    const { error: storeTokenError } = await userClient
      .from("provider_tokens")
      .upsert(upsertPayload);

    if (storeTokenError) {
      // Log the error for debugging but don't block authentication
      // The user is authenticated even if provider token storage fails
      console.warn("⚠️ Provider token storage failed (RLS policy):", {
        code: storeTokenError.code,
        message: storeTokenError.message,
        details: storeTokenError.details,
      });
      console.warn(
        "⚠️ User authentication succeeded, but provider tokens won't be persisted to database"
      );
      console.warn("⚠️ Tokens are still available in cookies for this session");
    } else {
      console.log("✓ Provider tokens stored successfully");
    }

    cookies.set("sb-provider-token", provider_token, COOKIE_OPTIONS);
    cookies.set(
      "sb-provider-refresh-token",
      provider_refresh_token,
      COOKIE_OPTIONS
    );
  } else {
    console.warn("Provider tokens missing in session; skipping persistence");
  }

  cookies.set("sb-access-token", access_token, COOKIE_OPTIONS);
  cookies.set("sb-refresh-token", refresh_token, COOKIE_OPTIONS);

  console.log("✓ Auth tokens set. Redirecting to /dashboard");
  return redirect("/dashboard");
};
