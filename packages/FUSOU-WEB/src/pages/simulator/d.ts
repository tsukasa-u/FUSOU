import type { APIRoute } from "astro";

export const prerender = false;

const BOT_UA = /discordbot|twitterbot|slackbot-linkexpanding|facebookexternalhit|linkedinbot|whatsapp|telegrambot|line\//i;
const KEY_RE = /^(ship|equip):(\d{1,7})$/;
const LOOKUP_CACHE_MAX_ENTRIES = 8;
const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;

type Selection = { kind: "ship" | "equip"; id: number };

type PreviewNameManifest = {
  ships: Record<string, string>;
  items: Record<string, string>;
};

type PreviewNameCacheEntry = {
  name: string | null;
  expiresAt: number;
};

type PreviewManifestCacheEntry = {
  data: PreviewNameManifest;
  expiresAt: number;
};

const previewNameCacheByKey = new Map<string, PreviewNameCacheEntry>();
const previewManifestCacheByOrigin = new Map<string, PreviewManifestCacheEntry>();

function setPreviewNameCache(cacheKey: string, name: string | null): void {
  previewNameCacheByKey.set(cacheKey, {
    name,
    expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
  });
  if (previewNameCacheByKey.size <= LOOKUP_CACHE_MAX_ENTRIES) return;

  const oldestKey = previewNameCacheByKey.keys().next().value;
  if (typeof oldestKey === "string") {
    previewNameCacheByKey.delete(oldestKey);
  }
}

function setPreviewManifestCache(origin: string, data: PreviewNameManifest): void {
  previewManifestCacheByOrigin.set(origin, {
    data,
    expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
  });
  if (previewManifestCacheByOrigin.size <= LOOKUP_CACHE_MAX_ENTRIES) return;

  const oldestKey = previewManifestCacheByOrigin.keys().next().value;
  if (typeof oldestKey === "string") {
    previewManifestCacheByOrigin.delete(oldestKey);
  }
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isBot(ua: string): boolean {
  return BOT_UA.test(ua);
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

function parseKey(key: string | null): Selection | null {
  if (!key) return null;
  const match = KEY_RE.exec(key.trim());
  if (!match) return null;
  return {
    kind: match[1] as "ship" | "equip",
    id: Number(match[2]),
  };
}

function resolveSelectionFromQuery(url: URL): Selection | null {
  const byKey = parseKey(url.searchParams.get("key"));
  if (byKey) return byKey;

  const shipId = parsePositiveInt(url.searchParams.get("ship"));
  if (shipId != null) return { kind: "ship", id: shipId };

  const equipId = parsePositiveInt(url.searchParams.get("equip"));
  if (equipId != null) return { kind: "equip", id: equipId };

  return null;
}

function buildTargetUrl(requestUrl: URL, selection: Selection): string {
  const target = new URL("/simulator/details", requestUrl.origin);
  if (selection.kind === "ship") {
    target.searchParams.set("tab", "ship");
    target.searchParams.set("ship", String(selection.id));
  } else {
    target.searchParams.set("tab", "equip");
    target.searchParams.set("equip", String(selection.id));
  }
  return target.toString();
}

async function getMasterNames(
  requestUrl: URL,
  tableName: "mst_ship" | "mst_slotitem",
  recordId: number,
): Promise<string | null> {
  const cacheKey = `${requestUrl.origin}:${tableName}:${recordId}`;
  const cached = previewNameCacheByKey.get(cacheKey);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.name;
    }
    previewNameCacheByKey.delete(cacheKey);
  }

  try {
    const dataUrl = new URL("/api/master-data/json", requestUrl.origin);
    dataUrl.searchParams.set("table_name", tableName);
    dataUrl.searchParams.set("record_id", String(recordId));
    const res = await fetch(dataUrl.toString());
    if (!res.ok) return null;

    const json = (await res.json()) as {
      records?: Array<{ id?: number; api_id?: number; name?: string; api_name?: string }>;
    };

    const row = json.records?.[0];
    const name = typeof row?.name === "string"
      ? row.name
      : typeof row?.api_name === "string"
        ? row.api_name
        : null;

    setPreviewNameCache(cacheKey, name);
    return name;
  } catch {
    return null;
  }
}

