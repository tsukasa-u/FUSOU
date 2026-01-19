import { Hono } from "hono";
import type { Bindings } from "../types";
import { CORS_HEADERS, CACHE_TTL_MS } from "../constants";
import { resolveSupabaseConfig, createEnvContext } from "../utils";

const app = new Hono<{ Bindings: Bindings }>();

// KV cache key for period tag
const KC_PERIOD_TAG_CACHE_KEY = "kc:latest_period_tag";

// OPTIONS（CORS）
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS })
);

// GET /latest
app.get("/latest", async (c) => {
  const now = Date.now();
  const envCtx = createEnvContext(c);
  const { url: supabaseUrl, serviceRoleKey: apiKey } =
    resolveSupabaseConfig(envCtx);
  
  if (!supabaseUrl) {
    return c.json({ error: "Configuration error" }, 500);
  }

  if (!apiKey || !apiKey.startsWith("sb_secret_")) {
    if (!apiKey) console.error("[kc-period] Missing SUPABASE_SECRET_KEY");
    if (!apiKey?.startsWith("sb_secret_"))
      console.error(
        "[kc-period] Invalid SUPABASE_SECRET_KEY (does not start with sb_secret_)"
      );
    return c.json({ error: "API key unavailable" }, 503);
  }

  // Try KV cache first
  const kv = envCtx.runtime.KV_CACHE;
  let cachedTag: string | null = null;
  if (kv) {
    try {
      cachedTag = await kv.get(KC_PERIOD_TAG_CACHE_KEY);
      if (cachedTag) {
        return c.json({ 
          tag: cachedTag, 
          fetchedAt: new Date(now).toISOString(),
          cached: true 
        });
      }
    } catch (e) {
      console.warn("[kc-period] KV cache read failed:", e);
    }
  }

  const CLOCK_SKEW_BUFFER_MS = 5000;
  const nowIso = new Date(Date.now() - CLOCK_SKEW_BUFFER_MS).toISOString();
  const queryUrl = `${supabaseUrl}/rest/v1/kc_period_tag?select=tag&tag=lte.${nowIso}&order=tag.desc.nullslast&limit=1`;

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

    // Cache in KV if available
    if (latestTag && kv) {
      try {
        await kv.put(KC_PERIOD_TAG_CACHE_KEY, latestTag, {
          expirationTtl: Math.floor(CACHE_TTL_MS / 1000), // Convert ms to seconds
        });
      } catch (e) {
        console.warn("[kc-period] KV cache write failed:", e);
      }
    }

    const payload = {
      tag: latestTag,
      fetchedAt: new Date(now).toISOString(),
      cached: false,
    };

    return c.json(payload);
  } catch (error) {
    console.error("[kc-period] Exception during fetch:", error);
    return c.json({ error: "Failed to fetch period" }, 502);
  }
});

export default app;

