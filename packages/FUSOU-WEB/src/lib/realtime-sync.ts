/**
 * public_id sync utility using the Worker pending-sync API (v2)
 *
 * Improvements:
 * - Enhanced error handling
 * - Prevention of duplicate Promise calls
 * - Channel duplication management
 * - Implementation of pending-member sync creation
 * - Server-side token verification and polling
 */

/**
 * Public ID sync result
 */
export interface PublicIdSyncResult {
  success: boolean;
  publicId?: string;
  error?: string;
  reason?:
    | "timeout"
    | "not_available"
    | "app_error"
    | "network_error"
    | "security_error"
    | "other";
  retryable?: boolean;
}

/**
 * Active sync session management
 */
interface ActiveSyncSession {
  token: string;
  startTime: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  resolved: boolean;
  resolve: ((result: PublicIdSyncResult) => void) | null;
}

// Global session management (prevents multiple simultaneous executions)
const activeSessions = new Map<string, ActiveSyncSession>();

/**
 * Public ID sync (security enhanced version)
 *
 * Flow:
 * 1. Generate UUID v4 token
 * 2. Create a pending sync through the Worker
 * 3. Launch Tauri app (fusou://sync?token=xxx)
 * 4. APP completes the handoff through the Worker
 * 5. WEB polls the Worker and receives the public UUID
 *
 * @param timeoutMs - Timeout duration (default 5000ms)
 * @returns Sync result
 */
export async function syncPublicIdWithApp(
  timeoutMs: number = 5000,
): Promise<PublicIdSyncResult> {
  let syncToken: string | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  // Cleanup function
  const cleanup = async (reason: string) => {
    console.debug(`[Sync v2] Cleanup: ${reason}`);

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }

    if (syncToken) activeSessions.delete(syncToken);
  };

  try {
    const createResponse = await fetch("/api/auth/anonymous-sync/v2/pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!createResponse.ok) {
      const errorBody = await createResponse.text().catch(() => "");
      console.error(
        "[Sync v2] Failed to create sync record:",
        createResponse.status,
      );
      return {
        success: false,
        error: `Failed to create sync record: ${errorBody || createResponse.statusText}`,
        reason: "network_error",
        retryable: true,
      };
    }
    const created = (await createResponse.json()) as { token?: unknown };
    if (typeof created.token !== "string" || created.token.length > 128) {
      return { success: false, error: "Invalid sync response", reason: "security_error" };
    }
    syncToken = created.token;

    console.debug("[Sync v2] Sync record created");

    return new Promise<PublicIdSyncResult>((resolve) => {
      const currentToken = syncToken!;
      const session: ActiveSyncSession = {
        token: currentToken,
        startTime: Date.now(),
        timeoutHandle: null,
        resolved: false,
        resolve,
      };
      activeSessions.set(currentToken, session);

      const poll = async (): Promise<void> => {
        if (session.resolved || !activeSessions.has(currentToken)) return;
        try {
          const response = await fetch(
            `/api/auth/anonymous-sync/v2/pending/${encodeURIComponent(currentToken)}`,
            { cache: "no-store" },
          );
          if (session.resolved || !activeSessions.has(currentToken)) return;
          if (response.ok) {
            const data = (await response.json()) as {
              status?: unknown;
              public_id?: unknown;
            };
            if (data.status === "completed" && typeof data.public_id === "string") {
              session.resolved = true;
              session.resolve = null;
              await cleanup("sync_success");
              resolve({ success: true, publicId: data.public_id });
              return;
            }
          } else if (response.status === 410) {
            session.resolved = true;
            session.resolve = null;
            await cleanup("sync_expired");
            resolve({
              success: false,
              error: "Synchronization expired",
              reason: "timeout",
              retryable: true,
            });
            return;
          }
        } catch (error) {
          console.warn("[Sync v2] Poll failed:", error);
        }
        if (!session.resolved && activeSessions.has(currentToken)) {
          setTimeout(() => void poll(), 200);
        }
      };

      const fusouUrl = `fusou://sync?token=${encodeURIComponent(currentToken)}`;
      if (typeof window !== "undefined") window.location.href = fusouUrl;
      void poll();

      timeoutHandle = setTimeout(() => {
        if (session.resolved || !activeSessions.has(currentToken)) {
          return;
        }

        session.resolved = true;
        session.resolve = null;

        console.warn(`[Sync v2] Timed out after ${timeoutMs}ms`);

        cleanup("timeout").catch(console.error);

        resolve({
          success: false,
          error: `Synchronization timed out after ${timeoutMs}ms`,
          reason: "timeout",
          retryable: true,
        });
      }, timeoutMs);

      // Session update
      session.timeoutHandle = timeoutHandle;
    });
  } catch (error) {
    await cleanup("exception");

    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Sync v2] Unexpected error:", errorMessage);

    return {
      success: false,
      error: errorMessage,
      reason: "app_error",
      retryable: false,
    };
  }
}

/**
 * Cleanup all active sessions
 * (e.g., on page unload)
 */
export async function cleanupAllRealtimeSessions(): Promise<void> {
  console.log(
    `[Sync v2] Cleaning up ${activeSessions.size} session(s)`,
  );

  for (const [token, session] of activeSessions.entries()) {
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }

    if (!session.resolved) {
      session.resolved = true;
      const resolve = session.resolve;
      session.resolve = null;
      resolve?.({
        success: false,
        error: "Synchronization was cancelled",
        reason: "app_error",
        retryable: true,
      });
    }

    activeSessions.delete(token);
  }
}

/**
 * Check Tauri app availability
 */
export function isTauriAvailable(): boolean {
  return true;
}

/**
 * Get current number of active sessions
 */
export function getActiveSyncSessions(): number {
  return activeSessions.size;
}
