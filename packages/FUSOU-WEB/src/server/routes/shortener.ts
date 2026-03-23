import { Hono } from "hono";
import type { Bindings } from "@/server/types";
import { createEnvContext } from "@/server/utils";

const app = new Hono<{ Bindings: Bindings }>();

type UpstreamAttempt = {
  source: "service-binding";
  ok: boolean;
  key?: string;
  status?: number;
  error?: string;
  detail?: string;
};

type SnapshotPayload = {
  snapshotShips?: Record<string, unknown>;
  snapshotSlotItems?: Record<string, unknown>;
};

type ShareRecordResponse = {
  originalUrl?: string;
  snapshotPayload?: Record<string, unknown> | null;
};



async function requestShortener(
  fetcher: () => Promise<Response>,
): Promise<UpstreamAttempt> {
  let response: Response;
  try {
    response = await fetcher();
  } catch (error) {
    return {
      source: "service-binding",
      ok: false,
      error: "Shortener upstream request failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const text = await response.text();
  if (response.ok && text.trim() === "Hello world") {
    return {
      source: "service-binding",
      ok: false,
      status: response.status,
      error: "Shortener upstream appears misconfigured",
      detail:
        "Received placeholder response 'Hello world'. Verify SHORTENER_SERVICE points to fusou-url-shorter and the worker is deployed.",
    };
  }

  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }

  if (!response.ok) {
    return {
      source: "service-binding",
      ok: false,
      status: response.status,
      error: "Shortener upstream error",
      detail:
        typeof json?.error === "string" ? json.error : text.slice(0, 300),
    };
  }

  const key = json && typeof json.key === "string" ? json.key.trim() : "";
  if (!key) {
    return {
      source: "service-binding",
      ok: false,
      status: response.status,
      error: "Shortener upstream response format invalid",
      detail: text.slice(0, 300),
    };
  }

  return {
    source: "service-binding",
    ok: true,
    key,
    status: response.status,
  };
}

function isAllowedHost(hostname: string): boolean {
  return hostname === "fusou.dev"
    || hostname.endsWith(".fusou.dev")
    || hostname === "fusou.pages.dev"
    || hostname.endsWith(".fusou.pages.dev");
}

function normalizeSimulatorUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    if (!isAllowedHost(parsed.hostname)) return null;
    if (!(parsed.pathname === "/simulator" || parsed.pathname.startsWith("/simulator/"))) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function decodePayloadBase64(data: string): unknown {
  // v2 UTF-8-safe decode path
  try {
    const binary = atob(data);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch {
    // Backward compatibility: older links used direct atob(JSON)
    return JSON.parse(atob(data));
  }
}

app.post("/", async (c) => {
  const envCtx = createEnvContext(c);
  const shortenerService = envCtx.runtime.SHORTENER_SERVICE as Fetcher | undefined;
  const currentOrigin = new URL(c.req.url).origin;

  const originHeader = c.req.header("Origin");
  if (originHeader && originHeader !== currentOrigin) {
    return c.json({ ok: false, error: "Invalid request origin" }, 403);
  }

  if (!shortenerService) {
    return c.json(
      {
        ok: false,
        error: "Server misconfiguration: SHORTENER_SERVICE is required",
      },
      500,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const url = (body as { url?: unknown })?.url;
  const snapshotPayload = (body as { snapshotPayload?: unknown })?.snapshotPayload;
  if (typeof url !== "string" || url.length === 0) {
    return c.json({ ok: false, error: "url is required" }, 400);
  }

  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: currentOrigin,
      Referer: c.req.url,
    },
    body: JSON.stringify({
      url,
      ...(snapshotPayload && typeof snapshotPayload === "object"
        ? { snapshotPayload: snapshotPayload as SnapshotPayload }
        : {}),
    }),
  };

  const attempt = await requestShortener(() =>
    shortenerService.fetch("https://shortener.internal/api/shorten", requestInit),
  );

  if (attempt.ok && attempt.key) {
    return c.json({ ok: true, shortUrl: `${currentOrigin}/s/${attempt.key}` }, 200);
  }

  return c.json(
    {
      ok: false,
      error: "SHORTENER_SERVICE request failed",
      detail: attempt.detail || attempt.error || "Unknown upstream failure",
      attempts: [attempt],
    },
    502,
  );
});

app.get("/resolve/:key{[0-9a-f]{16}}", async (c) => {
  const envCtx = createEnvContext(c);
  const shortenerService = envCtx.runtime.SHORTENER_SERVICE as Fetcher | undefined;

  if (!shortenerService) {
    return c.json(
      {
        ok: false,
        error: "Server misconfiguration: SHORTENER_SERVICE is required",
      },
      500,
    );
  }

  const key = c.req.param("key");

  let upstream: Response;
  try {
    upstream = await shortenerService.fetch(
      `https://shortener.internal/internal/snapshot/${key}`,
    );
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: "Failed to reach shortener service",
        detail: error instanceof Error ? error.message : String(error),
      },
      502,
    );
  }

  if (!upstream.ok) {
    if (upstream.status === 404) {
      return c.json({ ok: false, error: "Not found" }, 404);
    }
    return c.json({ ok: false, error: "Upstream error", status: upstream.status }, 502);
  }

  let data: ShareRecordResponse;
  try {
    data = (await upstream.json()) as ShareRecordResponse;
  } catch {
    return c.json({ ok: false, error: "Invalid upstream response" }, 503);
  }

  const originalUrl = typeof data.originalUrl === "string" ? data.originalUrl : "";
  const safeOriginalUrl = originalUrl ? normalizeSimulatorUrl(originalUrl) : null;
  if (!safeOriginalUrl) {
    return c.json({ ok: false, error: "Resolved URL is invalid" }, 404);
  }

  const parsed = new URL(safeOriginalUrl);
  const dataParam = parsed.searchParams.get("data");
  if (!dataParam) {
    return c.json({ ok: false, error: "Resolved URL has no data payload" }, 422);
  }

  let dataPayload: Record<string, unknown>;
  try {
    const decoded = decodePayloadBase64(dataParam);
    if (!decoded || typeof decoded !== "object") {
      return c.json({ ok: false, error: "Invalid data payload" }, 422);
    }
    dataPayload = decoded as Record<string, unknown>;
  } catch {
    return c.json({ ok: false, error: "Invalid data payload" }, 422);
  }

  return c.json({
    ok: true,
    key,
    originalUrl: safeOriginalUrl,
    dataPayload,
    snapshotPayload: data.snapshotPayload ?? null,
  });
});

export default app;