async function getPreviewNameManifest(requestUrl: URL): Promise<PreviewNameManifest> {
  const origin = requestUrl.origin;
  const cached = previewManifestCacheByOrigin.get(origin);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.data;
    }
    previewManifestCacheByOrigin.delete(origin);
  }

  try {
    const manifestUrl = new URL("/data/preview_name_manifest.json", origin);
    const res = await fetch(manifestUrl.toString());
    if (!res.ok) {
      return { ships: {}, items: {} };
    }

    const json = (await res.json()) as {
      ships?: Record<string, string>;
      items?: Record<string, string>;
    };
    const manifest = {
      ships: json.ships ?? {},
      items: json.items ?? {},
    };
    if (Object.keys(manifest.ships).length > 0 || Object.keys(manifest.items).length > 0) {
      setPreviewManifestCache(origin, manifest);
    }
    return manifest;
  } catch {
    return { ships: {}, items: {} };
  }
}

async function resolvePreviewName(
  requestUrl: URL,
  selection: Selection,
): Promise<string | null> {
  const manifest = await getPreviewNameManifest(requestUrl);
  const manifestName = selection.kind === "ship"
    ? manifest.ships[String(selection.id)] ?? null
    : manifest.items[String(selection.id)] ?? null;
  if (manifestName) {
    return manifestName;
  }

  return getMasterNames(
    requestUrl,
    selection.kind === "ship" ? "mst_ship" : "mst_slotitem",
    selection.id,
  );
}

function buildPreviewMeta(
  selection: Selection,
  name: string | null,
): { title: string; description: string } {
  if (selection.kind === "ship") {
    return {
      title: name
        ? `FUSOU 艦詳細: ${name}`
        : `FUSOU 艦詳細: ID ${selection.id}`,
      description: name
        ? `${name} (艦ID ${selection.id}) の詳細ページ共有リンク`
        : `艦 ID ${selection.id} の詳細ページ共有リンク`,
    };
  }

  return {
    title: name
      ? `FUSOU 装備詳細: ${name}`
      : `FUSOU 装備詳細: ID ${selection.id}`,
    description: name
      ? `${name} (装備ID ${selection.id}) の詳細ページ共有リンク`
      : `装備 ID ${selection.id} の詳細ページ共有リンク`,
  };
}

function buildBotHtml(args: {
  title: string;
  description: string;
  requestUrl: string;
  targetUrl: string;
}): string {
  const safeTitle = escHtml(args.title);
  const safeDescription = escHtml(args.description);
  const safeRequestUrl = escHtml(args.requestUrl);
  const safeTargetUrl = escHtml(args.targetUrl);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${safeTitle}</title>
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="FUSOU" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:url" content="${safeRequestUrl}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    <p>${safeDescription}</p>
    <p><a href="${safeTargetUrl}" rel="noopener noreferrer nofollow">詳細ページを開く</a></p>
  </main>
</body>
</html>`;
}

export const GET: APIRoute = async ({ request }) => {
  const requestUrl = new URL(request.url);
  const selection = resolveSelectionFromQuery(requestUrl);
  if (!selection) {
    return new Response("invalid key", {
      status: 400,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const targetUrl = buildTargetUrl(requestUrl, selection);
  const ua = request.headers.get("user-agent") ?? "";

  if (!isBot(ua)) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: targetUrl,
        "cache-control": "no-store",
        Vary: "User-Agent",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const name = await resolvePreviewName(requestUrl, selection);
  const meta = buildPreviewMeta(selection, name);
  const html = buildBotHtml({
    title: meta.title,
    description: meta.description,
    requestUrl: requestUrl.toString(),
    targetUrl,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300",
      Vary: "User-Agent",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
  });
};
