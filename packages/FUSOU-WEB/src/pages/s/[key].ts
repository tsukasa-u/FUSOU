import type { APIRoute } from "astro";
import { env as workerEnv } from "cloudflare:workers";

export const prerender = false;

const KEY_RE = /^[0-9a-f]{16}$/;
const BOT_UA =
  /discordbot|twitterbot|slackbot-linkexpanding|facebookexternalhit|linkedinbot|whatsapp|telegrambot|line\//i;
const SHARED_SNAPSHOT_SESSION_KEY = "__fusouSharedSnapshot";

type ShareRecordResponse = {
  originalUrl?: string;
  snapshotPayload?: Record<string, unknown> | null;
};

type ShareRecordFetchResult =
  | {
      ok: true;
      originalUrl: string;
      snapshotPayload: Record<string, unknown> | null;
    }
  | {
      ok: false;
      response: Response;
    };

function isBot(ua: string): boolean {
  return BOT_UA.test(ua);
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isAllowedHost(hostname: string): boolean {
  return (
    hostname === "fusou.dev" ||
    hostname.endsWith(".fusou.dev") ||
    hostname === "fusou.pages.dev" ||
    hostname.endsWith(".fusou.pages.dev")
  );
}

function normalizeSimulatorUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    if (!isAllowedHost(parsed.hostname)) return null;
    if (
      !(
        parsed.pathname === "/simulator" ||
        parsed.pathname.startsWith("/simulator/")
      )
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildBootstrapHtml(
  originalUrl: string,
  snapshotPayload: Record<string, unknown>,
): string {
  const targetLiteral = JSON.stringify(originalUrl).replace(/</g, "\\u003c");
  const snapshotLiteral = JSON.stringify(snapshotPayload).replace(
    /</g,
    "\\u003c",
  );
  const safeOriginalUrl = escHtml(originalUrl);
  const keyConst = JSON.stringify(SHARED_SNAPSHOT_SESSION_KEY);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FUSOU - Redirecting</title>
  <meta http-equiv="refresh" content="0;url=${safeOriginalUrl}" />
  <meta name="robots" content="noindex, nofollow" />
</head>
<body>
  <p>リダイレクト中… <a href="${safeOriginalUrl}">こちら</a>をクリックしてください。</p>
  <script>
    try {
      const targetUrl = ${targetLiteral};
      const payload = ${snapshotLiteral};
      sessionStorage.setItem(${keyConst}, JSON.stringify(payload));
      location.replace(targetUrl);
    } catch {
      location.replace(${targetLiteral});
    }
  </script>
</body>
</html>`;
}

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
      <p>この共有リンクは存在しないか、利用できない状態です。</p>
    </section>
    <section class="body">
      <p>リンクのコピー漏れ・末尾欠落があると開けない場合があります。送信元に再発行を依頼してください。</p>
      <p>共有URLを再作成する場合は <code>/simulator</code> で最新編成から生成できます。</p>
      <div class="row">
        <a class="btn primary" href="https://fusou.dev/simulator">シミュレータへ移動</a>
        <a class="btn" href="https://fusou.dev/">FUSOUトップ</a>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function buildDescription(dataParam: string): string {
  try {
    const decoded = atob(dataParam);
    const fleet = JSON.parse(decoded) as {
      fleet1?: Array<{ shipId: number | null }>;
      fleet2?: Array<{ shipId: number | null }>;
      fleet3?: Array<{ shipId: number | null }>;
      fleet4?: Array<{ shipId: number | null }>;
      airBases?: Array<{ equipIds: (number | null)[] }>;
    };

    const fleetCounts = [
      fleet.fleet1?.filter((ship) => ship.shipId !== null).length ?? 0,
      fleet.fleet2?.filter((ship) => ship.shipId !== null).length ?? 0,
      fleet.fleet3?.filter((ship) => ship.shipId !== null).length ?? 0,
      fleet.fleet4?.filter((ship) => ship.shipId !== null).length ?? 0,
    ];

    const fleetLabels = ["第一艦隊", "第二艦隊", "第三艦隊", "第四艦隊"];
    const parts: string[] = [];
    for (let i = 0; i < fleetCounts.length; i++) {
      if (fleetCounts[i] > 0) {
        parts.push(`${fleetLabels[i]}: ${fleetCounts[i]}隻`);
      }
    }

    const airBaseParts: string[] = [];
    (fleet.airBases ?? []).forEach((base, idx) => {
      const equipCount = (base.equipIds ?? []).filter(
        (id) => id !== null,
      ).length;
      if (equipCount > 0) {
        airBaseParts.push(`${idx + 1}基地:${equipCount}/4`);
      }
    });
    if (airBaseParts.length > 0) {
      parts.push(`基地航空隊: ${airBaseParts.join(", ")}`);
    }

    return parts.length > 0 ? parts.join(" / ") : "艦隊編成を確認する";
  } catch {
    return "艦隊編成を確認する";
  }
}

function buildOgpHtml(
  shortUrl: string,
  originalUrl: string,
  description: string,
): string {
  const safeShortUrl = escHtml(shortUrl);
  const safeOriginalUrl = escHtml(originalUrl);
  const safeDescription = escHtml(description);
  const safeImageUrl = escHtml("https://fusou.dev/favicon.svg");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="FUSOU" />
  <meta property="og:title" content="FUSOU 編成シミュレータ - 共有編成" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:url" content="${safeShortUrl}" />
  <meta property="og:image" content="${safeImageUrl}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="FUSOU 編成シミュレータ - 共有編成" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta http-equiv="refresh" content="0;url=${safeOriginalUrl}" />
</head>
<body>
  <p>リダイレクト中… <a href="${safeOriginalUrl}">こちら</a>をクリックしてください。</p>
</body>
</html>`;
}

async function fetchShareRecord(key: string): Promise<ShareRecordFetchResult> {
  const shortenerService = workerEnv.SHORTENER_SERVICE as Fetcher | undefined;
  if (!shortenerService) {
    return {
      ok: false,
      response: new Response("Service unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    };
  }

  let upstream: Response;
  try {
    // Access is protected by Cloudflare service binding isolation:
    // https://shortener.internal is not reachable from the public internet.
    upstream = await shortenerService.fetch(
      `https://shortener.internal/internal/snapshot/${key}`,
    );
  } catch (error) {
    console.error("[same-origin-share] shortener fetch failed:", error);
    return {
      ok: false,
      response: new Response("Service unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    };
  }

  if (!upstream.ok) {
    return {
      ok: false,
      response: new Response(
        upstream.status === 404 ? buildNotFoundHtml() : "Service unavailable",
        {
          status: upstream.status === 404 ? 404 : 502,
          headers: {
            "Content-Type":
              upstream.status === 404
                ? "text/html; charset=utf-8"
                : "text/plain; charset=utf-8",
          },
        },
      ),
    };
  }

  let data: ShareRecordResponse;
  try {
    data = (await upstream.json()) as ShareRecordResponse;
  } catch {
    return {
      ok: false,
      response: new Response("Service unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    };
  }

  const originalUrl =
    typeof data.originalUrl === "string" ? data.originalUrl : "";
  const safeOriginalUrl = originalUrl
    ? normalizeSimulatorUrl(originalUrl)
    : null;
  if (!safeOriginalUrl) {
    return {
      ok: false,
      response: new Response(buildNotFoundHtml(), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    };
  }

  return {
    ok: true,
    originalUrl: safeOriginalUrl,
    snapshotPayload: data.snapshotPayload ?? null,
  };
}

export const GET: APIRoute = async ({ params, request }) => {
  const key = params.key;
  if (!key || !KEY_RE.test(key)) {
    return new Response(buildNotFoundHtml(), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const recordResult = await fetchShareRecord(key);
  if (!recordResult.ok) {
    return recordResult.response;
  }

  const { originalUrl, snapshotPayload } = recordResult;
  const ua = request.headers.get("User-Agent") ?? "";

  if (isBot(ua)) {
    let description = "艦隊編成を確認する";
    try {
      const dataParam = new URL(originalUrl).searchParams.get("data");
      if (dataParam) {
        description = buildDescription(dataParam);
      }
    } catch {
      // Fall back to the default description.
    }

    return new Response(buildOgpHtml(request.url, originalUrl, description), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (!snapshotPayload) {
    return new Response(null, {
      status: 302,
      headers: { Location: originalUrl },
    });
  }

  return new Response(buildBootstrapHtml(originalUrl, snapshotPayload), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
