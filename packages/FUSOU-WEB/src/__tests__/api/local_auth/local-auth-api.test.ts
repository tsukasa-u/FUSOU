import { beforeEach, describe, expect, it, vi } from "vitest";
import { env as mockWorkersEnv } from "cloudflare:workers";

const {
  mockValidateOriginDetailed,
  mockValidateRedirectUrl,
  mockValidateInternalReturnPath,
  mockSanitizeErrorMessage,
  mockSignInWithOAuth,
  mockExchangeCodeForSession,
  mockSelect,
  mockPendingMaybeSingle,
  mockAssociationMaybeSingle,
  mockAssociationUpsert,
  mockPendingDelete,
  mockAdminFrom,
  mockCreateSupabaseServerClient,
  mockCreateSupabaseAdminClient,
} = vi.hoisted(() => {
  const mockValidateOriginDetailed = vi.fn();
  const mockValidateRedirectUrl = vi.fn();
  const mockValidateInternalReturnPath = vi.fn(
    (
      value: string | null | undefined,
      _allowedOrigin: string,
      fallback = "/auth/signin",
    ) => (value?.startsWith("/") && !value.startsWith("//") ? value : fallback),
  );
  const mockSanitizeErrorMessage = vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  );

  const mockSignInWithOAuth = vi.fn();
  const mockExchangeCodeForSession = vi.fn();
  const mockSelect = vi.fn();
  const mockPendingMaybeSingle = vi.fn();
  const mockAssociationMaybeSingle = vi.fn();
  const mockAssociationUpsert = vi.fn(() => ({
    select: () => ({ maybeSingle: mockAssociationMaybeSingle }),
  }));
  const mockPendingDelete = vi.fn();
  const mockCreateSupabaseServerClient = vi.fn(() => ({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
    from: mockFrom,
  }));
  const mockCreateSupabaseAdminClient = vi.fn(() => ({ from: mockAdminFrom }));
  const mockUpsert = vi.fn(() => ({ select: mockSelect }));
  const mockFrom = vi.fn((table: string) => {
    if (table === "pending_member_syncs") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: mockPendingMaybeSingle }),
        }),
        delete: () => ({ eq: mockPendingDelete }),
      };
    }
    if (table === "web_user_member_map") {
      return {
        upsert: mockAssociationUpsert,
      };
    }
    return { upsert: mockUpsert };
  });
  const mockAdminFrom = vi.fn((table: string) => {
    if (table === "pending_member_syncs") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: mockPendingMaybeSingle }),
        }),
        delete: () => ({ eq: mockPendingDelete }),
      };
    }
    if (table === "web_user_member_map") {
      return {
        upsert: mockAssociationUpsert,
      };
    }
    return { upsert: mockUpsert };
  });

  return {
    mockValidateOriginDetailed,
    mockValidateRedirectUrl,
    mockValidateInternalReturnPath,
    mockSanitizeErrorMessage,
    mockSignInWithOAuth,
    mockExchangeCodeForSession,
    mockSelect,
    mockPendingMaybeSingle,
    mockAssociationMaybeSingle,
    mockAssociationUpsert,
    mockPendingDelete,
    mockUpsert,
    mockFrom,
    mockAdminFrom,
    mockCreateSupabaseServerClient,
    mockCreateSupabaseAdminClient,
  };
});

vi.mock("@/utils/security", () => ({
  validateOriginDetailed: mockValidateOriginDetailed,
  validateRedirectUrl: mockValidateRedirectUrl,
  validateInternalReturnPath: mockValidateInternalReturnPath,
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

vi.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: mockCreateSupabaseServerClient,
  createSupabaseAdminClient: mockCreateSupabaseAdminClient,
}));

