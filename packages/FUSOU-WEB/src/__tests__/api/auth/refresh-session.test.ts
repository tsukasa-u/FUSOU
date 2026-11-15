import { beforeEach, describe, expect, it, vi } from "vitest";
import { env as mockWorkersEnv } from "cloudflare:workers";

const { mockRefreshSession, mockCreateSupabaseServerClient } = vi.hoisted(() => {
  const mockRefreshSession = vi.fn();
  const mockCreateSupabaseServerClient = vi.fn(() => ({
    auth: {
      refreshSession: mockRefreshSession,
    },
  }));
  return { mockRefreshSession, mockCreateSupabaseServerClient };
});

vi.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: mockCreateSupabaseServerClient,
}));

import { POST } from "@/pages/api/auth/refresh_session";

function createCookieJar(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const setCalls: Array<{
    name: string;
    value: string;
    options?: Record<string, unknown>;
  }> = [];

  return {
    get: vi.fn((key: string) => {
      const value = store.get(key);
      return value === undefined ? undefined : { value };
    }),
    set: vi.fn(
      (
        key: string,
        value: string | number,
        options?: Record<string, unknown>,
      ) => {
        const stringValue = String(value);
        store.set(key, stringValue);
        setCalls.push(
          options === undefined
            ? { name: key, value: stringValue }
            : { name: key, value: stringValue, options },
        );
      },
    ),
    delete: vi.fn((key: string) => {
      store.delete(key);
    }),
    store,
    setCalls,
  };
}

describe("POST /api/auth/refresh_session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockWorkersEnv as Record<string, unknown>).forEach((key) => {
      delete (mockWorkersEnv as Record<string, unknown>)[key];
    });
    (mockWorkersEnv as Record<string, unknown>)["PUBLIC_SITE_URL"] =
      "https://fusou.example";
  });

  it("updates HttpOnly sb-access-token and sb-refresh-token cookies without leaking tokens in JSON", async () => {
    mockRefreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: "fresh-access-jwt",
          refresh_token: "fresh-refresh-token",
        },
      },
      error: null,
    });

    const cookies = createCookieJar({
      "sb-access-token": "expired-access-jwt",
      "sb-refresh-token": "old-refresh-token",
    });

    const response = await POST({
      request: new Request("https://fusou.example/api/auth/refresh_session", {
        method: "POST",
        headers: { Origin: "https://fusou.example" },
      }),
      cookies: cookies as never,
    } as never);

    expect(response.status).toBe(200);
    expect(mockRefreshSession).toHaveBeenCalledWith({
      refresh_token: "old-refresh-token",
    });

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true });
    expect("access_token" in body).toBe(false);

    expect(cookies.store.get("sb-access-token")).toBe("fresh-access-jwt");
    expect(cookies.store.get("sb-refresh-token")).toBe("fresh-refresh-token");
    expect(cookies.setCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "sb-access-token",
          value: "fresh-access-jwt",
          options: expect.objectContaining({
            httpOnly: true,
            sameSite: "lax",
            path: "/",
          }),
        }),
        expect.objectContaining({
          name: "sb-refresh-token",
          value: "fresh-refresh-token",
          options: expect.objectContaining({
            httpOnly: true,
            sameSite: "lax",
            path: "/",
          }),
        }),
      ]),
    );
  });

  it("rejects mismatched Origin before touching Supabase", async () => {
    const cookies = createCookieJar({
      "sb-refresh-token": "old-refresh-token",
    });

    const response = await POST({
      request: new Request("https://fusou.example/api/auth/refresh_session", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      }),
      cookies: cookies as never,
    } as never);

    expect(response.status).toBe(403);
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });
});
