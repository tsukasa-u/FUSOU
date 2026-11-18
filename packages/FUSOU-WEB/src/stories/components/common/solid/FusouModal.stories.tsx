/** @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { StorybookModalPreview } from "../../../storybook-fixtures";
import { FusouModal } from "../../../../components/common/solid/FusouModal";

function FusouModalPreview() {
  let dialog: HTMLDialogElement | null = null;
  const [fleetName, setFleetName] = createSignal("第一遊撃部隊・機動部隊");
  const [saved, setSaved] = createSignal(false);

  return (
    <div class="min-h-screen p-4">
      {saved() && (
        <p role="status" class="alert alert-success">
          編成名を保存しました。
        </p>
      )}
      <StorybookModalPreview dialog={() => dialog}>
        <FusouModal
          ref={(element) => {
            dialog = element;
          }}
          title="編成をワークスペースに保存"
          description="現在の編成に名前を付けて、ワークスペースへ登録します。"
          maxWidth="lg"
          actions={
            <>
              <button
                type="button"
                class="fusou-btn-primary"
                onClick={() => {
                  setSaved(true);
                  dialog?.close();
                }}
              >
                保存
              </button>
              <form method="dialog">
                <button class="fusou-btn-ghost">キャンセル</button>
              </form>
            </>
          }
        >
          <div class="space-y-3">
            <label class="form-control">
              <span class="label-text mb-1 font-semibold">編成名</span>
              <input
                class="input input-bordered input-sm w-full"
                value={fleetName()}
                onInput={(event) => setFleetName(event.currentTarget.value)}
              />
            </label>
            <div class="rounded-lg border border-base-300 p-3 text-sm">
              <p class="font-semibold">{fleetName()}</p>
              <p class="mt-1 text-base-content/60">
                第1艦隊: 赤城・金剛・夕立改二・時雨改二・綾波・雪風
              </p>
            </div>
          </div>
        </FusouModal>
      </StorybookModalPreview>
    </div>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/common/solid/FusouModal",
  component: FusouModal,
  tags: ["autodocs"],
};

export const Default = {
  render: () => <FusouModalPreview />,
};
