import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CustomTitlebar } from "../../components/ui/titlebar";

const meta: Meta<typeof CustomTitlebar> = {
  title: "UI/Window/CustomTitlebar",
  component: CustomTitlebar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    isMaximized: false,
  },
};

export default meta;
type Story = StoryObj<typeof CustomTitlebar>;

export const FloatingWindow: Story = {
  args: {
    isMaximized: false,
  },
  render: (args) => (
    <div class="p-6 bg-base-300 min-h-[200px] flex flex-col justify-start">
      <div class="text-xs mb-2 font-mono text-base-content/60">
        Windowed Mode (floating with rounded-t-[10px]):
      </div>
      <div class="w-full max-w-4xl shadow-2xl rounded-t-[10px] overflow-hidden border border-base-content/10">
        <CustomTitlebar isMaximized={args.isMaximized} />
        <div class="bg-base-100 p-4 text-xs">
          Window Content Area (Simulated Desktop App Body)
        </div>
      </div>
    </div>
  ),
};

export const MaximizedWindow: Story = {
  args: {
    isMaximized: true,
  },
  render: (args) => (
    <div class="w-full bg-base-100 min-h-[200px]">
      <CustomTitlebar isMaximized={args.isMaximized} />
      <div class="p-4 text-xs text-base-content/70">
        Maximized Mode (Flat 0px edges touching monitor borders):
      </div>
    </div>
  ),
};
