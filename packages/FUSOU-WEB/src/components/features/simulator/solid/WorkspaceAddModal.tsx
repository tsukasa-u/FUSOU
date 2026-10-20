/** @jsxImportSource solid-js */
import { FusouModal } from "@/components/common/solid/FusouModal";
import { createSignal, createEffect, Show } from "solid-js";
import { useStore } from "@nanostores/solid";
import { workspaceStore, addEntry, upsertEntry, type ViewerEntry } from "@/features/simulator/viewer-workspace";
import { saveCurrentStateToEntry, activateWorkspaceEntry, createOwnDeckFromCurrentState } from "@/features/simulator/io-handlers";
import { resolveShareInput } from "@/features/simulator/share-resolver";
import { hasSnapshotData } from "@/features/simulator/simulator-selectors";

export const workspaceAddModalRef: { current: HTMLDialogElement | null } = { current: null };
export const workspaceEditTarget = createSignal<ViewerEntry | null>(null);

export type WorkspaceModalMode = "saveCurrent" | "addUrl" | "edit";
export const workspaceModalMode = createSignal<WorkspaceModalMode>("saveCurrent");

export function WorkspaceAddModal() {
  const ws = useStore(workspaceStore);
  const [target, setTarget] = workspaceEditTarget;
  const [mode, setMode] = workspaceModalMode;
  
  const [label, setLabel] = createSignal("");
  const [memo, setMemo] = createSignal("");
  const [shareUrl, setShareUrl] = createSignal("");
  const [processing, setProcessing] = createSignal(false);

  createEffect(() => {
    const m = mode();
    const entry = target();

    if (m === "edit" && entry) {
      setLabel(entry.name || "");
      setMemo(entry.memo || "");
      setShareUrl(entry.sourceType === "simulatorUrl" || entry.sourceType === "shareKey" ? entry.sourceValue : "");
    } else if (m === "saveCurrent") {
      const now = new Date();
      const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
      const defaultName = hasSnapshotData()
        ? `編成 (${timeStr})`
        : "新しいデッキ";
      setLabel(defaultName);
      setMemo("");
      setShareUrl("");
    } else {
      // addUrl
      setLabel("");
      setMemo("");
      setShareUrl("");
    }
  });

  const modalTitle = () => {
    const m = mode();
    if (m === "saveCurrent") return "現在の編成をワークスペースに保存";
    if (m === "addUrl") return "共有URLをワークスペースに追加";
    return "ワークスペース項目の編集";
  };

  const modalDescription = () => {
    const m = mode();
    if (m === "saveCurrent") return "現在の編成に名前とメモをつけて、新しいデッキとしてワークスペースに登録します。";
    if (m === "addUrl") return "共有URLまたはキーを取り込んでワークスペースに追加します。";
    if (target()?.locked) return "ロック中の項目は編集できません。";
    return "表示名・メモ・共有URLを更新できます。保存するとこの項目へ切り替えます。";
  };

  const handleConfirm = async () => {
        const m = mode();
    const entry = target();
    const lbl = label().trim();
    const mem = memo().trim().slice(0, 500);
    const url = shareUrl().trim();

    // パターン1: 現在の編成を新規保存 (saveCurrent)
    if (m === "saveCurrent") {
      const finalName = lbl || "自分のデッキ";
      const newEntry = createOwnDeckFromCurrentState(finalName, mem);
      activateWorkspaceEntry(newEntry, true, false);
      workspaceAddModalRef.current?.close();
      setTarget(null);
      return;
    }

    // パターン2: 既存エントリの編集 (edit)
    if (m === "edit" && entry) {
      if (entry.locked) {
        alert("ロック中のデッキは編集できません");
        return;
      }

      if (entry.sourceType === "ownDeck") {
        let payloadSource = entry;
        if (ws().activeId === entry.id) {
          saveCurrentStateToEntry(entry);
          payloadSource = ws().entries.find(e => e.id === entry.id) ?? entry;
        }

        const updated = upsertEntry({
          id: payloadSource.id,
          name: lbl || payloadSource.name,
          memo: mem,
          sourceType: payloadSource.sourceType,
          sourceValue: payloadSource.sourceValue,
          payloadKind: payloadSource.payloadKind,
          payload: payloadSource.payload,
          pinned: payloadSource.pinned,
          locked: payloadSource.locked ?? false,
        });
        activateWorkspaceEntry(updated);
        workspaceAddModalRef.current?.close();
        setTarget(null);
        return;
      }

      // URLエントリの更新
      const updated = upsertEntry({
        id: entry.id,
        name: lbl || entry.name,
        memo: mem,
        sourceType: entry.sourceType,
        sourceValue: entry.sourceValue,
        payloadKind: entry.payloadKind,
        payload: entry.payload,
        pinned: entry.pinned,
        locked: entry.locked ?? false,
      });
      activateWorkspaceEntry(updated);
      workspaceAddModalRef.current?.close();
      setTarget(null);
      return;
    }

    // パターン3: 共有URLの新規追加 (addUrl)
    if (!url) {
      alert("共有URLを入力してください");
      return;
    }

    setProcessing(true);
    try {
      const resolved = await resolveShareInput(url);
      if (!resolved.ok) {
        alert(resolved.error);
        return;
      }
      const newEntry = addEntry({
        name: lbl || resolved.sourceValue.slice(0, 40),
        memo: mem,
        sourceType: resolved.sourceType,
        sourceValue: resolved.sourceValue,
        payloadKind: resolved.payloadKind,
        payload: resolved.payload,
        pinned: false,
      });
      activateWorkspaceEntry(newEntry);
      workspaceAddModalRef.current?.close();
      setTarget(null);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <FusouModal
      id="workspace-add-modal"
      ref={workspaceAddModalRef}
      title={modalTitle()}
      description={modalDescription()}
      
      backdropClick={() => setTarget(null)}
      actions={
        <div class="flex items-center justify-end gap-2 w-full">
          <form method="dialog" class="m-0">
            <button type="button" class="fusou-btn-ghost" onClick={() => {
              workspaceAddModalRef.current?.close();
              setTarget(null);
            }}>キャンセル</button>
          </form>
          <button
            type="button"
            class="fusou-btn-primary"
            onClick={handleConfirm}
            disabled={processing() || (mode() === "edit" && target()?.locked)}
          >
            {mode() === "addUrl" ? "追加して切り替え" : "保存して切り替え"}
          </button>
        </div>
      }
    >
      <div class="space-y-3.5 text-sm">
        {/* 編成名 / 表示名 */}
        <div class="form-control">
          <label class="label py-1">
            <span class="label-text font-semibold">{mode() === "saveCurrent" ? "編成名" : "表示名（任意）"}</span>
          </label>
          <input
            type="text"
            class="input input-bordered input-sm w-full"
            placeholder={mode() === "saveCurrent" ? "例: 2-5水上反撃 / E-3甲ラスダン" : "例: 友軍A / 参考編成"}
            value={label()}
            onInput={(e) => setLabel(e.currentTarget.value)}
            disabled={mode() === "edit" && target()?.locked}
            autofocus
          />
        </div>

        {/* メモ */}
        <div class="form-control">
          <label class="label py-1">
            <span class="label-text font-semibold">メモ（任意）</span>
            <span class="label-text-alt text-base-content/40">{memo().length}/500</span>
          </label>
          <textarea
            class="textarea textarea-bordered textarea-sm w-full min-h-24 leading-relaxed"
            maxlength="500"
            placeholder="例: 制空値380調整。ボス優勢狙い。夜戦火力を重視して魚雷CI艦を後ろに配置。"
            value={memo()}
            onInput={(e) => setMemo(e.currentTarget.value)}
            disabled={mode() === "edit" && target()?.locked}
          ></textarea>
        </div>

        {/* 共有URL or キー (addUrl または URL編集時のみ表示) */}
        <Show when={mode() === "addUrl" || (mode() === "edit" && target()?.sourceType !== "ownDeck")}>
          <div class="form-control">
            <label class="label py-1"><span class="label-text font-semibold">共有URL or キー</span></label>
            <input
              type="text"
              class="input input-bordered input-sm w-full"
              placeholder="https://fusou.dev/share/short/xxxxxxxxxxxxxxxx"
              value={shareUrl()}
              onInput={(e) => setShareUrl(e.currentTarget.value)}
              disabled={mode() === "edit" && (target()?.locked || target()?.sourceType === "ownDeck")}
            />
            <p class="text-xs text-base-content/50 mt-1">
              キーだけ（16桁hex）でも追加できます。
            </p>
          </div>
        </Show>
      </div>
    </FusouModal>
  );
}

