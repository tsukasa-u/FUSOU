import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { env as cfEnv } from "cloudflare:workers";

export const POST: APIRoute = async ({ cookies }) => {
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
    const supabase = createSupabaseServerClient(cookies, cfEnv as any);

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

    // The createCookieStorage logic in createSupabaseServerClient will automatically
    // update the cookies with the new tokens (access_token, refresh_token).
    // We just need to return the new access token to the client.

    return new Response(
      JSON.stringify({ access_token: data.session.access_token }),
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
