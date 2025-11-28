import type { APIRoute } from "astro";
import { supabase } from "@/utility/supabase";

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const authCode = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = cookies.get("oauth_state")?.value;

  if (!authCode) {
    return new Response("No code provided", { status: 400 });
  }

  if (!state || state !== storedState) {
    return new Response("Invalid state", { status: 400 });
  }

  cookies.delete("oauth_state", { path: "/" });

  const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  const {
    access_token,
    refresh_token,
    provider_token,
    provider_refresh_token,
    expires_at,
  } = data.session;

  const { error: storeTokenError } = await supabase
    .from("provider_tokens")
    .upsert({
      user_id: data.user.id,
      provider_name: "google",
      access_token: provider_token,
      refresh_token: provider_refresh_token,
      expires_at: expires_at ? new Date(expires_at * 1000).toISOString() : null,
    });

  if (storeTokenError) {
    console.error("Failed to store provider token", storeTokenError);
    return new Response("Failed to store provider token", { status: 500 });
  }

  cookies.set("sb-access-token", access_token, {
    path: "/",
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: "lax",
  });
  cookies.set("sb-refresh-token", refresh_token, {
    path: "/",
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: "lax",
  });

  return redirect("/dashboard");
};
