// FUSOU URL Shorter — Cloudflare Worker
// Shortens long simulator share URLs (base64 fleet data) into KV-backed short keys.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Bindings = {
  URL_KV: KVNamespace;
  /** Comma-separated allowed origins (set via wrangler.toml / dashboard) */
  ALLOWED_ORIGINS: string;
  /** Public base URL of this worker (e.g. https://s.fusou.dev).
   *  Required when called via service binding because c.req.url returns
   *  https://shortener.internal/... which is not publicly reachable. */
  BASE_URL: string;
  /** Public OGP image URL for social previews */
  OGP_IMAGE_URL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
const SHORT_KEY_LENGTH = 16;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse ALLOWED_ORIGINS env to a string array. */
function allowedOrigins(env: Bindings): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Match origin against exact entries or wildcard host entries (e.g. https://*.fusou.pages.dev). */
function isOriginAllowed(origin: string, patterns: string[]): boolean {
  if (!origin) return false;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  return patterns.some((pattern) => {
    if (pattern === origin) return true;

    if (!pattern.includes("*")) return false;

    let patternUrl: URL;
    try {
      patternUrl = new URL(pattern.replace("*.", "placeholder."));
    } catch {
      return false;
    }

    if (patternUrl.protocol !== originUrl.protocol) return false;
    const wildcardHost = patternUrl.hostname.replace("placeholder.", "");
    if (!wildcardHost) return false;

    return originUrl.hostname.endsWith(`.${wildcardHost}`);
  });
}

/** Generate a unique 16-char key, retrying on collision. */
async function createKey(kv: KVNamespace, url: string, depth = 0): Promise<string> {
  if (depth > 5) {
    throw new Error("Failed to generate unique key after retries");
  }
  const uuid = crypto.randomUUID().replace(/-/g, "");
  const key = uuid.substring(0, SHORT_KEY_LENGTH);
  const existing = await kv.get(key);
  if (existing) {
    return createKey(kv, url, depth + 1);
  }
  // No expiration — shared fleet links may be referenced indefinitely from Discord/Twitter
  await kv.put(key, url);
  return key;
}

// ---------------------------------------------------------------------------
// Middleware — CORS (restrict to FUSOU origins only)
// ---------------------------------------------------------------------------

app.use("*", async (c, next) => {
  const origins = allowedOrigins(c.env);
  const corsMiddleware = cors({
    origin: (origin) => {
      if (!origin) return "";
      return isOriginAllowed(origin, origins) ? origin : "";
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  });
  return corsMiddleware(c, next);
});

// ---------------------------------------------------------------------------
// Middleware — Origin gate (block non-FUSOU requests)
// ---------------------------------------------------------------------------

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin") ?? "";
  const referer = c.req.header("Referer") ?? "";
  const path = c.req.path;
  const origins = allowedOrigins(c.env);

  // Allow requests with no Origin/Referer only for a dedicated health endpoint.
  // This prevents unauthenticated abuse of stateful API routes like /api/shorten.
  if (!origin && !referer) {
    if (path === "/api/health") {
      await next();
      return;
    }
    return c.json({ error: "Forbidden" }, 403);
  }

  // For browser or other clients that send Origin/Referer, enforce allowed origins.
  if (origin) {
    if (!isOriginAllowed(origin, origins)) {
      return c.json({ error: "Forbidden" }, 403);
    }
  } else if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!isOriginAllowed(refOrigin, origins)) {
        return c.json({ error: "Forbidden" }, 403);
      }
    } catch {
      return c.json({ error: "Forbidden" }, 403);
    }
  }

  await next();
});

// ---------------------------------------------------------------------------
// POST /api/shorten — create a short URL
// ---------------------------------------------------------------------------

const shortenSchema = z.object({
  url: z
    .string()
    .max(16_000) // reject oversized payloads before expensive URL parsing (DoS guard)
    .url()
    .refine(
      (u) => {
        try {
          const parsed = new URL(u);
          // Block javascript: and other non-https schemes (Zod accepts javascript: as valid URL)
          if (parsed.protocol !== "https:") return false;
          // Only allow shortening FUSOU simulator URLs
          return parsed.pathname === "/simulator" || parsed.pathname.startsWith("/simulator/");
        } catch {
          return false;
        }
      },
      { message: "Only FUSOU simulator https URLs are accepted" }
    ),
});

const shortenValidator = zValidator("json", shortenSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Validation failed", issues: result.error.issues }, 400);
  }
});

