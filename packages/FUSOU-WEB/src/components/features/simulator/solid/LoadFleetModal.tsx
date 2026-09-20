/** @jsxImportSource solid-js */
import { AlertMessage } from "@/components/common/solid/AlertMessage";
import { FusouModal } from "@/components/common/solid/FusouModal";
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
        setErrorMsg(
          body.success
            ? body.data.error ?? "Authentication required. Please check your FUSOU-APP connection."
            : "Authentication required. Please check your FUSOU-APP connection.",
        );
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
    <FusouModal
      id="load-fleet-modal"
      ref={(el) => {
        loadFleetModalRef.current = el;
        if (el) {
          const originalShowModal = el.showModal.bind(el);
          el.showModal = () => {
            originalShowModal();
            loadSnapshots();
          };
        }
      }}
      title="Load My Deck from R2"
      description="The selected deck will be added to the workspace."
      maxWidth="lg"
      actions={
        <form method="dialog">
          <button class="fusou-btn-primary">閉じる</button>
        </form>
      }
    >
        <div class="space-y-2 max-h-80 overflow-y-auto">
          <Show when={loading()}>
            <span class="loading loading-spinner loading-sm"></span>
          </Show>

          <Show when={requiresAuth()}>
            <div class="text-sm leading-relaxed">
              <AlertMessage type="info">
                <div>
                  <p>Using saved fleet data requires FUSOU-APP linking and web service sign-in.</p>
                  <p class="mt-2">Authenticating with Google during FUSOU-APP linking also completes web sign-in.</p>
                  <a href="/auth/local/signin?return_to=%2Fsimulator" class="link link-primary mt-2 inline-block">Link FUSOU-APP and sign in</a>
                </div>
              </AlertMessage>
            </div>
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
                  class="fusou-btn-ghost w-full justify-start gap-2 flex"
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

        </FusouModal>
  );
}
