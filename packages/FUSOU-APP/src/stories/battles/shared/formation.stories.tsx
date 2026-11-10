import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FormationComponent } from "../../../components/battles/shared/formation";

const meta: Meta<typeof FormationComponent> = {
  title: "Components/Battles/Shared/Formation",
  component: FormationComponent,
  tags: ["autodocs"],
  args: {
    formation: [1, 1],
  },
};

export default meta;
type Story = StoryObj<typeof FormationComponent>;

export const LineAheadVsLineAhead: Story = {
  args: {
    formation: [1, 1], // 単縦陣 vs 単縦陣
  },
  render: (args) => (
    <div class="p-4 bg-base-100 rounded-lg border border-base-300 inline-flex items-center gap-1 font-mono text-xs">
      <FormationComponent formation={args.formation} />
    </div>
  ),
};

export const VanguardVsDiamond: Story = {
  args: {
    formation: [6, 3], // 警戒陣 vs 輪形陣
  },
  render: (args) => (
    <div class="p-4 bg-base-100 rounded-lg border border-base-300 inline-flex items-center gap-1 font-mono text-xs">
      <FormationComponent formation={args.formation} />
    </div>
  ),
};

export const CruisingFormations: Story = {
  args: {
    formation: [12, 11], // 第2警戒航行序列 vs 第1警戒航行序列
  },
  render: (args) => (
    <div class="p-4 bg-base-100 rounded-lg border border-base-300 inline-flex items-center gap-1 font-mono text-xs">
      <FormationComponent formation={args.formation} />
    </div>
  ),
};
