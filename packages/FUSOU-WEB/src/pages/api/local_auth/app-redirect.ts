import type { APIRoute } from "astro";
import { validateRedirectUrl } from "@/utility/security";

// One-time redirect endpoint: reads the short-lived fusou:// redirect URL from
// an httpOnly cookie set by /auth/local/callback.astro, issues the redirect,
// and immediately expires the cookie so the token URL cannot be replayed.
export const GET: APIRoute = async ({ cookies, url }) => {
  const redirectUrlCookie = cookies.get("sb-app-redirect-url");

  if (!redirectUrlCookie?.value) {
    // Cookie already consumed or session expired — graceful fallback
    return Response.redirect(new URL("/auth/local/signin", url.origin), 302);
  }

  const redirectTarget = redirectUrlCookie.value;

  // Expire the cookie immediately (single-use).
  // Must use the same path the cookie was set with in callback.astro.
  cookies.delete("sb-app-redirect-url", { path: "/api/local_auth/app-redirect" });

  // Strict validation: only allow fusou://auth deep links.
  if (!validateRedirectUrl(redirectTarget, url.origin)) {
    console.error("[app-redirect] non-fusou redirect rejected");
    return new Response("Invalid redirect target", { status: 400 });
  }

  return Response.redirect(redirectTarget, 302);
};
