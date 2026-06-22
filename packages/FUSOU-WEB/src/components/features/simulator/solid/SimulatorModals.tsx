/* @jsxImportSource solid-js */
import { createSignal, createEffect } from "solid-js";
import { useStore } from "@nanostores/solid";
import { simulatorDisplayRevision } from "@/features/simulator/state";
import {
  isFleetSectionVisible,
  isAirbaseSectionVisible,
  getVisibleAirbaseCount,
  getCombinedFleetType,
  getFleetSlotLayoutMode,
} from "@/features/simulator/simulator-selectors";
import {
  setFleetSectionVisible,
  setAirbaseSectionVisible,
  setVisibleAirbaseCount,
  setCombinedFleetType,
} from "@/features/simulator/simulator-mutations";
import { writeDisplaySettings, setFleetSlotLayoutMode } from "@/features/simulator/airbase-renderer";
import { captureAndSaveImage, type CaptureImageOptions } from "@/features/simulator/image-capture";

import { ShipSelectionModal } from "./ShipSelectionModal";
import { EquipSelectionModal } from "./EquipSelectionModal";
import { ApiPasteModal } from "./ApiPasteModal";
import { ShareSettingsModal } from "./ShareSettingsModal";
import { LoadFleetModal } from "./LoadFleetModal";
import { WorkspaceAddModal } from "./WorkspaceAddModal";

export function SimulatorModals() {
  return (
    <>
      <ShipSelectionModal />
      <EquipSelectionModal />
      <DisplaySettingsModal />
      <SaveImageModal />
      <ApiPasteModal />
      <ShareSettingsModal />
      <LoadFleetModal />
      <WorkspaceAddModal />
    </>
  );
}


export const displaySettingsModalRef: { current: HTMLDialogElement | null } = { current: null };
export const saveImageModalRef: { current: HTMLDialogElement | null } = { current: null };

