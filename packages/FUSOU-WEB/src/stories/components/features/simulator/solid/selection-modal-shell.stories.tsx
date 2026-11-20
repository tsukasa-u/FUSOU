/** @jsxImportSource solid-js */
import { StorybookModalPreview } from "../../../../storybook-fixtures";
import { SelectionModalShell } from "../../../../../components/features/simulator/solid/selection-modal-shell";

function SelectionModalShellPreview() {
  let dialog: HTMLDialogElement | null = null;

  return (
    <StorybookModalPreview dialog={() => dialog}>
      <SelectionModalShell
        id="storybook-selection-shell"
        dialogRef={(element) => {
          dialog = element;
        }}
        boxClass="w-[min(96vw,48rem)]"
      >
        <header class="border-b border-base-200 px-4 py-3">
          <h2 class="font-semibold">艦娘を選択</h2>
          <p class="text-xs text-base-content/60">
            第1艦隊 1番艦 · 現在: 赤城
          </p>
        </header>
        <div class="space-y-2 p-4">
          <p class="text-sm text-base-content/70">
            SelectionModalShell は選択画面のダイアログ枠を提供します。
            フィルターや行の内容は利用側が配置します。
          </p>
          <div class="divide-y divide-base-200 rounded-lg border border-base-200">
            <button type="button" class="w-full p-3 text-left hover:bg-base-200/50">
              赤城 · 正規空母 · 現在の選択
            </button>
            <button type="button" class="w-full p-3 text-left hover:bg-base-200/50">
              金剛 · 戦艦
            </button>
            <button type="button" class="w-full p-3 text-left hover:bg-base-200/50">
              夕立改二 · 駆逐艦
            </button>
          </div>
        </div>
      </SelectionModalShell>
    </StorybookModalPreview>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/selection-modal-shell",
  component: SelectionModalShell,
  tags: ["autodocs"],
};

export const Default = {
  render: () => <SelectionModalShellPreview />,
};
