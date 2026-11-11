import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ThemeControllerComponent } from "../../components/settings/theme";

const meta: Meta<typeof ThemeControllerComponent> = {
  title: "Components/Settings/ThemeController",
  component: ThemeControllerComponent,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ThemeControllerComponent>;

export const Default: Story = {
  render: () => (
    <div class="p-8 bg-base-100 flex flex-col items-start gap-4">
      <div>
        <h3 class="text-sm font-semibold mb-1">Titlebar Theme Toggle</h3>
        <p class="text-xs text-base-content/60">
          Light / Dark テーマをワンクリックで切り替えるタイトルバーボタン。
        </p>
      </div>
      <div class="h-8 px-2.5 rounded-lg bg-[#27272a] text-[#f1f5f9] inline-flex items-center gap-2">
        <span class="text-[11px] font-semibold opacity-80">FUSOU Titlebar</span>
        <ThemeControllerComponent />
      </div>
    </div>
  ),
};