export function DisplaySettingsModal() {
  const displayRev = useStore(simulatorDisplayRevision);

  const [fleet1, setFleet1] = createSignal(true);
  const [fleet2, setFleet2] = createSignal(true);
  const [fleet3, setFleet3] = createSignal(true);
  const [fleet4, setFleet4] = createSignal(true);
  const [airbase, setAirbase] = createSignal(true);
  const [combined, setCombined] = createSignal<0 | 1 | 2 | 3>(0);
  const [layout, setLayout] = createSignal<"2x3" | "3x2">("2x3");
  const [airbaseCount, setAirbaseCount] = createSignal(3);

  createEffect(() => {
    displayRev(); // react to display settings changes
    setFleet1(isFleetSectionVisible(1));
    setFleet2(isFleetSectionVisible(2));
    setFleet3(isFleetSectionVisible(3));
    setFleet4(isFleetSectionVisible(4));
    setAirbase(isAirbaseSectionVisible());
    setCombined(getCombinedFleetType());
    setLayout(getFleetSlotLayoutMode());
    setAirbaseCount(getVisibleAirbaseCount());
  });

  const handleFleetChange = (i: number, checked: boolean) => {
    setFleetSectionVisible(i, checked);
    writeDisplaySettings();
  };

  const handleAirbaseChange = (checked: boolean) => {
    setAirbaseSectionVisible(checked);
    writeDisplaySettings();
  };

  const handleCombinedChange = (val: number) => {
    const newType = val as 0 | 1 | 2 | 3;
    setCombinedFleetType(newType);
    if (newType > 0 && !isFleetSectionVisible(2)) {
      setFleetSectionVisible(2, true);
    }
    writeDisplaySettings();
  };

  const handleLayoutChange = (val: "2x3" | "3x2") => {
    setFleetSlotLayoutMode(val);
    writeDisplaySettings();
  };

  const handleAirbaseCountChange = (val: number) => {
    setVisibleAirbaseCount(val);
    writeDisplaySettings();
  };

  const close = () => displaySettingsModalRef.current?.close();

  return (
    <dialog id="display-settings-modal" class="modal" ref={(el) => displaySettingsModalRef.current = el}>
      <div class="modal-box rounded-xl">
        <h3 class="font-bold text-lg mb-2">表示設定</h3>
        <p class="text-xs text-base-content/60 mb-4">
          艦隊と基地航空隊の表示を切り替えます。
        </p>
        <div class="space-y-3 text-sm">
          <div class="grid grid-cols-2 gap-2">
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input type="checkbox" class="checkbox checkbox-sm" checked={fleet1()} onChange={(e) => handleFleetChange(1, e.currentTarget.checked)} />
              <span class="label-text">第1艦隊を表示</span>
            </label>
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input type="checkbox" class="checkbox checkbox-sm" checked={fleet2()} onChange={(e) => handleFleetChange(2, e.currentTarget.checked)} />
              <span class="label-text">第2艦隊を表示</span>
            </label>
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input type="checkbox" class="checkbox checkbox-sm" checked={fleet3()} onChange={(e) => handleFleetChange(3, e.currentTarget.checked)} />
              <span class="label-text">第3艦隊を表示</span>
            </label>
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input type="checkbox" class="checkbox checkbox-sm" checked={fleet4()} onChange={(e) => handleFleetChange(4, e.currentTarget.checked)} />
              <span class="label-text">第4艦隊を表示</span>
            </label>
          </div>
          <label class="label cursor-pointer justify-start gap-2 py-0">
            <input type="checkbox" class="checkbox checkbox-sm" checked={airbase()} onChange={(e) => handleAirbaseChange(e.currentTarget.checked)} />
            <span class="label-text">基地航空隊を表示</span>
          </label>
          <div class="form-control">
            <label class="label py-1"><span class="label-text">連合艦隊タイプ</span></label>
            <select id="display-combined-fleet" class="select select-bordered select-sm w-52" value={combined()} onChange={(e) => handleCombinedChange(Number(e.currentTarget.value))}>
              <option value="0">通常艦隊</option>
              <option value="1">機動部隊（第1＋第2）</option>
              <option value="2">水上打撃部隊（第1＋第2）</option>
              <option value="3">輸送護衛部隊（第1＋第2）</option>
            </select>
          </div>
          <div class="form-control">
            <label class="label py-1"><span class="label-text">艦隊内スロット配置</span></label>
            <select id="display-fleet-slot-layout" class="select select-bordered select-sm w-40" value={layout()} onChange={(e) => handleLayoutChange(e.currentTarget.value as "2x3" | "3x2")}>
              <option value="2x3">2x3（縦長）</option>
              <option value="3x2">3x2（横長）</option>
            </select>
          </div>
          <div class="form-control">
            <label class="label py-1"><span class="label-text">表示する基地航空隊数</span></label>
            <select id="display-airbase-count" class="select select-bordered select-sm w-36" value={airbaseCount()} disabled={!airbase()} onChange={(e) => handleAirbaseCountChange(Number(e.currentTarget.value))}>
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-primary btn-sm" onClick={close}>閉じる</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}

export function SaveImageModal() {
  const [target, setTarget] = createSignal<CaptureImageOptions["fleetTarget"]>("both");
  const [includeAirbase, setIncludeAirbase] = createSignal(true);
  const [transparent, setTransparent] = createSignal(false);
  const [scale, setScale] = createSignal(2);
  const [filename, setFilename] = createSignal("fleet-deck");
  const [saving, setSaving] = createSignal(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await captureAndSaveImage({
        fleetTarget: target(),
        includeAirBase: target() === "airbase" ? true : includeAirbase(),
        transparentBackground: transparent(),
        scale: scale(),
        fileBase: filename(),
      });
      saveImageModalRef.current?.close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog id="save-image-modal" class="modal" ref={(el) => saveImageModalRef.current = el}>
      <div class="modal-box rounded-xl">
        <h3 class="font-bold text-lg mb-4">画像保存設定</h3>
        <div class="space-y-3 text-sm">
          <div class="form-control">
            <label class="label py-1"><span class="label-text">保存対象</span></label>
            <div class="flex flex-wrap gap-3">
              {(["both", "fleet1", "fleet2", "fleet3", "fleet4", "airbase"] as const).map((val) => (
                <label class="label cursor-pointer gap-2 py-0">
                  <input type="radio" name="saveimg-fleet-target" class="radio radio-sm" value={val} checked={target() === val} onChange={() => setTarget(val)} />
                  <span class="label-text">
                    {val === "both" ? "第1+第2艦隊" : val === "airbase" ? "航空基地のみ" : `第${val.replace("fleet", "")}艦隊のみ`}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <label class="label cursor-pointer justify-start gap-2 py-0">
            <input type="checkbox" class="checkbox checkbox-sm" checked={includeAirbase()} disabled={target() === "airbase"} onChange={(e) => setIncludeAirbase(e.currentTarget.checked)} />
            <span class="label-text">基地航空隊を含める</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2 py-0">
            <input type="checkbox" class="checkbox checkbox-sm" checked={transparent()} onChange={(e) => setTransparent(e.currentTarget.checked)} />
            <span class="label-text">背景を透過（PNG）</span>
          </label>
          <div class="form-control">
            <label class="label py-1"><span class="label-text">画質倍率</span></label>
            <select class="select select-bordered select-sm" value={scale()} onChange={(e) => setScale(Number(e.currentTarget.value))}>
              <option value="1">標準 (x1)</option>
              <option value="2">高画質 (x2)</option>
              <option value="3">超高画質 (x3)</option>
            </select>
          </div>
          <div class="form-control">
            <label class="label py-1"><span class="label-text">ファイル名</span></label>
            <input type="text" class="input input-bordered input-sm" value={filename()} onInput={(e) => setFilename(e.currentTarget.value)} />
          </div>
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-primary btn-sm" disabled={saving()} onClick={handleSave}>
            {saving() ? "保存中..." : "PNGで保存"}
          </button>
          <form method="dialog">
            <button class="btn btn-ghost btn-sm" disabled={saving()}>キャンセル</button>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button disabled={saving()}>close</button>
      </form>
    </dialog>
  );
}
