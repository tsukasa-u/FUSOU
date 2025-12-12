/**
 * Security utility functions for OAuth flow
 */

/**
 * Validates if a redirect URL is safe to use
 * Allows:
 * 1. OAuth callbacks to the configured site URL (/api/*)
 * 2. Tauri custom protocol (fusou://)
 * 3. localhost URLs for local development
 */
export function validateRedirectUrl(
  redirectUrl: string,
  allowedOrigin: string
): boolean {
  try {
    // Handle custom protocol URLs (fusou://) which don't work with standard URL constructor
    if (redirectUrl.startsWith("fusou://")) {
      // Extract the path portion and validate it
      const pathMatch = redirectUrl.match(/^fusou:\/\/([^?#]*)/);
      if (pathMatch && pathMatch[1] === "auth") {
        return true;
      }
      return false;
    }

    const url = new URL(redirectUrl);
    const allowed = new URL(allowedOrigin);

    // Allow localhost for local development/testing
    if (
      import.meta.env.DEV &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.pathname.startsWith("/api/")
    ) {
      return true;
    }

    // For web app callbacks, validate against allowed origin
    // Check protocol (must be https in production)
    if (
      import.meta.env.PROD &&
      url.protocol !== "https:" &&
      (url.hostname == "localhost" || url.hostname == "127.0.0.1")
    ) {
      return false;
    }

    // Check host matches exactly
    if (url.host !== allowed.host) {
      return false;
    }

    // Check path starts with /api/ (OAuth callbacks only)
    if (!url.pathname.startsWith("/api/")) {
      return false;
    }

    return true;
  } catch {
    // Invalid URL format
    return false;
  }
}

/**
 * Validates Origin or Referer header for CSRF protection
 */
export function validateOrigin(
  request: Request,
  allowedOrigin: string
): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  console.log("[validateOrigin] allowedOrigin:", allowedOrigin);
  console.log("[validateOrigin] request origin header:", origin);
  console.log("[validateOrigin] request referer header:", referer);

  try {
    const allowed = new URL(allowedOrigin);
    console.log("[validateOrigin] allowed.host:", allowed.host);

    // Check Origin header first (more reliable)
    if (origin) {
      const originUrl = new URL(origin);
      console.log("[validateOrigin] originUrl.host:", originUrl.host);
      const matches = originUrl.host === allowed.host;
      console.log("[validateOrigin] origin matches:", matches);
      return matches;
    }

    // Fallback to Referer header
    if (referer) {
      const refererUrl = new URL(referer);
      console.log("[validateOrigin] refererUrl.host:", refererUrl.host);
      const matches = refererUrl.host === allowed.host;
      console.log("[validateOrigin] referer matches:", matches);
      return matches;
    }

    // No origin or referer header - reject for security
    console.log(
      "[validateOrigin] No origin or referer header found - rejecting"
    );
    return false;
  } catch (e) {
    console.error("[validateOrigin] Exception:", e);
    return false;
  }
}

/**
 * Sanitize error messages to prevent information disclosure
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (import.meta.env.DEV) {
    // In development, show detailed errors
    return error instanceof Error ? error.message : String(error);
  }

  // In production, return generic error
  return "Authentication failed. Please try again.";
}

/**
 * Cookie options with security hardening
 */
export const SECURE_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: import.meta.env.PROD,
  sameSite: "strict" as const,
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

/**
 * Short-lived cookie options for temporary data
 */
export const TEMPORARY_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: import.meta.env.PROD,
  sameSite: "strict" as const,
  maxAge: 60 * 15, // 15 minutes
};
