import type { APIRoute } from "astro";
import {
  buildSocialPreviewHtml,
  isSocialPreviewBot,
} from "@/server/utils/share-preview";
import { buildDescription } from "@/server/routes/share-short-page";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const current = new URL(request.url);
  const ua = request.headers.get("User-Agent") ?? "";

  if (isSocialPreviewBot(ua)) {
    const dataParam = current.searchParams.get("data");
    const description = dataParam
      ? buildDescription(dataParam)
      : "艦隊編成を確認する";
    const targetUrl = new URL("/simulator", current.origin);
    targetUrl.search = current.search;
    return new Response(
      buildSocialPreviewHtml({
        title: "FUSOU 編成シミュレータ - 共有編成",
        description,
        requestUrl: request.url,
        targetUrl: targetUrl.toString(),
        imageUrl: `${current.origin}/favicon.svg`,
        redirectUrl: targetUrl.toString(),
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

  const target = new URL("/simulator", current.origin);
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
