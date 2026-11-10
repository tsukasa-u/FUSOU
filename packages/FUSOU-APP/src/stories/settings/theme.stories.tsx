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
    <div class="p-8 min-h-[300px] bg-base-100 flex flex-col items-start gap-4">
      <div>
        <h3 class="text-sm font-semibold mb-1">Theme Controller Dropdown</h3>
        <p class="text-xs text-base-content/60">
          Light / Dark テーマを即時に切り替えるドロップダウンコントローラー。
        </p>
      </div>
      <ThemeControllerComponent />
    </div>
  ),
};
