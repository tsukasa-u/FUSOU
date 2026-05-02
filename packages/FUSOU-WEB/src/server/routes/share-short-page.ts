import type { Bindings } from "@/server/types";
import {
  buildSocialPreviewHtml,
  isSocialPreviewBot,
} from "@/server/utils/share-preview";
import { env as cfEnv } from "cloudflare:workers";

const KEY_RE = /^[0-9a-f]{16}$/;
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

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseAllowedHosts(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (entry.includes("://")) {
        try {
          return new URL(entry).hostname.toLowerCase();
        } catch {
          return "";
        }
      }
      return entry.replace(/^\*\./, "");
    })
    .filter((entry) => entry.length > 0);
}

function resolveSiteOrigin(requestUrl: string): string {
  const workerEnv = cfEnv as unknown as Bindings;
  const configured = workerEnv?.PUBLIC_SITE_URL;
  if (typeof configured === "string" && configured.trim().length > 0) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to request URL.
    }
  }

  return new URL(requestUrl).origin;
}

function resolveAllowedHosts(requestUrl: string): Set<string> {
  const workerEnv = cfEnv as unknown as Bindings;
  const allowed = new Set<string>();

  const siteOrigin = resolveSiteOrigin(requestUrl);
  try {
    allowed.add(new URL(siteOrigin).hostname.toLowerCase());
  } catch {
    // Ignore parse error.
  }

  try {
    allowed.add(new URL(requestUrl).hostname.toLowerCase());
  } catch {
    // Ignore parse error.
  }

  for (const host of parseAllowedHosts(workerEnv?.PUBLIC_SITE_ALLOWED_HOSTS)) {
    allowed.add(host);
  }

  return allowed;
}

