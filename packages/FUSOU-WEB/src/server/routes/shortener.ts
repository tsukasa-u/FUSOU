import { Hono } from "hono";
import type { Bindings } from "@/server/types";

const app = new Hono<{ Bindings: Bindings }>();

app.post("/", async (c) => {
  const shorterBase = c.env.PUBLIC_URL_SHORTER_BASE?.trim();
  const shortenerService = c.env.SHORTENER_SERVICE;

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

  let upstream: Response;
  try {
    if (shortenerService) {
      upstream = await shortenerService.fetch(
        "https://shortener.internal/api/shorten",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        },
      );
    } else {
      if (!shorterBase) {
        return c.json(
          {
            ok: false,
            error:
              "Server misconfiguration: SHORTENER_SERVICE or PUBLIC_URL_SHORTER_BASE is required",
          },
          500,
        );
      }

      upstream = await fetch(`${shorterBase.replace(/\/+$/, "")}/api/shorten`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
    }
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

  const upstreamText = await upstream.text();
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
