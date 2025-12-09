import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "@/utility/supabaseServer";
import { sanitizeErrorMessage, SECURE_COOKIE_OPTIONS } from "@/utility/security";

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const authCode = url.searchParams.get("code");
  const provider = cookies.get("sb-provider")?.value;

  if (!authCode) {
    console.error("No authorization code provided");
    return new Response("No code provided", { status: 400 });
  }

  // Clean up provider cookie
  cookies.delete("sb-provider", { path: "/" });

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
  } = data.session;

  if (provider_token && provider_refresh_token) {
    cookies.set("sb-provider-token", provider_token, SECURE_COOKIE_OPTIONS);
    cookies.set("sb-provider-refresh-token", provider_refresh_token, SECURE_COOKIE_OPTIONS);
  } else {
    console.warn("Provider tokens missing in session; skipping persistence");
  }

  cookies.set("sb-access-token", access_token, SECURE_COOKIE_OPTIONS);
  cookies.set("sb-refresh-token", refresh_token, SECURE_COOKIE_OPTIONS);

  return redirect("/returnLocalApp");
};
