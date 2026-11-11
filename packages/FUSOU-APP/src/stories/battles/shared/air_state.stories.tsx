import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AirStateComponent } from "../../../components/battles/shared/air_state";

const meta: Meta<typeof AirStateComponent> = {
  title: "Components/Battles/Shared/AirState",
  component: AirStateComponent,
  tags: ["autodocs"],
  args: {
    air_state: 1,
  },
};

export default meta;
type Story = StoryObj<typeof AirStateComponent>;

export const AirSupremacy: Story = {
  args: {
    air_state: 1, // 制空権確保
  },
  render: (args) => (
    <div class="p-4 bg-base-100 rounded-lg border border-base-300 inline-flex items-center gap-1 font-mono text-xs">
      <AirStateComponent air_state={args.air_state} />
    </div>
  ),
};

export const AirSuperiority: Story = {
  args: {
    air_state: 2, // 航空優勢
  },
  render: (args) => (
    <div class="p-4 bg-base-100 rounded-lg border border-base-300 inline-flex items-center gap-1 font-mono text-xs">
      <AirStateComponent air_state={args.air_state} />
    </div>
  ),
};

export const AirParity: Story = {
  args: {
    air_state: 0, // 航空均衡 (ゲーム画面非表示仕様)
  },
  render: (args) => (
    <div class="p-4 bg-base-100 rounded-lg border border-base-300 inline-flex items-center gap-1 font-mono text-xs">
      <AirStateComponent air_state={args.air_state} />
    </div>
  ),
};

export const AirDenial: Story = {
  args: {
    air_state: 3, // 航空劣勢 (ゲーム画面非表示仕様)
  },
  render: (args) => (
    <div class="p-4 bg-base-100 rounded-lg border border-base-300 inline-flex items-center gap-1 font-mono text-xs">
      <AirStateComponent air_state={args.air_state} />
    </div>
  ),
};

export const AirIncapability: Story = {
  args: {
    air_state: 4, // 制空権喪失
  },
  render: (args) => (
    <div class="p-4 bg-base-100 rounded-lg border border-base-300 inline-flex items-center gap-1 font-mono text-xs">
      <AirStateComponent air_state={args.air_state} />
    </div>
  ),
};
