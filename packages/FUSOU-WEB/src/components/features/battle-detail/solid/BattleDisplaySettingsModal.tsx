/** @jsxImportSource solid-js */
import { FusouModal } from "@/components/common/solid/FusouModal";

type Props = {
  ref: (el: HTMLDialogElement) => void;
  showPhaseSeparators: () => boolean;
  setShowPhaseSeparators: (v: boolean) => void;
};

export default function BattleDisplaySettingsModal(props: Props) {
  return (
    <FusouModal
      ref={props.ref}
      title="表示設定"
      description="タイムラインの表示方法を設定します。"
      actions={
        <form method="dialog">
          <button type="submit" class="fusou-btn-primary">
            閉じる
          </button>
        </form>
      }
    >
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
    </FusouModal>
  );
}
