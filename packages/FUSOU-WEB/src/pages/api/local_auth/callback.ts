import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "@/utility/supabaseServer";
import {
  sanitizeErrorMessage,
  SECURE_COOKIE_OPTIONS,
} from "@/utility/security";

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
  const provider = cookies.get("sb-provider")?.value;

  if (!authCode) {
    console.error("No authorization code provided");
    return new Response("No code provided", { status: 400 });
  }

  // Supabase PKCE flow handles state validation internally
  const supabase = createSupabaseServerClient(cookies);
  const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);

  if (error) {
    console.error("Session exchange error:", error);
    // Clean up provider cookie on error
    cookies.delete("sb-provider", { path: "/" });
    return new Response(sanitizeErrorMessage(error), { status: 500 });
  }

  const {
    access_token,
    refresh_token,
    provider_token,
    provider_refresh_token,
  } = data.session;

  // For local app flow: store tokens in cookies for returnLocalApp page to use
  // Do NOT overwrite global auth tokens - those are for web app
  // Instead, store in temporary cookies that returnLocalApp will read
  cookies.set("sb-local-access-token", access_token, COOKIE_OPTIONS);
  cookies.set("sb-local-refresh-token", refresh_token, COOKIE_OPTIONS);

  console.log("✓ Set sb-local-access-token (for local app)");
  console.log("✓ Set sb-local-refresh-token (for local app)");

  if (provider_token && provider_refresh_token) {
    cookies.set("sb-local-provider-token", provider_token, COOKIE_OPTIONS);
    cookies.set(
      "sb-local-provider-refresh-token",
      provider_refresh_token,
      COOKIE_OPTIONS
    );
    console.log("✓ Set local provider tokens");
  } else {
    console.warn("Provider tokens missing in session; skipping persistence");
  }

  // Keep sb-provider cookie for returnLocalApp to use
  if (!provider) {
    cookies.set("sb-provider", "google", COOKIE_OPTIONS);
    console.log("✓ Set sb-provider (default)");
  } else {
    cookies.set("sb-provider", provider, COOKIE_OPTIONS);
    console.log("✓ Set sb-provider:", provider);
  }

  console.log("Redirecting to /returnLocalApp");
  return redirect("/returnLocalApp");
};
