import { Hono } from "hono";
import type { Bindings } from "@/server/types";
import { createEnvContext, getEnv } from "@/server/utils";

const app = new Hono<{ Bindings: Bindings }>();

app.post("/", async (c) => {
  const envCtx = createEnvContext(c);
  const shorterBase = getEnv(envCtx, "PUBLIC_URL_SHORTER_BASE")?.trim();
  const shortenerService = envCtx.runtime.SHORTENER_SERVICE as
    | Fetcher
    | undefined;

  const originHeader = c.req.header("Origin");
  if (originHeader) {
    const currentOrigin = new URL(c.req.url).origin;
    if (originHeader !== currentOrigin) {
      return c.json({ ok: false, error: "Invalid request origin" }, 403);
    }
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
      Origin: new URL(c.req.url).origin,
      Referer: c.req.url,
    },
    body: JSON.stringify({ url }),
  };

  let upstream: Response | null = null;
  let bindingError: unknown = null;

  if (shortenerService) {
    try {
      upstream = await shortenerService.fetch(
        "https://shortener.internal/api/shorten",
        requestInit,
      );
    } catch (error) {
      bindingError = error;
      console.warn("SHORTENER_SERVICE fetch failed, trying URL fallback", error);
    }
  }

  if (!upstream) {
    if (!shorterBase) {
      if (bindingError) {
        return c.json(
          {
            ok: false,
            error:
              "Server misconfiguration: SHORTENER_SERVICE failed and PUBLIC_URL_SHORTER_BASE is not set",
            detail:
              bindingError instanceof Error
                ? bindingError.message
                : String(bindingError),
          },
          502,
        );
      }

      return c.json(
        {
          ok: false,
          error:
            "Server misconfiguration: SHORTENER_SERVICE or PUBLIC_URL_SHORTER_BASE is required",
        },
        500,
      );
    }

    try {
      upstream = await fetch(
        `${shorterBase.replace(/\/+$/, "")}/api/shorten`,
        requestInit,
      );
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: "Shortener upstream request failed",
          detail: error instanceof Error ? error.message : String(error),
        },
        502,
      );
    }
  }

  const upstreamText = await upstream.text();
  if (upstream.ok && upstreamText.trim() === "Hello world") {
    return c.json(
      {
        ok: false,
        error: "Shortener upstream appears misconfigured",
        detail:
          "Received placeholder response 'Hello world'. Verify SHORTENER_SERVICE points to fusou-url-shorter and the worker is deployed.",
      },
      502,
    );
  }

  let upstreamJson: Record<string, unknown> | null = null;
  try {
    upstreamJson = JSON.parse(upstreamText) as Record<string, unknown>;
  } catch {
    upstreamJson = null;
  }

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Shortener upstream error",
        status: upstream.status,
        detail:
          typeof upstreamJson?.error === "string"
            ? upstreamJson.error
            : upstreamText.slice(0, 300),
      }),
      {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const shortUrl =
    upstreamJson && typeof upstreamJson.shortUrl === "string"
      ? upstreamJson.shortUrl.trim()
      : "";

  if (!shortUrl) {
    return c.json(
      {
        ok: false,
        error: "Shortener upstream response format invalid",
        detail: upstreamText.slice(0, 300),
      },
      502,
    );
  }

  return c.json({ ok: true, shortUrl }, 200);
});

export default app;
