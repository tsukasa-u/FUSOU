/* @jsxImportSource solid-js */
import { createSignal, createEffect } from "solid-js";
import { useStore } from "@nanostores/solid";
import { createShareUrl, copyTextWithFallback } from "@/features/simulator/io-handlers";
import { hasSnapshotData } from "@/features/simulator/simulator-selectors";
import { simulatorDisplayRevision } from "@/features/simulator/state";

export const shareSettingsModalRef: { current: HTMLDialogElement | null } = { current: null };

export function ShareSettingsModal() {
  const displayRev = useStore(simulatorDisplayRevision); // Re-evaluate when things change
  
  const [includeAirbase, setIncludeAirbase] = createSignal(true);
  const [includeDetailedStats, setIncludeDetailedStats] = createSignal(true);
  const [includeSnapshot, setIncludeSnapshot] = createSignal(false);
  const [sharing, setSharing] = createSignal(false);

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
    setSharing(true);
    try {
      const url = await createShareUrl({
        includeAirBases: includeAirbase(),
        includeDetailedStats: includeDetailedStats(),
        includeSnapshotData: includeSnapshot(),
      });
      const copied = await copyTextWithFallback(url);
      if (copied) {
        shareSettingsModalRef.current?.close();
        alert("共有URLをクリップボードにコピーしました");
      } else {
        shareSettingsModalRef.current?.close();
        window.prompt("自動コピーに失敗しました。以下を手動でコピーしてください:", url);
      }
    } catch (e: any) {
      alert(e.message || "共有URLの生成に失敗しました");
    } finally {
      setSharing(false);
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

        <div class="modal-action mt-6">
          <button type="button" class="btn btn-primary btn-sm" disabled={sharing()} onClick={handleShare}>
            {sharing() ? "生成中..." : "URLをコピーして共有"}
          </button>
          <form method="dialog">
            <button class="btn btn-ghost btn-sm" disabled={sharing()}>キャンセル</button>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button disabled={sharing()}>close</button>
      </form>
    </dialog>
  );
}
