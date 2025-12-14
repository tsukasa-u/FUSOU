import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import { extractBearer, resolveSupabaseConfig } from "../utils";

const app = new Hono<{ Bindings: Bindings }>();

// OPTIONS（CORS）
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS })
);

// POST /auth/signin - 既存エンドポイントからの互換性のため残存
app.post("/signin", async (c) => {
  return c.json({ message: "Use Astro native auth/signin endpoint" }, 400);
});

// GET /auth/signin - ブラウザからの誤ったアクセスに対する案内
app.get("/signin", async (c) => {
  return c.json(
    {
      error: true,
      message:
        "auth/signin expects POST. If you are using the web app, use the Astro-native endpoint.",
    },
    405
  );
});

// GET /auth/callback
app.get("/callback", async (c) => {
  return c.json({ error: "Use Astro native callback endpoint" }, 400);
});

// POST /auth/signout
app.post("/signout", async (c) => {
  return c.json({ message: "Sign out - use Astro native endpoint" }, 400);
});

// POST /auth/google/refresh_token
app.post("/google/refresh_token", async (c) => {
  const authHeader = c.req.header("Authorization");
  const accessToken = extractBearer(authHeader);

  if (!accessToken) {
    return c.json({ error: "Missing access token" }, 401);
  }

  const tokenEndpoint = "https://oauth2.googleapis.com/token";

  try {
    const { url, publishableKey } = resolveSupabaseConfig(c.env);
    if (!url || !publishableKey) {
      return c.json({ error: "Server misconfiguration" }, 500);
    }

    const supabase = createClient(url, publishableKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: user, error: userError } = await supabase.auth.getUser();
    if (userError || !user.user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { data: tokenData, error: tokenError } = await supabase
      .from("provider_tokens")
      .select("refresh_token")
      .eq("user_id", user.user.id)
      .eq("provider_name", "google")
      .single();

    if (tokenError || !tokenData) {
      return c.json({ error: "No refresh token found" }, 404);
    }

    const googleRefreshToken = tokenData.refresh_token;
    const googleClientId = import.meta.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = import.meta.env.GOOGLE_CLIENT_SECRET;

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: googleRefreshToken,
        client_id: googleClientId!,
        client_secret: googleClientSecret!,
      }),
    });

    if (!response.ok) {
      return c.json({ error: "Failed to refresh token" }, 500);
    }

    interface GoogleTokenResponse {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    }

    const data = await response.json() as GoogleTokenResponse;

    if (data.refresh_token) {
      await supabase
        .from("provider_tokens")
        .update({ refresh_token: data.refresh_token })
        .eq("user_id", user.user.id)
        .eq("provider_name", "google");
    }

    return c.json({
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    });
  } catch (error) {
    console.error("Error refreshing Google access token:", error);
    return c.json({ error: "Internal server error during token refresh" }, 500);
  }
});

// GET /auth/dashboard (legacy placeholder)
app.get("/dashboard", async (c) => {
  return c.json({ error: "Use web app dashboard instead" }, 400);
});

// Local Auth
app.post("/local_auth/signin", async (c) => {
  return c.json(
    { message: "Use Astro native local_auth/signin endpoint" },
    400
  );
});

app.get("/local_auth/callback", async (c) => {
  return c.json(
    { message: "Use Astro native local_auth/callback endpoint" },
    400
  );
});

export default app;
