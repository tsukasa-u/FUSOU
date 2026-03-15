import type { APIRoute } from "astro";
import { createEnvContext, getEnv } from "@/server/utils";

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = locals?.runtime?.env || {};
  const envCtx = createEnvContext({ env: runtimeEnv });
  const shorterBase = getEnv(envCtx, "PUBLIC_URL_SHORTER_BASE")?.trim();
  const shortenerService = runtimeEnv.SHORTENER_SERVICE as
    | Fetcher
    | undefined;

  // Same-origin protection for state-changing request.
  const originHeader = request.headers.get("Origin");
  if (originHeader) {
    const currentOrigin = new URL(request.url).origin;
    if (originHeader !== currentOrigin) {
      return new Response(JSON.stringify({ error: "Invalid request origin" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = (body as { url?: unknown })?.url;
  if (typeof url !== "string" || url.length === 0) {
    return new Response(JSON.stringify({ error: "url is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let upstream: Response;
  try {
    if (shortenerService) {
      upstream = await shortenerService.fetch("https://shortener.internal/api/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
    } else {
      if (!shorterBase) {
        return new Response(
          JSON.stringify({
            error:
              "Server misconfiguration: SHORTENER_SERVICE or PUBLIC_URL_SHORTER_BASE is required",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }

      upstream = await fetch(`${shorterBase.replace(/\/+$/, "")}/api/shorten`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Shortener upstream request failed",
        detail: error instanceof Error ? error.message : String(error),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const upstreamText = await upstream.text();
  return new Response(upstreamText, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
};
