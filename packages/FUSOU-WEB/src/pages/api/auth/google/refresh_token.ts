import type { APIRoute } from "astro";
import { supabase } from "@/utility/supabase";

export const POST: APIRoute = async ({ request }) => {
  const tokenEndpoint = "https://oauth2.googleapis.com/token";

  const { data: user, error: userError } = await supabase.auth.getUser(
    request.headers.get("Authorization")?.replace("Bearer ", "")
  );

  if (userError) {
    return new Response(userError.message, { status: 401 });
  }

  const { data: tokenData, error: tokenError } = await supabase
    .from("provider_tokens")
    .select("refresh_token")
    .eq("user_id", user.user.id)
    .eq("provider_name", "google")
    .single();

  if (tokenError || !tokenData) {
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
      let msg = await response.text();
      console.error("Google refresh token error:", response.status, msg);
      return new Response(msg, { status: 500 });
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
      JSON.stringify({ error: "Failed to refresh access token" }),
      { status: 500 }
    );
  }
};