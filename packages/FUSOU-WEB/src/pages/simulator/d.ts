import type { APIRoute } from "astro";

export const prerender = false;

const BOT_UA = /discordbot|twitterbot|slackbot-linkexpanding|facebookexternalhit|linkedinbot|whatsapp|telegrambot|line\//i;
const KEY_RE = /^(ship|equip):(\d{1,7})$/;

type LookupData = {
  ships: Record<string, { name?: string }>;
  items: Record<string, { name?: string }>;
};

let lookupCache: LookupData | null = null;

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

function parseKey(key: string | null): { kind: "ship" | "equip"; id: number } | null {
  if (!key) return null;
  const match = KEY_RE.exec(key.trim());
  if (!match) return null;
  return {
    kind: match[1] as "ship" | "equip",
    id: Number(match[2]),
  };
}

function resolveSelectionFromQuery(url: URL): { kind: "ship" | "equip"; id: number } | null {
  const byKey = parseKey(url.searchParams.get("key"));
  if (byKey) return byKey;

  const shipId = parsePositiveInt(url.searchParams.get("ship"));
  if (shipId != null) return { kind: "ship", id: shipId };

  const equipId = parsePositiveInt(url.searchParams.get("equip"));
  if (equipId != null) return { kind: "equip", id: equipId };

  return null;
}

function buildTargetUrl(requestUrl: URL, selection: { kind: "ship" | "equip"; id: number }): string {
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

async function getLookupData(requestUrl: URL): Promise<LookupData> {
  if (lookupCache) return lookupCache;

  try {
    const dataUrl = new URL("/data/slot_item_effects.json", requestUrl.origin);
    const res = await fetch(dataUrl.toString());
    if (!res.ok) {
      lookupCache = { ships: {}, items: {} };
      return lookupCache;
    }

    const json = (await res.json()) as {
      _ships?: Record<string, { name?: string }>;
      _items?: Record<string, { name?: string }>;
    };

    lookupCache = {
      ships: json._ships ?? {},
      items: json._items ?? {},
    };
    return lookupCache;
  } catch {
    lookupCache = { ships: {}, items: {} };
    return lookupCache;
  }
}

function buildPreviewMeta(
  selection: { kind: "ship" | "equip"; id: number },
  lookup: LookupData,
): { title: string; description: string } {
  if (selection.kind === "ship") {
    const name = lookup.ships[String(selection.id)]?.name ?? `艦ID ${selection.id}`;
    return {
      title: `FUSOU 艦詳細共有: ${name}`,
      description: `${name} (ID ${selection.id}) の詳細ページ共有リンクです。`,
    };
  }

  const name = lookup.items[String(selection.id)]?.name ?? `装備ID ${selection.id}`;
  return {
    title: `FUSOU 装備詳細共有: ${name}`,
    description: `${name} (ID ${selection.id}) の詳細ページ共有リンクです。`,
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
    <p><a href="${safeTargetUrl}">詳細ページを開く</a></p>
  </main>
</body>
</html>`;
}

export const GET: APIRoute = async ({ request }) => {
  const requestUrl = new URL(request.url);
  const selection = resolveSelectionFromQuery(requestUrl);
  if (!selection) {
    return new Response("invalid key", { status: 400 });
  }

  const targetUrl = buildTargetUrl(requestUrl, selection);
  const ua = request.headers.get("user-agent") ?? "";

  if (!isBot(ua)) {
    return Response.redirect(targetUrl, 302);
  }

  const lookup = await getLookupData(requestUrl);
  const meta = buildPreviewMeta(selection, lookup);
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
    },
  });
};
