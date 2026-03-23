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

    // Check full origin matches exactly (scheme + host + port)
    if (url.origin !== allowed.origin) {
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
  allowedOrigins: string | string[]
): boolean {
  return validateOriginDetailed(request, allowedOrigins).ok;
}

export type OriginValidationResult = {
  ok: boolean;
  reason:
    | "allowed_origin_invalid"
    | "origin_match"
    | "origin_mismatch"
    | "origin_invalid"
    | "referer_match"
    | "referer_mismatch"
    | "referer_invalid"
    | "origin_and_referer_missing";
  allowedOrigins: string[];
  requestOrigin: string | null;
  requestReferer: string | null;
  parsedOrigin: string | null;
  parsedRefererOrigin: string | null;
};

/**
 * Same as validateOrigin(), but returns details for diagnostics.
 */
export function validateOriginDetailed(
  request: Request,
  allowedOrigins: string | string[]
): OriginValidationResult {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  try {
    const originList = Array.isArray(allowedOrigins)
      ? allowedOrigins
      : [allowedOrigins];
    const normalizedAllowedOrigins = originList
      .map((value) => {
        try {
          return new URL(value).origin;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is string => Boolean(entry));

    const allowedOriginSet = new Set(
      normalizedAllowedOrigins,
    );

    if (allowedOriginSet.size === 0) {
      return {
        ok: false,
        reason: "allowed_origin_invalid",
        allowedOrigins: normalizedAllowedOrigins,
        requestOrigin: origin,
        requestReferer: referer,
        parsedOrigin: null,
        parsedRefererOrigin: null,
      };
    }

    // Check Origin header first (more reliable).
    // If Origin is present but malformed (e.g., "null"), do not fail immediately;
    // fall back to Referer validation.
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (allowedOriginSet.has(originUrl.origin)) {
          return {
            ok: true,
            reason: "origin_match",
            allowedOrigins: normalizedAllowedOrigins,
            requestOrigin: origin,
            requestReferer: referer,
            parsedOrigin: originUrl.origin,
            parsedRefererOrigin: null,
          };
        }
        return {
          ok: false,
          reason: "origin_mismatch",
          allowedOrigins: normalizedAllowedOrigins,
          requestOrigin: origin,
          requestReferer: referer,
          parsedOrigin: originUrl.origin,
          parsedRefererOrigin: null,
        };
      } catch {
        // Fall through to Referer validation only if present.
        if (!referer) {
          return {
            ok: false,
            reason: "origin_invalid",
            allowedOrigins: normalizedAllowedOrigins,
            requestOrigin: origin,
            requestReferer: referer,
            parsedOrigin: null,
            parsedRefererOrigin: null,
          };
        }
      }
    }

    // Fallback to Referer header
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        if (allowedOriginSet.has(refererUrl.origin)) {
          return {
            ok: true,
            reason: "referer_match",
            allowedOrigins: normalizedAllowedOrigins,
            requestOrigin: origin,
            requestReferer: referer,
            parsedOrigin: null,
            parsedRefererOrigin: refererUrl.origin,
          };
        }
        return {
          ok: false,
          reason: "referer_mismatch",
          allowedOrigins: normalizedAllowedOrigins,
          requestOrigin: origin,
          requestReferer: referer,
          parsedOrigin: null,
          parsedRefererOrigin: refererUrl.origin,
        };
      } catch {
        return {
          ok: false,
          reason: "referer_invalid",
          allowedOrigins: normalizedAllowedOrigins,
          requestOrigin: origin,
          requestReferer: referer,
          parsedOrigin: null,
          parsedRefererOrigin: null,
        };
      }
    }

    // No origin or referer header - reject for security
    return {
      ok: false,
      reason: "origin_and_referer_missing",
      allowedOrigins: normalizedAllowedOrigins,
      requestOrigin: origin,
      requestReferer: referer,
      parsedOrigin: null,
      parsedRefererOrigin: null,
    };
  } catch {
    return {
      ok: false,
      reason: "allowed_origin_invalid",
      allowedOrigins: [],
      requestOrigin: origin,
      requestReferer: referer,
      parsedOrigin: null,
      parsedRefererOrigin: null,
    };
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
