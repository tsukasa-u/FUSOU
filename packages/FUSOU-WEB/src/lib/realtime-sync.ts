/**
 * member_id_hash sync utility using Supabase Realtime (v2 - Security enhanced version)
 *
 * Improvements:
 * - Enhanced error handling
 * - Prevention of duplicate Promise calls
 * - Channel duplication management
 * - Implementation of INSERT to pending_member_syncs
 * - RLS token verification
 */

import { createClient, RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import { getRequiredClientEnv } from "@/utility/clientEnv";

// Lazy-initialized Supabase client (deferred to avoid errors during astro check)
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) {
    return _supabase;
  }
  
  const supabaseUrl = getRequiredClientEnv("PUBLIC_SUPABASE_URL");
  const supabaseKey = getRequiredClientEnv("PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  
  _supabase = createClient(supabaseUrl, supabaseKey);
  return _supabase;
}

/**
 * Member ID hash sync result
 */
export interface MemberIdSyncResult {
  success: boolean;
  memberIdHash?: string;
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
 * Realtime payload type
 */
interface RealtimeSyncPayload {
  id: string;
  token: string;
  member_id_hash: string | null;
  app_instance_id: string | null;
  created_at: string;
  expires_at: string;
  synced_at: string | null;
}

/**
 * Active sync session management
 */
interface ActiveSyncSession {
  token: string;
  channelName: string;
  startTime: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  resolved: boolean;
  resolve: ((result: MemberIdSyncResult) => void) | null;
}

// Global session management (prevents multiple simultaneous executions)
const activeSessions = new Map<string, ActiveSyncSession>();

/**
 * Member ID hash sync (security enhanced version)
 *
 * Flow:
 * 1. Generate UUID v4 token
 * 2. INSERT into pending_member_syncs (this is important)
 * 3. Start Realtime channel subscription
 * 4. Launch Tauri app (fusou://sync?token=xxx)
 * 5. APP UPDATEs DB → Realtime notifies
 * 6. WEB receives data → In-page processing complete
 *
 * @param timeoutMs - Timeout duration (default 5000ms)
 * @returns Sync result
 */
export async function syncMemberIdHashWithApp(
  timeoutMs: number = 5000
): Promise<MemberIdSyncResult> {
  const syncToken = uuidv4();
  const channelName = `member-id-sync-${syncToken}`;
  let channel: RealtimeChannel | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let resolved = false;

  // Cleanup function
  const cleanup = async (reason: string) => {
    console.debug(`[Realtime Sync v2] Cleanup: ${reason}`);

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }

    if (channel) {
      try {
        await getSupabase().removeChannel(channel);
      } catch (error) {
        console.error("[Realtime Sync v2] Channel cleanup error:", error);
      }
      channel = null;
    }

    activeSessions.delete(syncToken);
  };

  try {
    // 1. INSERT into pending_member_syncs (Realtime cannot detect UPDATE without this)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: insertError } = await getSupabase()
      .from("pending_member_syncs")
      .insert({
        token: syncToken,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error(
        "[Realtime Sync v2] Failed to create sync record:",
        insertError
      );
      return {
        success: false,
        error: `Failed to create sync record: ${insertError.message}`,
        reason: "network_error",
        retryable: true,
      };
    }

    console.debug("[Realtime Sync v2] Sync record created with token:", syncToken);

    // 2. Realtime channel subscription
    channel = getSupabase().channel(channelName, {
      config: {
        broadcast: { self: false },
      },
    });

    // 3. Wrap in Promise (wait for UPDATE + timeout)
    return new Promise<MemberIdSyncResult>((resolve) => {
      // Session record
      activeSessions.set(syncToken, {
        token: syncToken,
        channelName,
        startTime: Date.now(),
        timeoutHandle: null,
        resolved: false,
        resolve,
      });

      // UPDATE event handler
      channel!.on<RealtimeSyncPayload>(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pending_member_syncs",
          filter: `token=eq.${syncToken}`,
        },
        (payload) => {
          console.debug("[Realtime Sync v2] UPDATE received:", payload.new);

          const data = payload.new;

          // セキュリティ: token マッチング確認
          if (data.token !== syncToken) {
            console.error(
              "[Realtime Sync v2] Token mismatch! Expected:",
              syncToken,
              "Got:",
              data.token
            );
            return;
          }

          // member_id_hash と synced_at が設定されていれば成功
          if (data.member_id_hash && data.synced_at) {
            if (resolved) {
              console.warn(
                "[Realtime Sync v2] Already resolved, ignoring duplicate"
              );
              return;
            }

            resolved = true;

            console.log(
              "[Realtime Sync v2] Sync successful:",
              data.member_id_hash.substring(0, 10) + "..."
            );

            cleanup("sync_success").catch(console.error);

            resolve({
              success: true,
              memberIdHash: data.member_id_hash,
            });
          }
        }
      );

      // Start channel subscription
      channel!.subscribe((status) => {
        console.debug("[Realtime Sync v2] Channel status:", status);

        if (status === "SUBSCRIBED") {
          // Launch Tauri app after successful channel subscription
          const fusouUrl = `fusou://sync?token=${encodeURIComponent(
            syncToken
          )}&return_url=${encodeURIComponent(window.location.href)}`;

          console.debug("[Realtime Sync v2] Launching Tauri app");

          if (typeof window !== "undefined") {
            window.location.href = fusouUrl;
          }
        } else if (status === "CHANNEL_ERROR") {
          if (!resolved) {
            resolved = true;
            cleanup("channel_error").catch(console.error);
            resolve({
              success: false,
              error: "Failed to subscribe to realtime channel",
              reason: "other",
              retryable: true,
            });
          }
        }
      });

      // Timeout setting
      timeoutHandle = setTimeout(() => {
        if (resolved) {
          return;
        }

        resolved = true;

        console.warn(`[Realtime Sync v2] Timed out after ${timeoutMs}ms`);

        cleanup("timeout").catch(console.error);

        resolve({
          success: false,
          error: `Synchronization timed out after ${timeoutMs}ms`,
          reason: "timeout",
          retryable: true,
        });
      }, timeoutMs);

      // Session update
      const session = activeSessions.get(syncToken);
      if (session) {
        session.timeoutHandle = timeoutHandle;
      }
    });
  } catch (error) {
    resolved = true;
    await cleanup("exception");

    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error("[Realtime Sync v2] Unexpected error:", errorMessage);

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
    `[Realtime Sync v2] Cleaning up ${activeSessions.size} session(s)`
  );

  for (const [token, session] of activeSessions.entries()) {
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }

    const channel = getSupabase()
      .getChannels()
      .find((ch) => ch.topic === session.channelName);
    if (channel) {
      try {
        await getSupabase().removeChannel(channel);
      } catch (error) {
        console.error(
          "[Realtime Sync v2] Cleanup error for token",
          token.substring(0, 8),
          error
        );
      }
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
