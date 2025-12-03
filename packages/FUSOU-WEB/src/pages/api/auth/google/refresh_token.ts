import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const POST: APIRoute = async ({ request }) => {
  const tokenEndpoint = "https://oauth2.googleapis.com/token";

  const authHeader = request.headers.get("Authorization");
  const accessToken = authHeader?.replace("Bearer ", "").trim();

  if (!accessToken) {
    return new Response("Missing access token", { status: 401 });
  }

  // Create a user-scoped client to respect RLS
  const supabase = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
  );

  const { data: user, error: userError } = await supabase.auth.getUser();

  if (userError || !user.user) {
    console.error("Invalid user session:", userError);
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: tokenData, error: tokenError } = await supabase
    .from("provider_tokens")
    .select("refresh_token")
    .eq("user_id", user.user.id)
    .eq("provider_name", "google")
    .single();

  if (tokenError || !tokenData) {
    console.error("Provider token lookup failed:", tokenError);
    return new Response("No refresh token found for user", { status: 404 });
  }

  const googleRefreshToken = tokenData.refresh_token;
  const googleClientId = import.meta.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = import.meta.env.GOOGLE_CLIENT_SECRET;

  try {
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: googleRefreshToken,
        client_id: googleClientId,
        client_secret: googleClientSecret,
      }),
    });

    if (!response.ok) {
      const msg = await response.text();
      console.error("Google refresh token error:", response.status, msg);
      return new Response("Failed to refresh token with provider", { status: 500 });
    }

    const data = await response.json();

    if (data.refresh_token) {
      const { error: updateError } = await supabase
        .from("provider_tokens")
        .update({ refresh_token: data.refresh_token })
        .eq("user_id", user.user.id)
        .eq("provider_name", "google");

      if (updateError) {
        console.error("Failed to update new refresh token", updateError);
        // Do not block the response for this error
      }
    }

    return new Response(
      JSON.stringify({
        accessToken: data.access_token,
        expiresIn: data.expires_in,
      })
    );
  } catch (error) {
    console.error("Error refreshing Google access token:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error during token refresh" }),
      { status: 500 }
    );
  }
};