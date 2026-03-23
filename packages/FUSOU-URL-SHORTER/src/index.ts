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
};

const app = new Hono<{ Bindings: Bindings }>();
const SHORT_KEY_LENGTH = 16;

type SnapshotPayload = {
  snapshotShips?: Record<string, unknown>;
  snapshotSlotItems?: Record<string, unknown>;
};

type StoredShareRecord = {
  url: string;
  snapshotPayload?: SnapshotPayload;
};

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
async function createKey(kv: KVNamespace, rawValue: string, depth = 0): Promise<string> {
  if (depth > 5) {
    throw new Error("Failed to generate unique key after retries");
  }
  const uuid = crypto.randomUUID().replace(/-/g, "");
  const key = uuid.substring(0, SHORT_KEY_LENGTH);
  const existing = await kv.get(key);
  if (existing) {
    return createKey(kv, rawValue, depth + 1);
  }
  // No expiration — shared fleet links may be referenced indefinitely from Discord/Twitter
  await kv.put(key, rawValue);
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
  snapshotPayload: z
    .object({
      snapshotShips: z.record(z.unknown()).optional(),
      snapshotSlotItems: z.record(z.unknown()).optional(),
    })
    .optional(),
});

const shortenValidator = zValidator("json", shortenSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Validation failed", issues: result.error.issues }, 400);
  }
});

app.post("/api/shorten", shortenValidator, async (c) => {
  const { url, snapshotPayload } = c.req.valid("json");

  // Hostname must be one of the FUSOU allowed origins (defense-in-depth against
  // open-redirect if the origin gate is somehow bypassed)
  const urlHost = new URL(url).origin;
  if (!isOriginAllowed(urlHost, allowedOrigins(c.env))) {
    return c.json({ error: "URL hostname is not an allowed FUSOU domain" }, 403);
  }

  let rawValue = url;
  if (snapshotPayload && (snapshotPayload.snapshotShips || snapshotPayload.snapshotSlotItems)) {
    const record: StoredShareRecord = { url, snapshotPayload };
    const encoded = JSON.stringify(record);
    // Guardrail: keep room for future metadata and prevent excessive KV object size.
    if (encoded.length > 1_000_000) {
      return c.json({ error: "snapshotPayload too large" }, 413);
    }
    rawValue = encoded;
  }

  const key = await createKey(c.env.URL_KV, rawValue);
  const base = c.env.BASE_URL.replace(/\/$/, "");
  const shortUrl = `${base}/${key}`;
  return c.json({ key, shortUrl });
});

function parseStoredShareRecord(raw: string): { originalUrl: string; snapshotPayload: SnapshotPayload | null } {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredShareRecord>;
    if (parsed && typeof parsed === "object" && typeof parsed.url === "string") {
      const snapshotPayload = parsed.snapshotPayload && typeof parsed.snapshotPayload === "object"
        ? parsed.snapshotPayload
        : null;
      return { originalUrl: parsed.url, snapshotPayload };
    }
  } catch {
    // Legacy format: raw value is the original URL string.
  }
  return { originalUrl: raw, snapshotPayload: null };
}

// ---------------------------------------------------------------------------
// GET /internal/snapshot/:key — service-binding-only endpoint for FUSOU-WEB
// Returns the stored record (originalUrl + snapshotPayload) as JSON so that
// the FUSOU-WEB same-origin /s/:key route can bootstrap sessionStorage safely.
// ---------------------------------------------------------------------------

app.get(`/internal/snapshot/:key{[0-9a-f]{${SHORT_KEY_LENGTH}}}`, async (c) => {
  const key = c.req.param("key");
  const storedValue = await c.env.URL_KV.get(key);
  if (!storedValue) {
    return c.json({ error: "Not found" }, 404);
  }
  const { originalUrl, snapshotPayload } = parseStoredShareRecord(storedValue);
  return c.json({ originalUrl, snapshotPayload: snapshotPayload ?? null });
});

function buildNotFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>FUSOU - Link Not Found</title>
  <style>
    :root {
      --bg0: #f8fafc;
      --bg1: #e2e8f0;
      --card: #ffffff;
      --text: #0f172a;
      --sub: #475569;
      --line: #cbd5e1;
      --accent: #0ea5e9;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100svh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(1000px 400px at -10% -10%, #dbeafe 0%, transparent 55%),
        radial-gradient(900px 360px at 110% 120%, #cffafe 0%, transparent 55%),
        linear-gradient(135deg, var(--bg0), var(--bg1));
      color: var(--text);
      font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
      padding: 24px;
    }
    .card {
      width: min(720px, 100%);
      background: color-mix(in srgb, var(--card) 92%, transparent);
      backdrop-filter: blur(4px);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.10);
      overflow: hidden;
    }
    .hero {
      padding: 22px 22px 10px;
      border-bottom: 1px solid color-mix(in srgb, var(--line) 65%, transparent);
      background: linear-gradient(135deg, #f0f9ff, #ecfeff);
    }
    .badge {
      display: inline-block;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .04em;
      color: #0369a1;
      border: 1px solid #7dd3fc;
      border-radius: 999px;
      padding: 4px 10px;
      background: #e0f2fe;
    }
    h1 {
      margin: 12px 0 6px;
      font-size: clamp(22px, 2.4vw, 28px);
      line-height: 1.25;
    }
    p {
      margin: 0;
      color: var(--sub);
      line-height: 1.7;
      font-size: 14px;
    }
    .body {
      padding: 18px 22px 22px;
      display: grid;
      gap: 14px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .btn {
      appearance: none;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 14px;
      text-decoration: none;
      color: var(--text);
      font-weight: 700;
      font-size: 14px;
      background: #fff;
      transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
    }
    .btn:hover {
      transform: translateY(-1px);
      border-color: #93c5fd;
      box-shadow: 0 10px 24px rgba(14, 165, 233, .16);
    }
    .btn.primary {
      color: #fff;
      border-color: #0284c7;
      background: linear-gradient(135deg, #0ea5e9, #0284c7);
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 2px 6px;
      border-radius: 8px;
      color: #334155;
    }
  </style>
</head>
<body>
  <main class="card" role="main" aria-label="Not Found">
    <section class="hero">
      <span class="badge">404 Not Found</span>
      <h1>共有リンクが見つかりませんでした</h1>
      <p>この短縮リンクは存在しないか、利用できない状態です。</p>
    </section>
    <section class="body">
      <p>
        リンクのコピー漏れ・末尾欠落があると開けない場合があります。送信元に再発行を依頼してください。
      </p>
      <p>
        共有URLを再作成する場合は <code>/simulator</code> で最新編成から生成できます。
      </p>
      <div class="row">
        <a class="btn primary" href="https://fusou.dev/simulator">シミュレータへ移動</a>
        <a class="btn" href="https://fusou.dev/">FUSOUトップ</a>
      </div>
    </section>
  </main>
</body>
</html>`;
}

/** Escape characters that are special in HTML attribute values. */
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// GET /:key — disabled public path (same-origin /s/:key is canonical)
// ---------------------------------------------------------------------------

app.get(`/:key{[0-9a-f]{${SHORT_KEY_LENGTH}}}`, async (c) => {
  return c.html(buildNotFoundHtml(), 404);
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/", (c) => {
  return c.json({ status: "ok", service: "fusou-url-shorter" });
});

export default app;
