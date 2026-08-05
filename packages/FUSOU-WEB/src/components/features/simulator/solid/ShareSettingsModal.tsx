/* @jsxImportSource solid-js */
import { createSignal, createEffect } from "solid-js";
import { useStore } from "@nanostores/solid";
import { createShareUrl } from "@/features/simulator/io-handlers";
import { copyToClipboard } from "@/utils/clipboard";
import { hasSnapshotData } from "@/features/simulator/simulator-selectors";
import { simulatorDisplayRevision } from "@/features/simulator/state";

export const shareSettingsModalRef: { current: HTMLDialogElement | null } = { current: null };

export function ShareSettingsModal() {
  const displayRev = useStore(simulatorDisplayRevision); // Re-evaluate when things change
  
  const [includeAirbase, setIncludeAirbase] = createSignal(true);
  const [includeDetailedStats, setIncludeDetailedStats] = createSignal(true);
  const [includeSnapshot, setIncludeSnapshot] = createSignal(false);
  const [shareStatus, setShareStatus] = createSignal<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = createSignal("");

  const snapshotAvailable = () => {
    displayRev(); // Track
    return hasSnapshotData();
  };

  createEffect(() => {
    if (!snapshotAvailable()) {
      setIncludeSnapshot(false);
    }
  });

  const handleShare = async () => {
    setShareStatus("loading");
    setErrorMessage("");
    try {
      const url = await createShareUrl({
        includeAirBases: includeAirbase(),
        includeDetailedStats: includeDetailedStats(),
        includeSnapshotData: includeSnapshot(),
      });
      const copied = copyToClipboard(url);
      if (copied) {
        setShareStatus("success");
        setTimeout(() => {
          shareSettingsModalRef.current?.close();
          setShareStatus("idle");
        }, 1500);
      } else {
        setShareStatus("error");
        window.prompt("自動コピーに失敗しました。以下を手動でコピーしてください:", url);
      }
    } catch (e: any) {
      setShareStatus("error");
      setErrorMessage(e.message || "共有URLの生成に失敗しました");
    }
  };

  return (
    <dialog id="share-settings-modal" class="modal" ref={(el) => shareSettingsModalRef.current = el}>
      <div class="modal-box rounded-xl">
        <h3 class="font-bold text-lg mb-2">共有URL設定</h3>
        <p class="text-xs text-base-content/60 mb-4">
          共有時に含める情報を選択できます。詳細を含めるほど、URL生成が重くなる場合があります。
        </p>

        <div class="space-y-2.5 text-sm">
          <label class="label cursor-pointer justify-start gap-2 py-0">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              checked={includeAirbase()}
              onChange={(e) => setIncludeAirbase(e.currentTarget.checked)}
            />
            <span class="label-text">基地航空隊を含める</span>
          </label>

          <label class="label cursor-pointer justify-start gap-2 py-0">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              checked={includeDetailedStats()}
              onChange={(e) => setIncludeDetailedStats(e.currentTarget.checked)}
            />
            <span class="label-text">艦の詳細ステータス（回避/対潜/索敵の補正値など）を含める</span>
          </label>

          <div>
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                checked={includeSnapshot()}
                disabled={!snapshotAvailable()}
                onChange={(e) => setIncludeSnapshot(e.currentTarget.checked)}
              />
              <span class="label-text">スナップショット情報を含める（艦/装備選択モーダルに反映）</span>
            </label>
            <p class={`text-xs mt-1 ml-7 ${snapshotAvailable() ? "text-base-content/60" : "text-warning"}`}>
              {snapshotAvailable() ? "スナップショット情報を共有に含めます。" : "この編成にはスナップショット情報がないため選択できません。"}
            </p>
          </div>
        </div>

        {errorMessage() && (
          <div class="mt-4 text-xs text-error">
            {errorMessage()}
          </div>
        )}

        <div class="modal-action mt-6">
          <button 
            type="button" 
            class={`btn btn-sm w-48 ${shareStatus() === "success" ? "btn-success" : shareStatus() === "error" ? "btn-error" : "btn-primary"}`}
            disabled={shareStatus() === "loading"} 
            onClick={handleShare}
          >
            {shareStatus() === "loading" ? (
              <>
                <span class="loading loading-spinner loading-xs"></span>
                生成中...
              </>
            ) : shareStatus() === "success" ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                コピー完了
              </>
            ) : shareStatus() === "error" ? (
              "生成失敗"
            ) : (
              "URLをコピーして共有"
            )}
          </button>
          <form method="dialog">
            <button class="btn btn-ghost btn-sm" disabled={shareStatus() === "loading"}>キャンセル</button>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button disabled={shareStatus() === "loading"}>close</button>
      </form>
    </dialog>
  );
}
