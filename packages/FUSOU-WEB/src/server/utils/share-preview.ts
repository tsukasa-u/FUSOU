const SOCIAL_PREVIEW_BOT_UA =
  /discordbot|twitterbot|slackbot-linkexpanding|facebookexternalhit|linkedinbot|whatsapp|telegrambot|line\//i;

type SocialPreviewHtmlOptions = {
  title: string;
  description: string;
  requestUrl: string;
  targetUrl: string;
  imageUrl?: string;
  siteName?: string;
  lang?: string;
  redirectUrl?: string;
};

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function isSocialPreviewBot(userAgent: string): boolean {
  return SOCIAL_PREVIEW_BOT_UA.test(userAgent);
}

export function buildSocialPreviewHtml(
  options: SocialPreviewHtmlOptions,
): string {
  const safeTitle = escHtml(options.title);
  const safeDescription = escHtml(options.description);
  const safeRequestUrl = escHtml(options.requestUrl);
  const safeTargetUrl = escHtml(options.targetUrl);
  const safeSiteName = escHtml(options.siteName ?? "FUSOU");
  const safeLang = escHtml(options.lang ?? "ja");
  const safeImageUrl = options.imageUrl ? escHtml(options.imageUrl) : null;
  const safeRedirectUrl = options.redirectUrl
    ? escHtml(options.redirectUrl)
    : null;

  return `<!DOCTYPE html>
<html lang="${safeLang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${safeTitle}</title>
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${safeSiteName}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:url" content="${safeRequestUrl}" />
  ${safeImageUrl ? `<meta property="og:image" content="${safeImageUrl}" />` : ""}
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  ${safeImageUrl ? `<meta name="twitter:image" content="${safeImageUrl}" />` : ""}
  ${safeRedirectUrl ? `<meta http-equiv="refresh" content="0;url=${safeRedirectUrl}" />` : ""}
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    <p>${safeDescription}</p>
    <p><a href="${safeTargetUrl}" rel="noopener noreferrer nofollow">詳細ページを開く</a></p>
  </main>
</body>
</html>`;
}
