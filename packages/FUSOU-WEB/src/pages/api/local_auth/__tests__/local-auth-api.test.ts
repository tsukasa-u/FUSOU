import { beforeEach, describe, expect, it, vi } from "vitest";
import { env as mockWorkersEnv } from "cloudflare:workers";

const {
  mockValidateOriginDetailed,
  mockValidateRedirectUrl,
  mockSanitizeErrorMessage,
  mockSignInWithOAuth,
  mockExchangeCodeForSession,
  mockSelect,
  mockUpsert,
  mockFrom,
} = vi.hoisted(() => {
  const mockValidateOriginDetailed = vi.fn();
  const mockValidateRedirectUrl = vi.fn();
  const mockSanitizeErrorMessage = vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  );

  const mockSignInWithOAuth = vi.fn();
  const mockExchangeCodeForSession = vi.fn();
  const mockSelect = vi.fn();
  const mockUpsert = vi.fn(() => ({ select: mockSelect }));
  const mockFrom = vi.fn(() => ({ upsert: mockUpsert }));

  return {
    mockValidateOriginDetailed,
    mockValidateRedirectUrl,
    mockSanitizeErrorMessage,
    mockSignInWithOAuth,
    mockExchangeCodeForSession,
    mockSelect,
    mockUpsert,
    mockFrom,
  };
});

vi.mock("@/utility/security", () => ({
  validateOriginDetailed: mockValidateOriginDetailed,
  validateRedirectUrl: mockValidateRedirectUrl,
  sanitizeErrorMessage: mockSanitizeErrorMessage,
  TEMPORARY_COOKIE_OPTIONS: {
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 300,
  },
  SECURE_COOKIE_OPTIONS: {
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    maxAge: 300,
  },
}));

vi.mock("@/utility/supabaseServer", () => ({
  createSupabaseServerClient: vi.fn(() => ({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
    from: mockFrom,
  })),
}));

import { POST as signInPost } from "../signin";
import { GET as callbackGet } from "../callback";
import { GET as appRedirectGet } from "../app-redirect";

function createCookieJar(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn((key: string) => {
      const value = store.get(key);
      return value === undefined ? undefined : { value };
    }),
    set: vi.fn((key: string, value: string | number) => {
      store.set(key, String(value));
    }),
    delete: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
}

function redirect(location: string | URL): Response {
  const target = typeof location === "string" ? location : location.toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
    },
  });
}

describe("local_auth API handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    Object.keys(mockWorkersEnv as Record<string, unknown>).forEach((key) => {
      delete (mockWorkersEnv as Record<string, unknown>)[key];
    });

    mockValidateOriginDetailed.mockReturnValue({
      ok: true,
      reason: null,
      parsedOrigin: null,
      parsedRefererOrigin: null,
      allowedOrigins: [],
    });
    mockValidateRedirectUrl.mockReturnValue(true);
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: "https://example.com/oauth/google" },
      error: null,
    });
    mockExchangeCodeForSession.mockResolvedValue({
      data: {
        session: {
          access_token: "access-token",
          refresh_token: "refresh-token",
          provider_token: "provider-token",
          provider_refresh_token: "provider-refresh-token",
          expires_at: 1234567890,
          user: { id: "user-123" },
        },
      },
      error: null,
    });
    mockSelect.mockResolvedValue({ error: null });
  });

  it("POST /api/local_auth/signin returns 500 when PUBLIC_SITE_URL is missing", async () => {
    const cookies = createCookieJar();
    const request = new Request("https://fusou.dev/api/local_auth/signin", {
      method: "POST",
      body: new URLSearchParams({ provider: "google" }),
    });

    const res = await signInPost({ request, cookies, redirect } as any);

    expect(res.status).toBe(500);
  });

  it("POST /api/local_auth/signin redirects to provider when request is valid", async () => {
    (mockWorkersEnv as Record<string, unknown>).PUBLIC_SITE_URL =
      "https://fusou.dev";

    const cookies = createCookieJar();
    const request = new Request(
      "https://fusou.dev/api/local_auth/signin?app_origin=tauri",
      {
        method: "POST",
        body: new URLSearchParams({ provider: "google" }),
      },
    );

    const res = await signInPost({ request, cookies, redirect } as any);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/oauth/google");
    expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1);
    expect(cookies.set).toHaveBeenCalledWith(
      "sb-local-provider",
      "google",
      expect.any(Object),
    );
  });

  it("POST /api/local_auth/signin rejects unsupported provider", async () => {
    (mockWorkersEnv as Record<string, unknown>).PUBLIC_SITE_URL =
      "https://fusou.dev";

    const cookies = createCookieJar();
    const request = new Request("https://fusou.dev/api/local_auth/signin", {
      method: "POST",
      body: new URLSearchParams({ provider: "github" }),
    });

    const res = await signInPost({ request, cookies, redirect } as any);

    expect(res.status).toBe(400);
  });

  it("GET /api/local_auth/callback returns 400 when code is missing", async () => {
    const cookies = createCookieJar();
    const res = await callbackGet({
      url: new URL("https://fusou.dev/api/local_auth/callback"),
      cookies,
      redirect,
    } as any);

    expect(res.status).toBe(400);
  });

  it("GET /api/local_auth/callback stores local session cookies and redirects", async () => {
    const cookies = createCookieJar({ "sb-local-provider": "google" });
    const res = await callbackGet({
      url: new URL(
        "https://fusou.dev/api/local_auth/callback?code=abc123&app_origin=tauri",
      ),
      cookies,
      redirect,
    } as any);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/auth/local/callback");
    expect(res.headers.get("location")).toContain("app_origin=tauri");
    expect(cookies.set).toHaveBeenCalledWith(
      "sb-local-access-token",
      "access-token",
      expect.any(Object),
    );
    expect(cookies.set).toHaveBeenCalledWith(
      "sb-local-refresh-token",
      "refresh-token",
      expect.any(Object),
    );
  });

  it("GET /api/local_auth/app-redirect falls back to signin when cookie is missing", async () => {
    const cookies = createCookieJar();
    const res = await appRedirectGet({
      cookies,
      url: new URL("https://fusou.dev/api/local_auth/app-redirect"),
    } as any);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://fusou.dev/auth/local/signin");
  });

  it("GET /api/local_auth/app-redirect rejects invalid redirect target", async () => {
    mockValidateRedirectUrl.mockReturnValue(false);

    const cookies = createCookieJar({
      "sb-app-redirect-url": "https://malicious.example.com",
    });

    const res = await appRedirectGet({
      cookies,
      url: new URL("https://fusou.dev/api/local_auth/app-redirect"),
    } as any);

    expect(res.status).toBe(400);
    expect(cookies.delete).toHaveBeenCalledWith("sb-app-redirect-url", {
      path: "/api/local_auth/app-redirect",
    });
  });

  it("GET /api/local_auth/app-redirect redirects to valid deep link", async () => {
    const redirectTarget = "fusou://auth?token=abc";
    const cookies = createCookieJar({
      "sb-app-redirect-url": redirectTarget,
    });

    const res = await appRedirectGet({
      cookies,
      url: new URL("https://fusou.dev/api/local_auth/app-redirect"),
    } as any);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(redirectTarget);
    expect(cookies.delete).toHaveBeenCalledWith("sb-app-redirect-url", {
      path: "/api/local_auth/app-redirect",
    });
  });
});