app.post("/api/shorten", shortenValidator, async (c) => {
  const { url } = c.req.valid("json");

  // Hostname must be one of the FUSOU allowed origins (defense-in-depth against
  // open-redirect if the origin gate is somehow bypassed)
  const urlHost = new URL(url).origin;
  if (!isOriginAllowed(urlHost, allowedOrigins(c.env))) {
    return c.json({ error: "URL hostname is not an allowed FUSOU domain" }, 403);
  }

  const key = await createKey(c.env.URL_KV, url);
  const base = c.env.BASE_URL.replace(/\/$/, "");
  const shortUrl = `${base}/${key}`;
  return c.json({ key, shortUrl });
});

// ---------------------------------------------------------------------------
// OGP helpers
// ---------------------------------------------------------------------------

/** Known crawler / preview bot User-Agents. */
const BOT_UA = /discordbot|twitterbot|slackbot-linkexpanding|facebookexternalhit|linkedinbot|whatsapp|telegrambot|line\//i;

function isBot(ua: string): boolean {
  return BOT_UA.test(ua);
}

/** Escape characters that are special in HTML attribute values. */
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Decode the ?data= base64 param and count ships/airbases.
 * Returns a human-readable description, or falls back gracefully.
 */
function buildDescription(dataParam: string): string {
  try {
    const decoded = atob(dataParam);
    const fleet = JSON.parse(decoded) as {
      fleet1?: Array<{ shipId: number | null }>;
      fleet2?: Array<{ shipId: number | null }>;
      airBases?: Array<{ equipIds: (number | null)[] }>;
    };

    const count1 = fleet.fleet1?.filter((s) => s.shipId !== null).length ?? 0;
    const count2 = fleet.fleet2?.filter((s) => s.shipId !== null).length ?? 0;
    const countAb = fleet.airBases?.filter((b) =>
      b.equipIds.some((id) => id !== null)
    ).length ?? 0;

    const parts: string[] = [];
    if (count1 > 0) parts.push(`第一艦隊: ${count1}隻`);
    if (count2 > 0) parts.push(`第二艦隊: ${count2}隻`);
    if (countAb > 0) parts.push(`基地航空隊: ${countAb}中隊`);

    return parts.length > 0 ? parts.join(" / ") : "艦隊編成を確認する";
  } catch {
    return "艦隊編成を確認する";
  }
}

/**
 * @param shortUrl  - the canonical short URL (og:url)
 * @param originalUrl - the long simulator URL to redirect to
 * @param description - fleet summary text
 * @param ogImageUrl - OGP image URL
 */
function buildOgpHtml(
  shortUrl: string,
  originalUrl: string,
  description: string,
  ogImageUrl: string
): string {
  const safeShortUrl = escHtml(shortUrl);
  const safeOriginalUrl = escHtml(originalUrl);
  const safeDesc = escHtml(description);
  const safeOgpImage = escHtml(ogImageUrl);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="FUSOU" />
  <meta property="og:title" content="FUSOU 編成シミュレータ - 共有編成" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:url" content="${safeShortUrl}" />
  <meta property="og:image" content="${safeOgpImage}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="FUSOU 編成シミュレータ - 共有編成" />
  <meta name="twitter:description" content="${safeDesc}" />
  <meta http-equiv="refresh" content="0;url=${safeOriginalUrl}" />
</head>
<body>
  <p>リダイレクト中… <a href="${safeOriginalUrl}">こちら</a>をクリックしてください。</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// GET /:key — redirect (browser) or OGP HTML (bot)
// ---------------------------------------------------------------------------

app.get(`/:key{[0-9a-f]{${SHORT_KEY_LENGTH}}}`, async (c) => {
  const key = c.req.param("key");
  const originalUrl = await c.env.URL_KV.get(key);

  if (!originalUrl) {
    return c.json({ error: "Not found" }, 404);
  }

  const ua = c.req.header("User-Agent") ?? "";
  if (!isBot(ua)) {
    return c.redirect(originalUrl, 302);
  }

  // Bot path: decode fleet data and return OGP HTML
  let description = "艦隊編成を確認する";
  try {
    const dataParam = new URL(originalUrl).searchParams.get("data");
    if (dataParam) {
      description = buildDescription(dataParam);
    }
  } catch {
    // malformed URL — use fallback description
  }

  const shortUrl = new URL(`/${key}`, c.req.url).toString();
  const ogImageUrl = c.env.OGP_IMAGE_URL?.trim() || "https://fusou.dev/favicon.svg";
  return c.html(buildOgpHtml(shortUrl, originalUrl, description, ogImageUrl));
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/", (c) => {
  return c.json({ status: "ok", service: "fusou-url-shorter" });
});

export default app;
