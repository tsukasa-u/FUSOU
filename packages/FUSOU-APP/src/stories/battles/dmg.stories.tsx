import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { DamageCommonComponent } from "../../components/battles/dmg";

const meta: Meta<typeof DamageCommonComponent> = {
  title: "Components/Battles/Damage",
  component: DamageCommonComponent,
  tags: ["autodocs"],
  args: {
    dmg: 48,
    critical_flag: 1,
  },
};

export default meta;
type Story = StoryObj<typeof DamageCommonComponent>;

export const NormalDamage: Story = {
  args: {
    dmg: 52,
    critical_flag: 1,
  },
  render: (args) => (
    <div class="p-4 bg-base-100 rounded-lg border border-base-300 inline-block font-mono">
      <div class="text-[10px] text-base-content/50 mb-1">
        通常命中 (52 DMG):
      </div>
      <DamageCommonComponent
        dmg={args.dmg}
        critical_flag={args.critical_flag}
      />
    </div>
  ),
};

export const CriticalHit: Story = {
  args: {
    dmg: 284,
    critical_flag: 2,
  },
  render: (args) => (
    <div class="p-4 bg-base-100 rounded-lg border border-base-300 inline-block font-mono">
      <div class="text-[10px] text-base-content/50 mb-1">
        クリティカルヒット (284 DMG):
      </div>
      <DamageCommonComponent
        dmg={args.dmg}
        critical_flag={args.critical_flag}
      />
    </div>
  ),
};

export const ScratchOrZero: Story = {
  args: {
    dmg: 0,
    critical_flag: 0,
  },
  render: (args) => (
    <div class="p-4 bg-base-100 rounded-lg border border-base-300 inline-block font-mono">
      <div class="text-[10px] text-base-content/50 mb-1">
        ミス / カスダメ (0 DMG):
      </div>
      <DamageCommonComponent
        dmg={args.dmg}
        critical_flag={args.critical_flag}
      />
    </div>
  ),
};
