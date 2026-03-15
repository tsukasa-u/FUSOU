import { Hono } from "hono";
import type { Bindings } from "@/server/types";
import { createEnvContext } from "@/server/utils";

const app = new Hono<{ Bindings: Bindings }>();

type UpstreamAttempt = {
  source: "service-binding";
  ok: boolean;
  shortUrl?: string;
  status?: number;
  error?: string;
  detail?: string;
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

  const shortUrl =
    json && typeof json.shortUrl === "string" ? json.shortUrl.trim() : "";
  if (!shortUrl) {
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
    status: response.status,
    shortUrl,
  };
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
    body: JSON.stringify({ url }),
  };

  const attempt = await requestShortener(() =>
    shortenerService.fetch("https://shortener.internal/api/shorten", requestInit),
  );

  if (attempt.ok) {
    return c.json({ ok: true, shortUrl: attempt.shortUrl }, 200);
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

export default app;