import { POST as signInPost } from "@/pages/api/local_auth/signin";
import { GET as callbackGet } from "@/pages/api/local_auth/callback";
import { GET as appRedirectGet } from "@/pages/api/local_auth/app-redirect";

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
    mockPendingMaybeSingle.mockResolvedValue({
      data: {
        public_id: "11111111-1111-4111-8111-111111111111",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        synced_at: new Date().toISOString(),
      },
      error: null,
    });
    mockAssociationMaybeSingle.mockResolvedValue({
      data: { public_id: "11111111-1111-4111-8111-111111111111" },
      error: null,
    });
    mockPendingDelete.mockResolvedValue({ error: null });
  });

  it("POST /api/local_auth/signin returns 500 when PUBLIC_SITE_URL is missing", async () => {
    const cookies = createCookieJar();
    const request = new Request("https://fusou.dev/api/local_auth/signin", {
      method: "POST",
      body: new URLSearchParams({ provider: "google" }),
    });

    const res = await signInPost(
      { request, cookies, redirect } as unknown as Parameters<
        typeof signInPost
      >[0],
    );

    expect(res.status).toBe(500);
  });

  it("POST /api/local_auth/signin redirects to provider when request is valid", async () => {
    (mockWorkersEnv as Record<string, unknown>)["PUBLIC_SITE_URL"] =
      "https://fusou.dev";

    const cookies = createCookieJar();
    const request = new Request(
      "https://fusou.dev/api/local_auth/signin?app_origin=tauri",
      {
        method: "POST",
        body: new URLSearchParams({
          provider: "google",
          return_to: "/dashboard/api-keys",
        }),
      },
    );

    const res = await signInPost(
      { request, cookies, redirect } as unknown as Parameters<
        typeof signInPost
      >[0],
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://example.com/oauth/google",
    );
    expect(mockValidateInternalReturnPath).toHaveBeenCalledWith(
      "/dashboard/api-keys",
      "https://fusou.dev",
    );
    expect(mockSignInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        options: expect.objectContaining({
          redirectTo: expect.stringMatching(
            /^https:\/\/fusou\.dev\/api\/local_auth\/callback\?app_origin=tauri&return_to=%2Fdashboard%2Fapi-keys&oauth_flow=[0-9a-f-]{36}$/,
          ),
        }),
      }),
    );
    expect(mockCreateSupabaseServerClient).toHaveBeenCalledWith(
      cookies,
      mockWorkersEnv,
      expect.objectContaining({ storageKey: expect.stringMatching(/^sb-local-auth-/) }),
    );
    expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1);
    expect(cookies.set).toHaveBeenCalledWith(
      "sb-local-provider",
      "google",
      expect.any(Object),
    );
  });

  it("binds each local OAuth callback to its own pending sync and PKCE flow", async () => {
    (mockWorkersEnv as Record<string, unknown>)["PUBLIC_SITE_URL"] =
      "https://fusou.dev";

    const firstCookies = createCookieJar({
      "sb-pending-sync-token": "11111111-1111-4111-8111-111111111111",
    });
    const secondCookies = createCookieJar({
      "sb-pending-sync-token": "22222222-2222-4222-8222-222222222222",
    });
    const request = (returnTo: string) =>
      new Request("https://fusou.dev/api/local_auth/signin", {
        method: "POST",
        body: new URLSearchParams({ provider: "google", return_to: returnTo }),
      });

    await signInPost({
      request: request("/dashboard"),
      cookies: firstCookies,
      redirect,
    } as unknown as Parameters<typeof signInPost>[0]);
    await signInPost({
      request: request("/dashboard/api-keys"),
      cookies: secondCookies,
      redirect,
    } as unknown as Parameters<typeof signInPost>[0]);

    const firstRedirect = mockSignInWithOAuth.mock.calls[0]?.[0].options
      .redirectTo as string;
    const secondRedirect = mockSignInWithOAuth.mock.calls[1]?.[0].options
      .redirectTo as string;
    expect(firstRedirect).not.toContain("pending_sync_token=");
    expect(secondRedirect).not.toContain("pending_sync_token=");
    const firstFlowId = new URL(firstRedirect).searchParams.get("oauth_flow");
    const secondFlowId = new URL(secondRedirect).searchParams.get("oauth_flow");
    expect(firstFlowId).toMatch(/^[0-9a-f-]{36}$/);
    expect(secondFlowId).toMatch(/^[0-9a-f-]{36}$/);
    expect(firstCookies.set).toHaveBeenCalledWith(
      `sb-pending-sync-token-${firstFlowId}`,
      "11111111-1111-4111-8111-111111111111",
      expect.any(Object),
    );
    expect(secondCookies.set).toHaveBeenCalledWith(
      `sb-pending-sync-token-${secondFlowId}`,
      "22222222-2222-4222-8222-222222222222",
      expect.any(Object),
    );
    expect(firstRedirect).not.toBe(secondRedirect);
    expect(firstCookies.set).toHaveBeenCalledWith(
      "sb-local-provider",
      "google",
      expect.any(Object),
    );
  });

  it("POST /api/local_auth/signin rejects unsupported provider", async () => {
    (mockWorkersEnv as Record<string, unknown>)["PUBLIC_SITE_URL"] =
      "https://fusou.dev";

    const cookies = createCookieJar();
    const request = new Request("https://fusou.dev/api/local_auth/signin", {
      method: "POST",
      body: new URLSearchParams({ provider: "github" }),
    });

    const res = await signInPost(
      { request, cookies, redirect } as unknown as Parameters<
        typeof signInPost
      >[0],
    );

    expect(res.status).toBe(400);
  });

  it("GET /api/local_auth/callback returns 400 when code is missing", async () => {
    const cookies = createCookieJar();
    const res = await callbackGet({
      url: new URL("https://fusou.dev/api/local_auth/callback"),
      cookies,
      redirect,
    } as unknown as Parameters<typeof callbackGet>[0]);

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
    } as unknown as Parameters<typeof callbackGet>[0]);

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
    expect(cookies.set).toHaveBeenCalledWith(
      "sb-access-token",
      "access-token",
      expect.any(Object),
    );
    expect(cookies.set).toHaveBeenCalledWith(
      "sb-refresh-token",
      "refresh-token",
      expect.any(Object),
    );
    expect(cookies.set).toHaveBeenCalledWith(
      "sb-provider-token",
      "provider-token",
      expect.any(Object),
    );
    expect(cookies.set).toHaveBeenCalledWith(
      "sb-provider-refresh-token",
      "provider-refresh-token",
      expect.any(Object),
    );
    expect(res.headers.get("location")).toContain("association_error=1");
  });

  it("GET /api/local_auth/callback persists the completed Web association", async () => {
    const cookies = createCookieJar({
      "sb-local-provider": "google",
      "sb-pending-sync-token": "22222222-2222-4222-8222-222222222222",
    });
    const res = await callbackGet({
      url: new URL("https://fusou.dev/api/local_auth/callback?code=abc123"),
      cookies,
      redirect,
    } as unknown as Parameters<typeof callbackGet>[0]);

    expect(res.status).toBe(302);
    expect(mockAdminFrom).toHaveBeenCalledWith("pending_member_syncs");
    expect(mockAdminFrom).toHaveBeenCalledWith("web_user_member_map");
    expect(mockCreateSupabaseAdminClient).toHaveBeenCalledWith(mockWorkersEnv);
    expect(mockAssociationUpsert).toHaveBeenCalledWith(
      {
        user_id: "user-123",
        public_id: "11111111-1111-4111-8111-111111111111",
        updated_at: expect.any(String),
      },
      { onConflict: "user_id,public_id" },
    );
    expect(mockPendingDelete).toHaveBeenCalledWith(
      "token",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(cookies.delete).toHaveBeenCalledWith("sb-pending-sync-token", {
      path: "/",
    });
    expect(res.headers.get("location")).not.toContain("association_error=1");
  });

  it("keeps an uncompleted pending sync available when OAuth wins the race", async () => {
    const cookies = createCookieJar({
      "sb-local-provider": "google",
      "sb-pending-sync-token": "22222222-2222-4222-8222-222222222222",
    });
    mockPendingMaybeSingle.mockResolvedValue({
      data: {
        public_id: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        synced_at: null,
      },
      error: null,
    });

    const res = await callbackGet({
      url: new URL("https://fusou.dev/api/local_auth/callback?code=abc123"),
      cookies,
      redirect,
    } as unknown as Parameters<typeof callbackGet>[0]);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("association_error=1");
    expect(cookies.delete).not.toHaveBeenCalledWith("sb-pending-sync-token", {
      path: "/",
    });
  });

  it("does not fall back to another pending sync in a scoped OAuth flow", async () => {
    const flowId = "33333333-3333-4333-8333-333333333333";
    const cookies = createCookieJar({
      "sb-local-provider": "google",
      "sb-pending-sync-token": "22222222-2222-4222-8222-222222222222",
    });
    const res = await callbackGet({
      url: new URL(
        `https://fusou.dev/api/local_auth/callback?code=abc123&oauth_flow=${flowId}`,
      ),
      cookies,
      redirect,
    } as unknown as Parameters<typeof callbackGet>[0]);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("association_error=1");
    expect(mockPendingMaybeSingle).not.toHaveBeenCalled();
  });

  it("keeps desktop callback credentials isolated per OAuth flow", async () => {
    const flowId = "33333333-3333-4333-8333-333333333333";
    const cookies = createCookieJar({
      "sb-local-provider": "google",
      [`sb-pending-sync-token-${flowId}`]:
        "22222222-2222-4222-8222-222222222222",
    });
    const res = await callbackGet({
      url: new URL(
        `https://fusou.dev/api/local_auth/callback?code=abc123&app_origin=tauri&oauth_flow=${flowId}`,
      ),
      cookies,
      redirect,
    } as unknown as Parameters<typeof callbackGet>[0]);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(`oauth_flow=${flowId}`);
    expect(cookies.set).toHaveBeenCalledWith(
      `sb-local-access-token-${flowId}`,
      "access-token",
      expect.any(Object),
    );
  });

  it("uses the flow-scoped pending sync cookie without a URL token", async () => {
    const flowId = "33333333-3333-4333-8333-333333333333";
    const cookies = createCookieJar({
      "sb-local-provider": "google",
      [`sb-pending-sync-token-${flowId}`]:
        "22222222-2222-4222-8222-222222222222",
    });
    const res = await callbackGet({
      url: new URL(
        `https://fusou.dev/api/local_auth/callback?code=abc123&oauth_flow=${flowId}`,
      ),
      cookies,
      redirect,
    } as unknown as Parameters<typeof callbackGet>[0]);

    expect(res.status).toBe(302);
    expect(mockPendingMaybeSingle).toHaveBeenCalled();
    expect(mockAssociationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-123" }),
      { onConflict: "user_id,public_id" },
    );
  });

  it("GET /api/local_auth/app-redirect falls back to signin when cookie is missing", async () => {
    const cookies = createCookieJar();
    const res = await appRedirectGet({
      cookies,
      url: new URL("https://fusou.dev/api/local_auth/app-redirect"),
    } as unknown as Parameters<typeof appRedirectGet>[0]);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://fusou.dev/auth/local/signin",
    );
  });

  it("GET /api/local_auth/app-redirect rejects invalid redirect target", async () => {
    mockValidateRedirectUrl.mockReturnValue(false);

    const cookies = createCookieJar({
      "sb-app-redirect-url": "https://malicious.example.com",
    });

    const res = await appRedirectGet({
      cookies,
      url: new URL("https://fusou.dev/api/local_auth/app-redirect"),
    } as unknown as Parameters<typeof appRedirectGet>[0]);

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
    } as unknown as Parameters<typeof appRedirectGet>[0]);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(redirectTarget);
    expect(cookies.delete).toHaveBeenCalledWith("sb-app-redirect-url", {
      path: "/api/local_auth/app-redirect",
    });
  });

  it("GET /api/local_auth/app-redirect consumes the flow-scoped cookie", async () => {
    const flowId = "33333333-3333-4333-8333-333333333333";
    const redirectTarget = "fusou://auth?supabase_access_token=token";
    const cookies = createCookieJar({
      [`sb-app-redirect-url-${flowId}`]: redirectTarget,
    });

    const res = await appRedirectGet({
      cookies,
      url: new URL(
        `https://fusou.dev/api/local_auth/app-redirect?oauth_flow=${flowId}`,
      ),
    } as unknown as Parameters<typeof appRedirectGet>[0]);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(redirectTarget);
    expect(cookies.delete).toHaveBeenCalledWith(
      `sb-app-redirect-url-${flowId}`,
      { path: "/api/local_auth/app-redirect" },
    );
  });
});
