/** @jsxImportSource solid-js */
/**
 * Member ID Sync ボタンコンポーネント
 * 
 * Tauri アプリとリアルタイムで member_id_hash を同期
 * - ページ遷移なし
 * - Realtime 通知で即座に更新
 * - エラー時は詳細なメッセージ表示
 */

import { createSignal, onCleanup, onMount } from "solid-js";
import { syncMemberIdHashWithApp, cleanupAllRealtimeSessions } from "../../lib/realtime-sync";

interface MemberIdSyncButtonProps {
  onSuccess?: (memberIdHash: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

export function MemberIdSyncButton(props: MemberIdSyncButtonProps) {
  const [isSyncing, setIsSyncing] = createSignal(false);
  const [syncStatus, setSyncStatus] = createSignal<{
    type: "success" | "error" | null;
    message: string;
  }>({ type: null, message: "" });
  const [memberIdHash, setMemberIdHash] = createSignal<string | null>(null);

  // ページ離脱時のクリーンアップ
  onMount(() => {
    const handleBeforeUnload = () => {
      // 非同期処理は beforeunload では完了を保証できないが、
      // ベストエフォートでクリーンアップを試みる
      cleanupAllRealtimeSessions().catch(() => {});
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    onCleanup(() => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // コンポーネントアンマウント時もクリーンアップ
      cleanupAllRealtimeSessions().catch(() => {});
    });
  });

  const handleSync = async () => {
    // 二重クリック防止
    if (isSyncing()) {
      console.warn("[MemberIdSyncButton] Sync already in progress, ignoring");
      return;
    }

    setIsSyncing(true);
    setSyncStatus({ type: null, message: "" });

    try {
      console.log("[MemberIdSyncButton] Starting sync...");

      const result = await syncMemberIdHashWithApp(5000);

      if (result.success && result.memberIdHash) {
        setMemberIdHash(result.memberIdHash);
        setSyncStatus({
          type: "success",
          message: `✅ 同期成功: ${result.memberIdHash.substring(0, 8)}...`,
        });

        // コールバック実行
        props.onSuccess?.(result.memberIdHash);

        // 3秒後にメッセージをクリア
        setTimeout(() => {
          setSyncStatus({ type: null, message: "" });
        }, 3000);
      } else {
        const errorMessage = getErrorMessage(result.reason, result.error);
        setSyncStatus({
          type: "error",
          message: errorMessage,
        });

        props.onError?.(errorMessage);

        // 5秒後にメッセージをクリア
        setTimeout(() => {
          setSyncStatus({ type: null, message: "" });
        }, 5000);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setSyncStatus({
        type: "error",
        message: `❌ エラー: ${errorMessage}`,
      });

      props.onError?.(errorMessage);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div class={`member-id-sync ${props.className || ""}`}>
      <button
        onClick={handleSync}
        disabled={isSyncing()}
        class="btn btn-primary gap-2"
      >
        {isSyncing() ? (
          <>
            <span class="loading loading-spinner loading-sm" />
            同期中...
          </>
        ) : (
          <>
            🔄 ゲームと同期
          </>
        )}
      </button>

      {syncStatus().type && (
        <div
          class={`alert alert-${syncStatus().type === "success" ? "success" : "error"} mt-2`}
        >
          <span>{syncStatus().message}</span>
        </div>
      )}

      {memberIdHash() && (
        <div class="alert alert-info mt-2">
          <span>Member ID: {memberIdHash()}</span>
        </div>
      )}
    </div>
  );
}

/**
 * エラー理由を日本語メッセージに変換
 */
function getErrorMessage(reason?: string, error?: string): string {
  switch (reason) {
    case "timeout":
      return "❌ タイムアウト: ゲームアプリが応答しませんでした。アプリが起動しているか確認してください。";
    case "not_available":
      return "❌ ゲームデータが利用できません。ゲームを一度起動してください。";
    case "app_error":
      return `❌ アプリエラー: ${error || "詳細不明"}`;
    case "network_error":
      return `❌ ネットワークエラー: ${error || "サーバーに接続できませんでした。インターネット接続を確認してください。"}`;
    case "security_error":
      return `❌ セキュリティエラー: ${error || "認証に失敗しました。"}`;
    default:
      return `❌ エラー: ${error || "不明なエラーが発生しました"}`;
  }
}
