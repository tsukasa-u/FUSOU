/** @jsxImportSource solid-js */
import { AlertMessage } from "@/components/common/solid/AlertMessage";
import { FusouModal } from "@/components/common/solid/FusouModal";
import { MasterDataStatusAlert } from "./MasterDataStatusAlert";
import { createSignal, Show, For } from "solid-js";

import { applyFleetSnapshot, applyExportedFleet } from "@/features/simulator/snapshot";
import { hasSnapshotData } from "@/features/simulator/simulator-selectors";
import { renderAll } from "@/features/simulator/airbase-renderer";
import { loadMasterDataFromJson } from "@/features/simulator/data-loader";
import { finalizePlaygroundLoad } from "@/features/simulator/io-handlers";
import { authFetch } from "@/utils/authFetch";
import { z } from "zod";
import {
  detectResponseKind,
  stripSvdataPrefix,
  convertPortToSnapshot,
  convertRequireInfoToSnapshot,
  convertGetDataToMasterData,
  mergeSnapshots,
} from "@/features/simulator/api-response-parser";

export const dataImportModalRef: { current: HTMLDialogElement | null } = { current: null };

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

export function DataImportModal() {
  const [activeTab, setActiveTab] = createSignal<"r2" | "paste">("r2");

  // --- R2 State ---
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
            ? body.data.error ?? "認証が必要です。FUSOU-APPとの接続状況を確認してください。"
            : "認証が必要です。FUSOU-APPとの接続状況を確認してください。",
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
        dataImportModalRef.current?.close();
      } else {
        alert("スナップショットの読込に失敗しました");
      }
    } catch {
      alert("読込エラー");
    }
  };

  // --- API Paste State ---
  const [portText, setPortText] = createSignal("");
  const [requireText, setRequireText] = createSignal("");
  const [masterText, setMasterText] = createSignal("");

  const [portStatus, setPortStatus] = createSignal<{ msg: string; type: "info" | "success" | "error" }>({ msg: "", type: "info" });
  const [requireStatus, setRequireStatus] = createSignal<{ msg: string; type: "info" | "success" | "error" }>({ msg: "", type: "info" });
  const [masterStatus, setMasterStatus] = createSignal<{ msg: string; type: "info" | "success" | "error" }>({ msg: "", type: "info" });

  const tryParseJson = (
    raw: string,
    setter: (status: { msg: string; type: "info" | "success" | "error" }) => void,
  ): Record<string, unknown> | null => {
    if (!raw.trim()) return null;
    try {
      const parsed: unknown = JSON.parse(stripSvdataPrefix(raw));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setter({ msg: "JSONオブジェクトではありません", type: "error" });
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      setter({ msg: "JSONのパースに失敗しました", type: "error" });
      return null;
    }
  };

  const handleApplyPaste = () => {
    setPortStatus({ msg: "", type: "info" });
    setRequireStatus({ msg: "", type: "info" });
    setMasterStatus({ msg: "", type: "info" });

    let hadError = false;

    // --- master data ---
    const masterJson = tryParseJson(masterText(), setMasterStatus);
    if (masterJson) {
      const kind = detectResponseKind(masterJson);
      if (kind === "getData") {
        loadMasterDataFromJson(convertGetDataToMasterData(masterJson), renderAll);
        setMasterStatus({ msg: "マスターデータを読み込みました", type: "success" });
        setMasterText("");
      } else if (
        masterJson["mst_ships"] ||
        masterJson["mst_slot_items"] ||
        masterJson["ships"] ||
        masterJson["items"]
      ) {
        loadMasterDataFromJson(masterJson, renderAll);
        setMasterStatus({ msg: "マスターデータを読み込みました", type: "success" });
        setMasterText("");
      } else {
        setMasterStatus({ msg: "不正なマスターデータJSONです", type: "error" });
        hadError = true;
      }
    }

    // --- port / require_info ---
    const portJson = tryParseJson(portText(), setPortStatus);
    const reqJson = tryParseJson(requireText(), setRequireStatus);

    if (portJson || reqJson) {
      let isSnapshotMode = true;
      let pSnap: ReturnType<typeof convertPortToSnapshot> | null = null;
      let rSnap: ReturnType<typeof convertRequireInfoToSnapshot> | null = null;

      if (portJson) {
        const kind = detectResponseKind(portJson);
        if (kind === "port") {
          pSnap = convertPortToSnapshot(portJson);
          setPortStatus({ msg: "api_portを解析しました", type: "success" });
          setPortText("");
        } else if (kind === "exportedFleet") {
          isSnapshotMode = false;
        } else {
          setPortStatus({ msg: "非対応のJSONです", type: "error" });
          hadError = true;
        }
      }

      if (reqJson) {
        const reqKind = detectResponseKind(reqJson);
        if (reqKind === "requireInfo") {
          rSnap = convertRequireInfoToSnapshot(reqJson);
          setRequireStatus({ msg: "require_infoを解析しました", type: "success" });
          setRequireText("");
        } else {
          setRequireStatus({ msg: "非対応のJSONです", type: "error" });
          hadError = true;
        }
      }

      if (isSnapshotMode && (pSnap || rSnap)) {
        const merged = mergeSnapshots(
          pSnap ?? { s3s: [], d8k: [] },
          rSnap ?? { s8s: [] },
        );
        applyFleetSnapshot(merged);
        finalizePlaygroundLoad(true);
      } else if (!isSnapshotMode && portJson) {
        applyExportedFleet(portJson);
        finalizePlaygroundLoad(hasSnapshotData());
      }
    }

    if (!hadError) {
      setTimeout(() => {
        dataImportModalRef.current?.close();
      }, 600);
    }
  };

  return (
    <FusouModal
      id="data-import-modal"
      ref={(el) => {
        dataImportModalRef.current = el;
        if (el) {
          const originalShowModal = el.showModal.bind(el);
          el.showModal = () => {
            originalShowModal();
            if (activeTab() === "r2") {
              loadSnapshots();
            }
          };
        }
      }}
      title="データ読込"
      description="保存された艦隊スナップショットの読み込み、またはゲームAPIレスポンスの貼り付けを行います。"
      maxWidth="2xl"
      actions={
        <Show
          when={activeTab() === "paste"}
          fallback={
            <form method="dialog">
              <button class="fusou-btn-primary">閉じる</button>
            </form>
          }
        >
          <div class="flex items-center gap-2">
            <button type="button" class="fusou-btn-primary" onClick={handleApplyPaste}>適用</button>
            <form method="dialog">
              <button class="fusou-btn-ghost">閉じる</button>
            </form>
          </div>
        </Show>
      }
    >
      {/* Master Data Status */}
      <MasterDataStatusAlert />

      {/* Tab Switcher */}
      <div class="flex border-b border-base-300 mb-4 gap-1">
        <button
          type="button"
          class={`px-4 py-2 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab() === "r2"
              ? "border-primary text-primary bg-primary/10 rounded-t-md"
              : "border-transparent text-base-content/60 hover:text-base-content hover:bg-base-200/50 rounded-t-md"
          }`}
          onClick={() => {
            setActiveTab("r2");
            loadSnapshots();
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
          </svg>
          <span>R2クラウド読込</span>
        </button>
        <button
          type="button"
          class={`px-4 py-2 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab() === "paste"
              ? "border-primary text-primary bg-primary/10 rounded-t-md"
              : "border-transparent text-base-content/60 hover:text-base-content hover:bg-base-200/50 rounded-t-md"
          }`}
          onClick={() => setActiveTab("paste")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
          </svg>
          <span>APIレスポンス貼り付け</span>
        </button>
      </div>

      {/* Tab Content Container (固定高さでタブ切り替え時のガタつき・サイズ変動を完全防止) */}
      <div class="h-[295px] flex flex-col overflow-hidden">
        {/* Tab: R2 Cloud Snapshots */}
        <Show when={activeTab() === "r2"}>
          <div class="h-full space-y-2 overflow-y-auto pr-1">
            <Show when={loading()}>
              <div class="flex items-center justify-center p-6">
                <span class="loading loading-spinner loading-md text-primary"></span>
              </div>
            </Show>

            <Show when={requiresAuth()}>
              <div class="text-sm leading-relaxed space-y-3">
                <AlertMessage type="info">
                  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p class="text-xs leading-relaxed text-base-content/80">
                      保存された艦隊データを利用するには、FUSOU-APPとの連携およびWebログインが必要です。
                    </p>
                    <a
                      href="/auth/local/signin?return_to=%2Fsimulator"
                      class="fusou-btn-primary btn-sm shrink-0 whitespace-nowrap text-center"
                    >
                      連携してログイン
                    </a>
                  </div>
                </AlertMessage>

                <div class="space-y-2 pt-1">
                  <div class="flex items-center justify-between text-xs text-base-content/60 font-semibold px-0.5">
                    <span>利用可能なスナップショット（連携後に自動同期）</span>
                    <span class="badge badge-xs badge-ghost">操作プレビュー</span>
                  </div>
                  <div class="border border-base-200/80 rounded-lg overflow-hidden bg-base-200/20">
                    <div class="p-3 flex items-center justify-between gap-3 opacity-60 select-none">
                      <div class="space-y-0.5">
                        <div class="flex items-center gap-2">
                          <span class="font-mono font-medium text-sm text-base-content/90">latest</span>
                          <span class="badge badge-xs badge-info">自動同期</span>
                        </div>
                        <p class="text-xs text-base-content/50">FUSOU-APPで同期された最新の艦・装備・艦隊編成データ</p>
                      </div>
                      <span class="text-xs text-base-content/40 font-medium">ログインで利用可</span>
                    </div>
                  </div>
                  <p class="text-xs text-base-content/50 text-center pt-1">
                    ログインが完了すると、保存された最新スナップショット（latest）が自動取得され、クリックして即座にシミュレータへ読み込むことができます。
                  </p>
                </div>
              </div>
            </Show>

            <Show when={errorMsg()}>
              <p class={`text-sm ${errorMsg() === "保存された艦隊データがありません" ? "text-base-content/40" : "text-error"}`}>
                {errorMsg()}
              </p>
            </Show>

            <Show when={!loading() && !requiresAuth() && entries().length > 0}>
              <div class="divide-y divide-base-200">
                <For each={entries()}>
                  {(entry) => (
                    <button
                      class="fusou-btn-ghost w-full justify-start gap-2 flex py-2.5 px-3 rounded hover:bg-base-200/60 transition-colors"
                      onClick={() => handleApplySnapshot(entry.tag)}
                    >
                      <span class="flex-1 text-left font-medium text-sm">{entry.tag}</span>
                      <span class="text-xs text-base-content/50">
                        {entry.uploaded ? new Date(entry.uploaded).toLocaleString() : ""}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        {/* Tab: API Response Paste */}
        <Show when={activeTab() === "paste"}>
          <div class="h-full space-y-4 overflow-y-auto pr-1">
            <p class="text-xs text-base-content/70">
              各エンドポイントのレスポンスJSONを貼り付けてください。<code class="text-xs bg-base-200 px-1 py-0.5 rounded">svdata=</code>プレフィックス付きでもそのまま貼り付け可能です。
            </p>

            {/* port */}
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="text-xs font-semibold">
                  <code class="text-xs">api_port/port</code>
                  <span class="text-base-content/60 ml-1">（艦・編成）</span>
                </label>
                <span class={portStatus().type === "success" ? "badge badge-success badge-xs font-semibold" : "badge badge-ghost badge-xs"}>
                  {portStatus().type === "success" ? "読込済み" : "未読込"}
                </span>
              </div>
              <textarea
                class="textarea textarea-bordered w-full h-20 font-mono text-xs"
                placeholder="api_port/port のレスポンスJSON..."
                value={portText()}
                onInput={(e) => setPortText(e.currentTarget.value)}
              ></textarea>
              <p class={`text-xs mt-0.5 min-h-[1.2em] ${portStatus().type === "success" ? "text-success" : portStatus().type === "error" ? "text-error" : "text-base-content/60"}`}>
                {portStatus().msg}
              </p>
            </div>

            {/* require_info */}
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="text-xs font-semibold">
                  <code class="text-xs">api_get_member/require_info</code>
                  <span class="text-base-content/60 ml-1">（装備）</span>
                </label>
                <span class={requireStatus().type === "success" ? "badge badge-success badge-xs font-semibold" : "badge badge-ghost badge-xs"}>
                  {requireStatus().type === "success" ? "読込済み" : "未読込"}
                </span>
              </div>
              <textarea
                class="textarea textarea-bordered w-full h-20 font-mono text-xs"
                placeholder="api_get_member/require_info のレスポンスJSON..."
                value={requireText()}
                onInput={(e) => setRequireText(e.currentTarget.value)}
              ></textarea>
              <p class={`text-xs mt-0.5 min-h-[1.2em] ${requireStatus().type === "success" ? "text-success" : requireStatus().type === "error" ? "text-error" : "text-base-content/60"}`}>
                {requireStatus().msg}
              </p>
            </div>

            {/* getData */}
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="text-xs font-semibold">
                  <code class="text-xs">api_start2/getData</code>
                  <span class="text-base-content/60 ml-1">（マスターデータ）</span>
                </label>
                <span class={masterStatus().type === "success" ? "badge badge-success badge-xs font-semibold" : "badge badge-ghost badge-xs"}>
                  {masterStatus().type === "success" ? "読込済み" : "未読込"}
                </span>
              </div>
              <textarea
                class="textarea textarea-bordered w-full h-20 font-mono text-xs"
                placeholder="api_start2/getData のレスポンスJSON..."
                value={masterText()}
                onInput={(e) => setMasterText(e.currentTarget.value)}
              ></textarea>
              <p class={`text-xs mt-0.5 min-h-[1.2em] ${masterStatus().type === "success" ? "text-success" : masterStatus().type === "error" ? "text-error" : "text-base-content/60"}`}>
                {masterStatus().msg}
              </p>
            </div>
          </div>
        </Show>
      </div>
    </FusouModal>
  );
}
