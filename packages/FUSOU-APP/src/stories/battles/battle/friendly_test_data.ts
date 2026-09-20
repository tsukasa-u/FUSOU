import type { Cells } from "@ipc-bindings/cells";
import type { Battle, FriendlyForceAttack } from "@ipc-bindings/battle";
import { cells_3_5 } from "@fusou-testdata-ipc/3-5/cells.ts";

export const mock_friendly_force_attack: FriendlyForceAttack = {
  fleet_info: {
    ship_id: [537, 538, 532], // 涼月改, 冬月改, 涼月
    ship_lv: [99, 98, 95],
    now_hps: [37, 37, 36],
    max_hps: [37, 37, 37],
    params: [
      [59, 89, 116, 52],
      [58, 88, 115, 51],
      [54, 84, 110, 48],
    ],
    slot: [
      [122, 122, 101], // 10cm連装高角砲+高射装置, 10cm連装高角砲+高射装置, 照明弾
      [122, 122, -1],
      [122, 122, -1],
    ],
    slot_ex: [0, 0, 0],
  },
  support_hourai: {
    flare_pos: [0, -1], // 友軍1隻目が照明弾発射, 敵はなし
    hougeki: {
      at_list: [0, 1], // 涼月改が攻撃, 冬月改が攻撃
      df_list: [
        [0, 0], // 涼月改が敵0に連撃(2回攻撃)
        [1], // 冬月改が敵1に攻撃
      ],
      cl_list: [
        [2, 1], // クリティカル, 通常
        [1],
      ],
      damage: [
        [120, 165], // 連撃ダメージ
        [95],
      ],
      at_eflag: [0, 0],
      si_list: [[122, 122], [122]],
      sp_list: [1, 0],
      protect_flag: [[false, false], [false]],
      f_now_hps: [
        [37, 37, 36],
        [37, 37, 36],
      ],
      e_now_hps: [
        [57, 37, 0, 0, 0, 0],
        [0, 37, 0, 0, 0, 0],
      ],
    },
  },
};

const base_battle = cells_3_5.battles["11"] as Battle;

export const battle_with_friendly: Battle = {
  ...base_battle,
  battle_order: [
    ...(base_battle.battle_order ?? []).filter(
      (order) => !("FriendlyForceAttack" in order),
    ),
    { FriendlyForceAttack: null },
  ],
  friendly_force_attack: mock_friendly_force_attack,
  friend_total_damages: [285, 95, 0],
};

export const cells_with_friendly: Cells = {
  ...cells_3_5,
  battles: {
    ...cells_3_5.battles,
    "11": battle_with_friendly,
  },
};
