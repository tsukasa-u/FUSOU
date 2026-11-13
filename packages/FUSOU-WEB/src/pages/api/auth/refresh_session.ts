import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { validateOrigin } from "@/utils/security";
import { createEnvContext, getEnv } from "@/server/utils";
import { env as cfEnv } from "cloudflare:workers";

export const POST: APIRoute = async ({ request, cookies }) => {
  const envCtx = createEnvContext({
    env: cfEnv as Record<string, unknown>,
  });
  const siteUrl = getEnv(envCtx, "PUBLIC_SITE_URL")?.trim();
  if (!siteUrl) {
    console.error("[auth/refresh_session] PUBLIC_SITE_URL is not configured");
    return new Response("Server misconfiguration", { status: 500 });
  }
  if (!validateOrigin(request, siteUrl)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  const refreshTokenCookie = cookies.get("sb-refresh-token");

  const noCacheHeaders = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, max-age=0",
  };

  if (!refreshTokenCookie?.value) {
    return new Response(
      JSON.stringify({ error: "No refresh token available" }),
      { status: 401, headers: noCacheHeaders },
    );
  }

  try {
    const supabase = createSupabaseServerClient(
      cookies,
      cfEnv as Record<string, unknown>,
    );

    // Use refresh_token to get a new session
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshTokenCookie.value,
    });

    if (error || !data.session) {
      console.error("[auth/refresh_session] Failed to refresh session:", error);
      return new Response(
        JSON.stringify({ error: "Failed to refresh session" }),
        { status: 401, headers: noCacheHeaders },
      );
    }

    // The cookie storage updates the HttpOnly access and refresh token cookies.

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: noCacheHeaders },
    );
  } catch (error) {
    console.error("[auth/refresh_session] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: noCacheHeaders },
    );
  }
};
