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
    const url = new URL(redirectUrl);
    const allowed = new URL(allowedOrigin);

    // Allow Tauri custom protocol for local app
    if (url.protocol === "fusou:") {
      if (url.pathname === "/auth") {
        return true;
      }
      return false;
    }

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

  try {
    const allowed = new URL(allowedOrigin);

    // Check Origin header first (more reliable)
    if (origin) {
      const originUrl = new URL(origin);
      return originUrl.host === allowed.host;
    }

    // Fallback to Referer header
    if (referer) {
      const refererUrl = new URL(referer);
      return refererUrl.host === allowed.host;
    }

    // No origin or referer header - reject for security
    return false;
  } catch {
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
