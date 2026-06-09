/** @jsxImportSource solid-js */

type Props = {
  ref: (el: HTMLDialogElement) => void;
  showPhaseSeparators: () => boolean;
  setShowPhaseSeparators: (v: boolean) => void;
};

export default function BattleDisplaySettingsModal(props: Props) {
  return (
    <dialog ref={props.ref} class="modal">
      <div class="modal-box w-11/12 max-w-md rounded-xl bg-base-100">
        <h3 class="font-bold text-lg mb-1">表示設定</h3>
        <p class="text-xs text-base-content/60 mb-4">
          タイムラインの表示方法を設定します。
        </p>
        <div class="space-y-3 text-sm">
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                checked={props.showPhaseSeparators()}
                onInput={(e) =>
                  props.setShowPhaseSeparators(e.currentTarget.checked)
                }
              />
              <span class="label-text font-medium">
                フェーズ間の空白行を表示
              </span>
            </label>
          </div>
        </div>
        <div class="modal-action">
          <form method="dialog">
            <button type="submit" class="btn btn-primary btn-sm">
              閉じる
            </button>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button type="submit" aria-label="閉じる"></button>
      </form>
    </dialog>
  );
}
