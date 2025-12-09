import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/utility/supabaseServer";
import { sanitizeErrorMessage, SECURE_COOKIE_OPTIONS } from "@/utility/security";

const createUserScopedClient = (accessToken: string) =>
  createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY!,
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
    user?.app_metadata?.provider ?? data.user.user_metadata?.provider ?? "google";

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
      console.error("Failed to store provider token", storeTokenError);
    }

    cookies.set("sb-provider-token", provider_token, SECURE_COOKIE_OPTIONS);
    cookies.set("sb-provider-refresh-token", provider_refresh_token, SECURE_COOKIE_OPTIONS);
  } else {
    console.warn("Provider tokens missing in session; skipping persistence");
  }

  cookies.set("sb-access-token", access_token, SECURE_COOKIE_OPTIONS);
  cookies.set("sb-refresh-token", refresh_token, SECURE_COOKIE_OPTIONS);

  return redirect("/dashboard");
};
