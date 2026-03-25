/** @jsxImportSource solid-js */
import type { OfficialMapThemeMode } from "./types";
import { parseOfficialMapThemeMode } from "./dataUtils";
import type { BattleMapTheme } from "@/data/battleMapAssets";

type Props = {
  ref: (el: HTMLDialogElement) => void;
  showOfficialMapAssets: () => boolean;
  setShowOfficialMapAssets: (v: boolean) => void;
  officialMapThemeMode: () => OfficialMapThemeMode;
  setOfficialMapThemeMode: (v: OfficialMapThemeMode) => void;
  resolvedOfficialMapTheme: () => BattleMapTheme;
};

export default function DisplaySettingsModal(props: Props) {
  return (
    <dialog ref={props.ref} class="modal">
      <div class="modal-box w-11/12 max-w-md rounded-xl bg-base-100">
        <h3 class="font-bold text-lg mb-2">表示設定</h3>
        <p class="text-xs text-base-content/60 mb-4">マップの表示方法を変更できます。</p>
        <div class="space-y-3 text-sm">
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                checked={props.showOfficialMapAssets()}
                onInput={(e) => props.setShowOfficialMapAssets(e.currentTarget.checked)}
              />
              <span class="label-text">海域背景画像を表示</span>
            </label>
          </div>
          <div class="form-control gap-1">
            <label class="label py-0">
              <span class="label-text text-xs">海域背景画像の配色</span>
            </label>
            <select
              class="select select-bordered select-sm w-full"
              value={props.officialMapThemeMode()}
              onInput={(e) => props.setOfficialMapThemeMode(parseOfficialMapThemeMode(e.currentTarget.value))}
            >
              <option value="auto">
                自動 (現在: {props.resolvedOfficialMapTheme() === "dark" ? "ダーク" : "ライト"})
              </option>
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
            </select>
          </div>
        </div>
        <div class="modal-action">
          <form method="dialog">
            <button type="submit" class="btn btn-primary btn-sm">閉じる</button>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button type="submit" aria-label="閉じる"></button>
      </form>
    </dialog>
  );
}
