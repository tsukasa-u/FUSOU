import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  const current = new URL(request.url);
  const target = new URL(`/share/short/${encodeURIComponent(params.key ?? "")}`, current.origin);
  target.search = current.search;

  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "cache-control": "no-store",
      Vary: "User-Agent",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
};