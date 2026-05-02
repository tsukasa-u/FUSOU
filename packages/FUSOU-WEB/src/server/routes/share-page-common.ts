import {
  buildSocialPreviewHtml,
  isSocialPreviewBot,
} from "@/server/utils/share-preview";

type SharePreviewOptions = {
  title: string;
  description: string;
  cacheControl?: string;
};

export function buildShareBadRequestResponse(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

export function buildShareRedirectResponse(targetUrl: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: targetUrl,
      "cache-control": "no-store",
      Vary: "User-Agent",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

export function buildSharePreviewResponse(
  requestUrl: URL,
  targetUrl: string,
  options: SharePreviewOptions,
): Response {
  const html = buildSocialPreviewHtml({
    title: options.title,
    description: options.description,
    requestUrl: requestUrl.toString(),
    targetUrl,
    imageUrl: new URL("/favicon.svg", requestUrl.origin).toString(),
  });

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": options.cacheControl ?? "no-store",
      Vary: "User-Agent",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "content-security-policy":
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
  });
}

export function buildSharePageResponse(
  request: Request,
  targetUrl: string,
  options: SharePreviewOptions,
): Response {
  const ua = request.headers.get("user-agent") ?? "";
  if (!isSocialPreviewBot(ua)) {
    return buildShareRedirectResponse(targetUrl);
  }

  return buildSharePreviewResponse(new URL(request.url), targetUrl, options);
}