function isAllowedHost(hostname: string, allowedHosts: Set<string>): boolean {
  const normalized = hostname.toLowerCase();
  if (allowedHosts.has(normalized)) return true;
  for (const allowed of allowedHosts) {
    if (normalized.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function normalizeShareUrl(
  value: string,
  allowedHosts: Set<string>,
  requestProtocol: string,
): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== requestProtocol)
      return null;
    if (!isAllowedHost(parsed.hostname, allowedHosts)) return null;

    const path = parsed.pathname;
    const isSimulatorPath =
      path === "/simulator" || path.startsWith("/simulator/");
    const isSharePath = path === "/share/data";
    if (!isSimulatorPath && !isSharePath) {
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

function buildNotFoundHtml(siteOrigin: string): string {
  const safeSiteOrigin = escHtml(siteOrigin);
  const simulatorUrl = `${safeSiteOrigin}/simulator`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>FUSOU - Link Not Found</title>
</head>
<body>
  <h1>共有リンクが見つかりませんでした</h1>
  <p>この共有リンクは存在しないか、利用できない状態です。</p>
  <p>共有URLを再作成する場合は <code>/simulator</code> で最新編成から生成できます。</p>
  <p><a href="${simulatorUrl}">シミュレータへ移動</a></p>
</body>
</html>`;
}

export function buildDescription(dataParam: string): string {
  try {
    // UTF-8-safe decode (same pattern as payload-codec decodePayloadBase64)
    let fleet: {
      fleet1?: Array<{ shipId: number | null }>;
      fleet2?: Array<{ shipId: number | null }>;
      fleet3?: Array<{ shipId: number | null }>;
      fleet4?: Array<{ shipId: number | null }>;
      airBases?: Array<{ equipIds: (number | null)[] }>;
    };
    try {
      const binary = atob(dataParam);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const json = new TextDecoder().decode(bytes);
      fleet = JSON.parse(json);
    } catch {
      fleet = JSON.parse(atob(dataParam));
    }
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

async function fetchShareRecord(
  key: string,
  allowedHosts: Set<string>,
  siteOrigin: string,
  requestProtocol: string,
): Promise<ShareRecordFetchResult> {
  const workerEnv = cfEnv as unknown as Bindings;
  const shortenerService = workerEnv?.SHORTENER_SERVICE as Fetcher | undefined;
  if (!shortenerService) {
    return {
      ok: false,
      response: new Response("Service unavailable", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      }),
    };
  }

  let upstream: Response;
  try {
    upstream = await shortenerService.fetch(
      `https://shortener.internal/internal/snapshot/${key}`,
    );
  } catch (error) {
    console.error("[same-origin-share] shortener fetch failed:", error);
    return {
      ok: false,
      response: new Response("Service unavailable", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      }),
    };
  }

  if (!upstream.ok) {
    return {
      ok: false,
      response: new Response(
        upstream.status === 404
          ? buildNotFoundHtml(siteOrigin)
          : "Service unavailable",
        {
          status: upstream.status === 404 ? 404 : 502,
          headers: {
            "Content-Type":
              upstream.status === 404
                ? "text/html; charset=utf-8"
                : "text/plain; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "referrer-policy": "strict-origin-when-cross-origin",
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
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      }),
    };
  }

  const originalUrl =
    typeof data.originalUrl === "string" ? data.originalUrl : "";
  const safeOriginalUrl = originalUrl
    ? normalizeShareUrl(originalUrl, allowedHosts, requestProtocol)
    : null;
  if (!safeOriginalUrl) {
    return {
      ok: false,
      response: new Response(buildNotFoundHtml(siteOrigin), {
        status: 404,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      }),
    };
  }

  return {
    ok: true,
    originalUrl: safeOriginalUrl,
    snapshotPayload: data.snapshotPayload ?? null,
  };
}

export async function handleShareShortRequest(
  request: Request,
  key: string | undefined,
): Promise<Response> {
  const siteOrigin = resolveSiteOrigin(request.url);
  const allowedHosts = resolveAllowedHosts(request.url);
  const requestProtocol = new URL(request.url).protocol;
  const ua = request.headers.get("User-Agent") ?? "";
  const isBotRequest = isSocialPreviewBot(ua);

  function buildBotErrorPreview(description: string): Response {
    return new Response(
      buildSocialPreviewHtml({
        title: "FUSOU 編成シミュレータ - 共有編成",
        description,
        requestUrl: request.url,
        targetUrl: `${siteOrigin}/simulator`,
        imageUrl: `${siteOrigin}/favicon.svg`,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          Vary: "User-Agent",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
          "content-security-policy":
            "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        },
      },
    );
  }

  if (!key || !KEY_RE.test(key)) {
    if (isBotRequest) {
      return buildBotErrorPreview("共有リンクが見つかりませんでした。");
    }
    return new Response(buildNotFoundHtml(siteOrigin), {
      status: 404,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
      },
    });
  }

  const recordResult = await fetchShareRecord(
    key,
    allowedHosts,
    siteOrigin,
    requestProtocol,
  );
  if (!recordResult.ok) {
    if (isBotRequest) {
      return buildBotErrorPreview(
        recordResult.response.status === 404
          ? "共有リンクが見つかりませんでした。"
          : "共有リンクの解決に失敗しました。時間をおいて再度お試しください。",
      );
    }
    return recordResult.response;
  }

  const { originalUrl, snapshotPayload } = recordResult;

  if (isBotRequest) {
    let description = "艦隊編成を確認する";
    try {
      const dataParam = new URL(originalUrl).searchParams.get("data");
      if (dataParam) {
        description = buildDescription(dataParam);
      }
    } catch {
      // Fall back to the default description.
    }

    return new Response(
      buildSocialPreviewHtml({
        title: "FUSOU 編成シミュレータ - 共有編成",
        description,
        requestUrl: request.url,
        targetUrl: originalUrl,
        imageUrl: `${siteOrigin}/favicon.svg`,
        redirectUrl: originalUrl,
      }),
      {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          Vary: "User-Agent",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
          "content-security-policy":
            "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        },
      },
    );
  }

  if (!snapshotPayload) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: originalUrl,
        "cache-control": "no-store",
        Vary: "User-Agent",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
      },
    });
  }

  return new Response(buildBootstrapHtml(originalUrl, snapshotPayload), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      Vary: "User-Agent",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "content-security-policy":
        "script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
  });
}
