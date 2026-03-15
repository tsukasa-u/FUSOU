import type { APIRoute } from "astro";
import { createEnvContext, getEnv } from "@/server/utils";

export const POST: APIRoute = async ({ request, locals }) => {
  const envCtx = createEnvContext({ env: locals?.runtime?.env || {} });
  const shorterBase = getEnv(envCtx, "PUBLIC_URL_SHORTER_BASE")?.trim();

  if (!shorterBase) {
    return new Response(
      JSON.stringify({ error: "Server misconfiguration: PUBLIC_URL_SHORTER_BASE is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

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

  const upstream = await fetch(`${shorterBase.replace(/\/+$/, "")}/api/shorten`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const upstreamText = await upstream.text();
  return new Response(upstreamText, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
};
