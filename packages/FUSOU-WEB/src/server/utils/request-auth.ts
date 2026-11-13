import { validateOrigin } from "../../utils/security";
import { isAllowedHost, parseAllowedHosts } from "./host-allowlist";

const SUPABASE_ACCESS_TOKEN_COOKIE_RE =
  /(?:^|;\s*)(?:sb-access-token|__Secure-sb-access-token)=([^;]+)/;

/** Extracts and URI-decodes the Supabase access token from a Cookie header. */
export function extractSupabaseAccessTokenFromCookie(
  cookieHeader: string | undefined,
): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(SUPABASE_ACCESS_TOKEN_COOKIE_RE);
  const rawToken = match?.[1];
  if (!rawToken) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawToken);
  } catch {
    decoded = rawToken;
  }

  const trimmed = decoded.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Validates Origin/Referer for cookie-authenticated mutating requests (CSRF defense). */
export function isCookieMutationOriginValid(
  request: Request,
  siteUrl: string | undefined,
  allowedHostsRaw?: string,
): boolean {
  const trimmedSiteUrl = siteUrl?.trim();
  if (!trimmedSiteUrl) return false;

  let siteOrigin: URL;
  try {
    siteOrigin = new URL(trimmedSiteUrl);
  } catch {
    return false;
  }

  if (validateOrigin(request, siteOrigin.origin)) {
    return true;
  }

  const allowedHosts = new Set(parseAllowedHosts(allowedHostsRaw));
  if (allowedHosts.size === 0) return false;

  const candidateUrl = (headerValue: string | null): URL | null => {
    if (!headerValue) return null;
    try {
      return new URL(headerValue);
    } catch {
      return null;
    }
  };

  const originHeader = request.headers.get("origin");
  if (originHeader && originHeader !== "null") {
    const parsedOrigin = candidateUrl(originHeader);
    return (
      parsedOrigin !== null &&
      parsedOrigin.protocol === siteOrigin.protocol &&
      isAllowedHost(parsedOrigin.hostname, allowedHosts)
    );
  }

  const parsedReferer = candidateUrl(request.headers.get("referer"));
  return (
    parsedReferer !== null &&
    parsedReferer.protocol === siteOrigin.protocol &&
    isAllowedHost(parsedReferer.hostname, allowedHosts)
  );
}
