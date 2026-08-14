/* @jsxImportSource solid-js */
import { createSignal, Show, For } from "solid-js";

import { applyFleetSnapshot } from "@/features/simulator/snapshot";
import { finalizePlaygroundLoad } from "@/features/simulator/io-handlers";
import { authFetch } from "@/utils/authFetch";
import { z } from "zod";

export const loadFleetModalRef: { current: HTMLDialogElement | null } = { current: null };

const SnapshotEntrySchema = z.object({
  tag: z.string(),
  uploaded: z.string(),
  size: z.number(),
});
const SnapshotListResponseSchema = z
  .object({ ok: z.boolean(), tags: z.array(SnapshotEntrySchema) })
  .passthrough();
const SnapshotResponseSchema = z
  .object({ ok: z.literal(true), snapshot: z.record(z.unknown()) })
  .passthrough();
const ErrorResponseSchema = z
  .object({ error: z.string().optional() })
  .passthrough();

type SnapshotEntry = z.infer<typeof SnapshotEntrySchema>;

export function LoadFleetModal() {
  const [loading, setLoading] = createSignal(false);
  const [entries, setEntries] = createSignal<SnapshotEntry[]>([]);
  const [errorMsg, setErrorMsg] = createSignal("");
  const [requiresAuth, setRequiresAuth] = createSignal(false);

  const getAccessToken = () => window.__fusouAccessToken ?? null;

  const loadSnapshots = async () => {
    const token = getAccessToken();
    if (!token) {
      setRequiresAuth(true);
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setEntries([]);

    try {
      const res = await authFetch("/api/fleet/snapshots/list");
      if (res.status === 401 || res.status === 403) {
        const body = ErrorResponseSchema.safeParse(
          await res.json().catch(() => ({})),
        );
        setErrorMsg(body.success ? body.data.error ?? "認証エラー" : "認証エラー");
        return;
      }
      if (!res.ok) {
        setErrorMsg("読込に失敗しました");
        return;
      }
      const data = SnapshotListResponseSchema.safeParse(await res.json());
      if (!data.success) {
        setErrorMsg("読込に失敗しました");
        return;
      }
      if (data.data.tags.length === 0) {
        setErrorMsg("保存された艦隊データがありません");
        return;
      }
      setEntries(data.data.tags);
    } catch {
      setErrorMsg("読込エラー");
    } finally {
      setLoading(false);
    }
  };

  const handleApplySnapshot = async (tag: string) => {
    try {
      const snapRes = await authFetch(`/api/fleet/snapshot/${encodeURIComponent(tag)}`);
      if (snapRes.ok) {
        const result = SnapshotResponseSchema.safeParse(await snapRes.json());
        if (!result.success) {
          alert("スナップショットの読込に失敗しました");
          return;
        }
        applyFleetSnapshot(result.data.snapshot);
        finalizePlaygroundLoad(true);
        loadFleetModalRef.current?.close();
      } else {
        alert("スナップショットの読込に失敗しました");
      }
    } catch {
      alert("読込エラー");
    }
  };

  return (
    <dialog
      id="load-fleet-modal"
      class="modal"
      ref={(el) => {
        loadFleetModalRef.current = el;
        // Listen to native showModal so we can refresh the list every time it's opened.
        if (el) {
          const originalShowModal = el.showModal.bind(el);
          el.showModal = () => {
            originalShowModal();
            loadSnapshots();
          };
        }
      }}
    >
      <div class="modal-box rounded-xl">
        <h3 class="font-bold text-lg mb-2">R2から自分のデッキを読込</h3>
        <p class="text-xs text-base-content/60 mb-4">
          選択したデッキはワークスペースに追加されます。
        </p>

        <div class="space-y-2 max-h-80 overflow-y-auto">
          <Show when={loading()}>
            <span class="loading loading-spinner loading-sm"></span>
          </Show>

          <Show when={requiresAuth()}>
            <p class="text-base-content/60 text-sm">
              この機能を利用するにはFUSOU-APPのスナップショット機能と
              <a href="/auth/local/signin" class="link link-primary mx-1">ローカルアプリ連携</a>
              と
              <a href="/auth/signin" class="link link-primary mx-1">Webサービス連携</a>
              が必要です
            </p>
          </Show>

          <Show when={errorMsg()}>
            <p class={`text-sm ${errorMsg() === "保存された艦隊データがありません" ? "text-base-content/40" : "text-error"}`}>
              {errorMsg()}
            </p>
          </Show>

          <Show when={!loading() && !requiresAuth() && entries().length > 0}>
            <For each={entries()}>
              {(entry) => (
                <button
                  class="btn btn-ghost btn-sm w-full justify-start gap-2 flex"
                  onClick={() => handleApplySnapshot(entry.tag)}
                >
                  <span class="flex-1 text-left">{entry.tag}</span>
                  <span class="text-xs text-base-content/40">
                    {entry.uploaded ? new Date(entry.uploaded).toLocaleString() : ""}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>

        <div class="modal-action">
          <form method="dialog">
            <button class="btn btn-ghost btn-sm">閉じる</button>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}
