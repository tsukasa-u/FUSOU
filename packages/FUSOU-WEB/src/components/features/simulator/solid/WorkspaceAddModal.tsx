/* @jsxImportSource solid-js */
import { createSignal, createEffect } from "solid-js";
import { useStore } from "@nanostores/solid";
import { workspaceStore, addEntry, upsertEntry, type ViewerEntry } from "@/features/simulator/viewer-workspace";
import { createOwnDeckFromCurrentState, saveCurrentStateToEntry, activateWorkspaceEntry } from "@/features/simulator/io-handlers";
import { resolveShareInput } from "@/features/simulator/share-resolver";

export const workspaceAddModalRef: { current: HTMLDialogElement | null } = { current: null };
export const workspaceEditTarget = createSignal<ViewerEntry | null>(null);

export function WorkspaceAddModal() {
  const ws = useStore(workspaceStore);
  const [target, setTarget] = workspaceEditTarget;
  
  const [label, setLabel] = createSignal("");
  const [memo, setMemo] = createSignal("");
  const [shareUrl, setShareUrl] = createSignal("");
  const [processing, setProcessing] = createSignal(false);

  createEffect(() => {
    const entry = target();
    if (entry) {
      setLabel(entry.name || "");
      setMemo(entry.memo || "");
      setShareUrl(entry.sourceType === "simulatorUrl" || entry.sourceType === "shareKey" ? entry.sourceValue : "");
    } else {
      setLabel("");
      setMemo("");
      setShareUrl("");
    }
  });

  const handleConfirm = async () => {
    const entry = target();
    const lbl = label().trim();
    const mem = memo().trim().slice(0, 300);
    const url = shareUrl().trim();

    if (entry?.sourceType === "ownDeck") {
      if (entry.locked) {
        alert("ロック中のデッキは編集できません");
        return;
      }
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

    if (!url) {
      if (!entry) {
        const newEntry = createOwnDeckFromCurrentState(lbl, mem);
        activateWorkspaceEntry(newEntry);
        workspaceAddModalRef.current?.close();
        setTarget(null);
        return;
      }
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
      const newEntry = entry
        ? upsertEntry({
            id: entry.id,
            name: lbl || resolved.sourceValue.slice(0, 40),
            memo: mem,
            sourceType: resolved.sourceType,
            sourceValue: resolved.sourceValue,
            payloadKind: resolved.payloadKind,
            payload: resolved.payload,
            pinned: false,
          })
        : addEntry({
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
    <dialog id="workspace-add-modal" class="modal" ref={(el) => workspaceAddModalRef.current = el}>
      <div class="modal-box rounded-xl">
        <h3 class="font-bold text-lg mb-2">
          {target() ? "ワークスペース項目の編集" : "ワークスペースに追加"}
        </h3>
        <p class="text-xs text-base-content/60 mb-4">
          {target()
            ? target()!.locked ? "ロック中の項目は編集できません。" : "表示名・メモ・共有URLを更新できます。保存するとこの項目へ切り替えます。"
            : "共有URL（/share/short/xxxx or /share/data?data=...）を追加できます。URLを空欄のまま保存すると、現在の編成を自分のデッキとして追加します。"}
        </p>

        <div class="space-y-3 text-sm">
          <div class="form-control">
            <label class="label py-1"><span class="label-text">表示名（任意）</span></label>
            <input
              type="text"
              class="input input-bordered input-sm"
              placeholder="例: 友軍A / E-5破砕編成"
              value={label()}
              onInput={(e) => setLabel(e.currentTarget.value)}
              disabled={target()?.locked}
            />
          </div>

          <div class="form-control">
            <label class="label py-1"><span class="label-text">メモ（任意）</span></label>
            <textarea
              class="textarea textarea-bordered textarea-sm min-h-20"
              maxlength="300"
              placeholder="例: 対潜重視。夜戦火力が不足しがち"
              value={memo()}
              onInput={(e) => setMemo(e.currentTarget.value)}
              disabled={target()?.locked}
            ></textarea>
          </div>

          <div class="form-control">
            <label class="label py-1"><span class="label-text">共有URL or キー</span></label>
            <input
              type="text"
              class="input input-bordered input-sm"
              placeholder="https://fusou.dev/share/short/xxxxxxxxxxxxxxxx"
              value={shareUrl()}
              onInput={(e) => setShareUrl(e.currentTarget.value)}
              disabled={target()?.locked || target()?.sourceType === "ownDeck"}
            />
            <p class="text-xs text-base-content/50 mt-1">
              キーだけ（16桁hex）でも追加できます。
            </p>
          </div>
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            onClick={handleConfirm}
            disabled={processing() || target()?.locked}
          >
            {target() ? "保存して切り替え" : "追加して切り替え"}
          </button>
          <form method="dialog">
            <button class="btn btn-ghost btn-sm" onClick={() => setTarget(null)}>キャンセル</button>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button onClick={() => setTarget(null)}>close</button>
      </form>
    </dialog>
  );
}
