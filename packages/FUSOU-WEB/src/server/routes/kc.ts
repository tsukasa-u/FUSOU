import { Hono } from "hono";
import type { Bindings } from "../types";
import { CORS_HEADERS, CACHE_TTL_MS } from "../constants";

const app = new Hono<{ Bindings: Bindings }>();

let cachedPeriod: { payload: any; expiresAt: number } | null = null;

// OPTIONS（CORS）
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS })
);

// Simple health check to verify routing
app.get("/_health", (c) => c.json({ ok: true }));

// Env check endpoint (no secrets leaked; shows provenance and prefix only)
app.get("/_envcheck", (c) => {
  const runtimeKey = c.env.SUPABASE_SECRET_KEY;
  const buildKey = import.meta.env.SUPABASE_SECRET_KEY as string | undefined;
  const pickPrefix = (k?: string) =>
    typeof k === "string" ? k.substring(0, 12) : "undefined";
  const keyType = (k?: string) =>
    typeof k === "string"
      ? k.startsWith("sb_secret_")
        ? "secret"
        : k.startsWith("sb_publishable_")
        ? "publishable"
        : "unknown"
      : "missing";
  return c.json({
    runtime: {
      present: typeof runtimeKey === "string",
      type: keyType(runtimeKey),
      prefix: pickPrefix(runtimeKey),
    },
    build: {
      present: typeof buildKey === "string",
      type: keyType(buildKey),
      prefix: pickPrefix(buildKey),
    },
    usingRuntimeOnly: true,
    supabaseUrlPresent: !!(
      c.env.PUBLIC_SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL
    ),
  });
});

// GET /latest
app.get("/latest", async (c) => {
  const now = Date.now();

  if (cachedPeriod && cachedPeriod.expiresAt > now) {
    return c.json({ ...cachedPeriod.payload, cached: true });
  }

  const supabaseUrl = (
    c.env.PUBLIC_SUPABASE_URL ||
    import.meta.env.PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  if (!supabaseUrl) {
    return c.json({ error: "Configuration error" }, 500);
  }

  // Use runtime (Cloudflare Bindings) secret only per Workers' model
  const runtimeKey = c.env.SUPABASE_SECRET_KEY;
  const apiKey =
    typeof runtimeKey === "string" && runtimeKey.startsWith("sb_secret_")
      ? runtimeKey
      : undefined;

  if (!apiKey) {
    console.error(
      "[kc-period] Missing SUPABASE_SECRET_KEY (sb_secret_...) in runtime or build env"
    );
    return c.json({ error: "API key unavailable" }, 503);
  }

  const CLOCK_SKEW_BUFFER_MS = 5000;
  const nowIso = new Date(Date.now() - CLOCK_SKEW_BUFFER_MS).toISOString();
  const queryUrl = `${supabaseUrl}/rest/v1/kc_period_tag?select=tag&tag=lte.${nowIso}&order=tag.desc.nullslast&limit=1`;

  console.log("[kc-period] Supabase URL:", supabaseUrl);
  console.log("[kc-period] Query URL:", queryUrl);

  try {
    const response = await fetch(queryUrl, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const message = (await response.text()).trim();
      console.error(
        `Failed to fetch kc_period_tag: ${response.status} ${message}`
      );
      return c.json({ error: "Unable to fetch kc_period_tag" }, 502);
    }

    const rows = (await response.json()) as Array<{ tag: string | null }>;
    const latestTag =
      Array.isArray(rows) && rows.length > 0 ? rows[0].tag ?? null : null;

    const payload = {
      tag: latestTag,
      fetchedAt: new Date(now).toISOString(),
      cacheExpiresAt: new Date(now + CACHE_TTL_MS).toISOString(),
    };

    cachedPeriod = { payload, expiresAt: now + CACHE_TTL_MS };
    return c.json({ ...payload, cached: false });
  } catch (error) {
    console.error("[kc-period] Exception during fetch:", error);
    return c.json({ error: "Failed to fetch period" }, 502);
  }
});

export default app;
