import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { BattleResultComponent } from "../../../components/battles/battle/battle_result";
import { MstShipsContext } from "../../../utility/provider";
import { mst_ships } from "@fusou-testdata-ipc/mst_ships.ts";

const mockBattleWinS: any = {
  cell_id: 1,
  battle_result: {
    win_rank: "S",
    drop_ship_id: 541, // 長波改二
    landing_hp_now: 450,
    landing_hp_max: 450,
    landing_sub_value: 0,
  },
};

const mockBattleWinA: any = {
  cell_id: 2,
  battle_result: {
    win_rank: "A",
    drop_ship_id: 0,
    landing_hp_now: 120,
    landing_hp_max: 300,
  },
};

const meta: Meta<typeof BattleResultComponent> = {
  title: "Components/Battles/BattleResult",
  component: BattleResultComponent,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof BattleResultComponent>;

export const WinRankSWithDrop: Story = {
  render: () => (
    <ul class="menu menu-xs bg-base-100 rounded-box border border-base-300 w-full max-w-lg p-3">
      <MstShipsContext.Provider value={[mst_ships, () => {}]}>
        <BattleResultComponent battle_selected={() => mockBattleWinS} />
      </MstShipsContext.Provider>
    </ul>
  ),
};

export const WinRankA: Story = {
  render: () => (
    <ul class="menu menu-xs bg-base-100 rounded-box border border-base-300 w-full max-w-lg p-3">
      <MstShipsContext.Provider value={[mst_ships, () => {}]}>
        <BattleResultComponent battle_selected={() => mockBattleWinA} />
      </MstShipsContext.Provider>
    </ul>
  ),
};
