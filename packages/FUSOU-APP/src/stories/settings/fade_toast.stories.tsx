import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FadeToast, showFadeToast } from "../../components/settings/fade_toast";

const meta: Meta<typeof FadeToast> = {
  title: "Components/Settings/FadeToast",
  component: FadeToast,
  tags: ["autodocs"],
  args: {
    toast_id: "demo_toast_container",
  },
};

export default meta;
type Story = StoryObj<typeof FadeToast>;

export const Interactive: Story = {
  render: (args) => (
    <div class="p-8 space-y-4 min-h-[240px] bg-base-100">
      <div>
        <h3 class="text-sm font-semibold mb-1">FadeToast Component</h3>
        <p class="text-xs text-base-content/60 mb-3">
          下のボタンをクリックすると、右下に自動消去トースト通知が表示されます。
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          onClick={() => {
            showFadeToast(args.toast_id, "設定を正常に保存しました");
          }}
        >
          保存完了トーストを表示
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onClick={() => {
            showFadeToast(args.toast_id, "新しいマスターデータを受信しました");
          }}
        >
          情報通知トーストを表示
        </button>
      </div>

      <FadeToast toast_id={args.toast_id} />
    </div>
  ),
};
