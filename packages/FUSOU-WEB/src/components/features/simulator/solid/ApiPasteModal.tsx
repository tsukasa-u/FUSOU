/* @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { renderAll } from "@/features/simulator/airbase-renderer";
import { loadMasterDataFromJson } from "@/features/simulator/data-loader";
import { applyFleetSnapshot, applyExportedFleet } from "@/features/simulator/snapshot";
import {
  stripSvdataPrefix,
  detectResponseKind,
  convertPortToSnapshot,
  convertRequireInfoToSnapshot,
  convertGetDataToMasterData,
  mergeSnapshots,
} from "@/features/simulator/api-response-parser";
import { finalizePlaygroundLoad } from "@/features/simulator/io-handlers"; // We'll need to export this from io-handlers.ts later
import { hasSnapshotData } from "@/features/simulator/simulator-selectors";

export const apiPasteModalRef: { current: HTMLDialogElement | null } = { current: null };

export function ApiPasteModal() {
  const [portText, setPortText] = createSignal("");
  const [requireText, setRequireText] = createSignal("");
  const [masterText, setMasterText] = createSignal("");

  const [portStatus, setPortStatus] = createSignal<{ msg: string; type: "info" | "success" | "error" }>({ msg: "", type: "info" });
  const [requireStatus, setRequireStatus] = createSignal<{ msg: string; type: "info" | "success" | "error" }>({ msg: "", type: "info" });
  const [masterStatus, setMasterStatus] = createSignal<{ msg: string; type: "info" | "success" | "error" }>({ msg: "", type: "info" });

  const tryParseJson = (raw: string, setter: (s: any) => void) => {
    if (!raw.trim()) return null;
    try {
      return JSON.parse(stripSvdataPrefix(raw));
    } catch {
      setter({ msg: "JSONのパースに失敗しました", type: "error" });
      return null;
    }
  };

  const handleApply = () => {
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
      } else if (masterJson.mst_ships || masterJson.mst_slot_items || masterJson.ships || masterJson.items) {
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
      let pSnap: any = null;
      let rSnap: any = null;

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
        const merged = mergeSnapshots(pSnap ?? {}, rSnap ?? {});
        applyFleetSnapshot(merged);
        finalizePlaygroundLoad(true, true);
      } else if (!isSnapshotMode && portJson) {
        applyExportedFleet(portJson);
        finalizePlaygroundLoad(hasSnapshotData(), true);
      }
    }

    if (!hadError) {
      setTimeout(() => {
        apiPasteModalRef.current?.close();
      }, 600);
    }
  };

  return (
    <dialog id="api-paste-modal" class="modal" ref={(el) => apiPasteModalRef.current = el}>
      <div class="modal-box max-w-2xl">
        <h3 class="font-bold text-lg mb-2">APIレスポンス貼り付け</h3>
        <p class="text-sm text-base-content/60 mb-4">
          各エンドポイントのレスポンスJSONを貼り付けてください。<code class="text-xs">svdata=</code>プレフィックス付きでも使用可能です。
        </p>

        {/* port */}
        <div class="mb-4">
          <div class="flex items-center justify-between mb-1">
            <label class="text-sm font-medium">
              <code class="text-xs">api_port/port</code>
              <span class="text-base-content/50 ml-1">艦・編成</span>
            </label>
            <span class={portStatus().type === "success" ? "badge badge-success badge-sm" : "badge badge-ghost badge-sm"}>
              {portStatus().type === "success" ? "読込済み" : "未読込"}
            </span>
          </div>
          <textarea
            class="textarea textarea-bordered w-full h-24 font-mono text-xs"
            placeholder="api_port/port のレスポンスJSON..."
            value={portText()}
            onInput={(e) => setPortText(e.currentTarget.value)}
          ></textarea>
          <p class={`text-xs mt-1 min-h-[1.2em] ${portStatus().type === "success" ? "text-success" : portStatus().type === "error" ? "text-error" : "text-base-content/60"}`}>
            {portStatus().msg}
          </p>
        </div>

        {/* require_info */}
        <div class="mb-4">
          <div class="flex items-center justify-between mb-1">
            <label class="text-sm font-medium">
              <code class="text-xs">api_get_member/require_info</code>
              <span class="text-base-content/50 ml-1">装備</span>
            </label>
            <span class={requireStatus().type === "success" ? "badge badge-success badge-sm" : "badge badge-ghost badge-sm"}>
              {requireStatus().type === "success" ? "読込済み" : "未読込"}
            </span>
          </div>
          <textarea
            class="textarea textarea-bordered w-full h-24 font-mono text-xs"
            placeholder="api_get_member/require_info のレスポンスJSON..."
            value={requireText()}
            onInput={(e) => setRequireText(e.currentTarget.value)}
          ></textarea>
          <p class={`text-xs mt-1 min-h-[1.2em] ${requireStatus().type === "success" ? "text-success" : requireStatus().type === "error" ? "text-error" : "text-base-content/60"}`}>
            {requireStatus().msg}
          </p>
        </div>

        {/* getData */}
        <div class="mb-4">
          <div class="flex items-center justify-between mb-1">
            <label class="text-sm font-medium">
              <code class="text-xs">api_start2/getData</code>
              <span class="text-base-content/50 ml-1">マスターデータ</span>
            </label>
            <span class={masterStatus().type === "success" ? "badge badge-success badge-sm" : "badge badge-ghost badge-sm"}>
              {masterStatus().type === "success" ? "読込済み" : "未読込"}
            </span>
          </div>
          <textarea
            class="textarea textarea-bordered w-full h-24 font-mono text-xs"
            placeholder="api_start2/getData のレスポンスJSON..."
            value={masterText()}
            onInput={(e) => setMasterText(e.currentTarget.value)}
          ></textarea>
          <p class={`text-xs mt-1 min-h-[1.2em] ${masterStatus().type === "success" ? "text-success" : masterStatus().type === "error" ? "text-error" : "text-base-content/60"}`}>
            {masterStatus().msg}
          </p>
        </div>

        <div class="modal-action">
          <button type="button" class="btn btn-primary btn-sm" onClick={handleApply}>適用</button>
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
