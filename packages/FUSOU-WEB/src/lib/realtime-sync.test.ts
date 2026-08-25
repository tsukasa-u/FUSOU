import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupAllRealtimeSessions,
  getActiveSyncSessions,
  syncPublicIdWithApp,
} from "./realtime-sync";

describe("realtime sync session cleanup", () => {
  afterEach(async () => {
    await cleanupAllRealtimeSessions();
    vi.restoreAllMocks();
  });

  it("settles an in-flight sync when all sessions are cleaned up", async () => {
    const pollPending = new Promise<Response>(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).includes("/pending/")) {
          return pollPending;
        }
        return Promise.resolve(
          new Response(JSON.stringify({ token: "11111111-1111-4111-8111-111111111111" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    );

    const resultPromise = syncPublicIdWithApp(60_000);
    await vi.waitFor(() => expect(getActiveSyncSessions()).toBe(1));

    await cleanupAllRealtimeSessions();

    await expect(resultPromise).resolves.toEqual({
      success: false,
      error: "Synchronization was cancelled",
      reason: "app_error",
      retryable: true,
    });
    expect(getActiveSyncSessions()).toBe(0);
  });
});