use std::collections::HashMap;

use super::cells::KCS_CELLS;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub enum BattleType {
    AirBaseAssult(()),
    CarrierBaseAssault(()),
    AirBaseAirAttack(()),
    OpeningAirAttack(i64),
    SupportAttack(()),
    OpeningTaisen(()),
    OpeningRaigeki(()),
    Hougeki(i64),
    ClosingRaigeki(()),
    FriendlyForceAttack(()),
    NightSupportAttack(()),
    MidnightHougeki(()),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BattlePhaseKind {
    Day,
    Night,
}

impl BattleType {
    pub const fn phase_kind_is_night(&self) -> bool {
        matches!(
            self,
            BattleType::FriendlyForceAttack(())
                | BattleType::NightSupportAttack(())
                | BattleType::MidnightHougeki(())
        )
    }

    pub fn phase_kind(&self) -> BattlePhaseKind {
        if self.phase_kind_is_night() {
            BattlePhaseKind::Night
        } else {
            BattlePhaseKind::Day
        }
    }

    pub const fn phase_key(&self) -> i64 {
        match *self {
            BattleType::AirBaseAssult(()) => 1 << 3,
            BattleType::CarrierBaseAssault(()) => 2 << 3,
            BattleType::AirBaseAirAttack(()) => 3 << 3,
            BattleType::OpeningAirAttack(x) if x >= 0 && x <= 7 => (4 << 3) | x,
            BattleType::OpeningAirAttack(_) => (4 << 3) | 0x111,
            BattleType::SupportAttack(()) => 5 << 3,
            BattleType::OpeningTaisen(()) => 6 << 3,
            BattleType::OpeningRaigeki(()) => 7 << 3,
            BattleType::Hougeki(x) if x >= 0 && x <= 7 => (8 << 3) | x,
            BattleType::Hougeki(_) => (8 << 3) | 0x111,
            BattleType::ClosingRaigeki(()) => 9 << 3,
            BattleType::FriendlyForceAttack(()) => 10 << 3,
            BattleType::NightSupportAttack(()) => 12 << 3,
            BattleType::MidnightHougeki(()) => 11 << 3,
        }
    }
}

pub const fn battle_order_keys_unique(order: &[BattleType]) -> bool {
    let mut i = 0;
    while i < order.len() {
        let left = order[i].phase_key();
        let mut j = i + 1;
        while j < order.len() {
            if left == order[j].phase_key() {
                return false;
            }
            j += 1;
        }
        i += 1;
    }
    true
}

/// 全フェーズが同一の昼夜区分に属するか検査する。
/// 昼戦フェーズと夜戦フェーズが混在している場合は false を返す。
pub const fn battle_order_phase_kind_consistent(order: &[BattleType]) -> bool {
    if order.is_empty() {
        return true;
    }
    let first_is_night = order[0].phase_kind_is_night();
    let mut i = 1;
    while i < order.len() {
        if order[i].phase_kind_is_night() != first_is_night {
            return false;
        }
        i += 1;
    }
    true
}

#[macro_export]
macro_rules! battle_order_checked {
    ($($phase:expr),+ $(,)?) => {{
        const ORDER: &[$crate::battle::BattleType] = &[$($phase),+];
        const _: () = {
            if !$crate::battle::battle_order_keys_unique(ORDER) {
                panic!("duplicate battle phase keys in battle_order definition");
            }
            if !$crate::battle::battle_order_phase_kind_consistent(ORDER) {
                panic!("mixed day/night battle phases in battle_order definition");
            }
        };
        vec![$($phase),+]
    }};
}

fn has_duplicate_phase_key(order: &[BattleType]) -> bool {
    for (i, left) in order.iter().enumerate() {
        let left_key = i64::from(left.clone());
        if order
            .iter()
            .skip(i + 1)
            .any(|right| i64::from(right.clone()) == left_key)
        {
            return true;
        }
    }
    false
}

pub fn merge_battle_order(
    existing: Option<Vec<BattleType>>,
    incoming: Option<Vec<BattleType>>,
) -> Option<Vec<BattleType>> {
    match (existing, incoming) {
        (Some(mut merged), Some(incoming)) => {
            if has_duplicate_phase_key(&merged) {
                panic!("duplicate phase keys in existing battle_order");
            }
            if has_duplicate_phase_key(&incoming) {
                panic!("duplicate phase keys in incoming battle_order");
            }
            for phase in incoming {
                let key = i64::from(phase.clone());
                if !merged
                    .iter()
                    .any(|current| i64::from(current.clone()) == key)
                {
                    merged.push(phase);
                }
            }
            Some(merged)
        }
        (Some(existing), None) => {
            if has_duplicate_phase_key(&existing) {
                panic!("duplicate phase keys in existing battle_order");
            }
            Some(existing)
        }
        (None, Some(incoming)) => {
            if has_duplicate_phase_key(&incoming) {
                panic!("duplicate phase keys in incoming battle_order");
            }
            Some(incoming)
        }
        (None, None) => None,
    }
}

impl From<BattleType> for i64 {
    fn from(battle_type: BattleType) -> Self {
        battle_type.phase_key()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct Battles {
    pub cells: Vec<i64>,
    pub battles: HashMap<i64, Battle>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct Battle {
    pub battle_order: Option<Vec<BattleType>>,
    pub timestamp: Option<i64>,
    pub midnight_timestamp: Option<i64>,
    pub cell_id: i64,
    pub deck_id: Option<i64>,
    pub formation: Option<Vec<i64>>,
    pub enemy_ship_id: Option<Vec<i64>>,
    pub e_lv: Option<Vec<i64>>,
    pub e_params: Option<Vec<Vec<i64>>>,
    pub f_params: Option<Vec<Vec<i64>>>,
    pub e_slot: Option<Vec<Vec<i64>>>,
    pub e_hp_max: Option<Vec<i64>>,
    pub e_combined_flag: Option<i64>,
    pub f_total_damages: Option<Vec<i64>>,
    pub e_total_damages: Option<Vec<i64>>,
    pub friend_total_damages: Option<Vec<i64>>,
    pub midnight_f_total_damages: Option<Vec<i64>>,
    pub midnight_e_total_damages: Option<Vec<i64>>,
    pub reconnaissance: Option<Vec<i64>>,
    pub escape_idx: Option<Vec<i64>>,
    pub smoke_type: Option<i64>,
    pub combat_ration: Option<Vec<i64>>,
    pub balloon_flag: Option<i64>,
    pub air_base_assault: Option<AirBaseAssult>,
    pub carrier_base_assault: Option<CarrierBaseAssault>,
    pub air_base_air_attacks: Option<AirBaseAirAttacks>,
    // pub friendly_task_force_attack: Option<FriendlyTaskForceAttack>,
    pub opening_air_attack: Option<Vec<Option<OpeningAirAttack>>>,
    pub support_attack: Option<SupportAttack>,
    pub night_support_attack: Option<NightSupportAttack>,
    pub opening_taisen: Option<OpeningTaisen>,
    pub opening_raigeki: Option<OpeningRaigeki>,
    pub hougeki: Option<Vec<Option<Hougeki>>>,
    pub closing_raigeki: Option<ClosingRaigeki>,
    pub friendly_force_attack: Option<FriendlyForceAttack>,
    pub midnight_flare_pos: Option<Vec<i64>>,
    pub midnight_touchplane: Option<Vec<i64>>,
    pub midnight_hougeki: Option<MidnightHougeki>,
    pub f_nowhps: Option<Vec<i64>>,
    pub e_nowhps: Option<Vec<i64>>,
    pub midnight_f_nowhps: Option<Vec<i64>>,
    pub midnight_e_nowhps: Option<Vec<i64>>,
    pub battle_result: Option<BattleResult>,
}

impl Battle {
    pub fn add_or(&self) {
        let mut battles = KCS_CELLS.lock().unwrap();
        match battles.battles.get(&self.cell_id) {
            Some(battle) => {
                let battle_or = Battle {
                    battle_order: merge_battle_order(
                        battle.battle_order.clone(),
                        self.battle_order.clone(),
                    ),
                    timestamp: battle.timestamp.or(self.timestamp),
                    midnight_timestamp: battle
                        .clone()
                        .midnight_timestamp
                        .or(self.midnight_timestamp),
                    cell_id: battle.cell_id,
                    deck_id: battle.deck_id.or(self.deck_id),
                    formation: battle.formation.clone().or(self.formation.clone()),
                    enemy_ship_id: battle.enemy_ship_id.clone().or(self.enemy_ship_id.clone()),
                    e_lv: battle.e_lv.clone().or(self.e_lv.clone()),
                    e_params: battle.e_params.clone().or(self.e_params.clone()),
                    f_params: battle.f_params.clone().or(self.f_params.clone()),
                    e_slot: battle.e_slot.clone().or(self.e_slot.clone()),
                    e_hp_max: battle.e_hp_max.clone().or(self.e_hp_max.clone()),
                    e_combined_flag: battle.e_combined_flag.or(self.e_combined_flag),
                    f_total_damages: battle
                        .f_total_damages
                        .clone()
                        .or(self.f_total_damages.clone()),
                    e_total_damages: battle
                        .e_total_damages
                        .clone()
                        .or(self.e_total_damages.clone()),
                    friend_total_damages: battle
                        .friend_total_damages
                        .clone()
                        .or(self.friend_total_damages.clone()),
                    midnight_f_total_damages: battle
                        .midnight_f_total_damages
                        .clone()
                        .or(self.midnight_f_total_damages.clone()),
                    midnight_e_total_damages: battle
                        .midnight_e_total_damages
                        .clone()
                        .or(self.midnight_e_total_damages.clone()),
                    reconnaissance: battle
                        .reconnaissance
                        .clone()
                        .or(self.reconnaissance.clone()),
                    escape_idx: battle.escape_idx.clone().or(self.escape_idx.clone()),
                    smoke_type: battle.smoke_type.or(self.smoke_type),
                    combat_ration: battle.combat_ration.clone().or(self.combat_ration.clone()),
                    balloon_flag: battle.balloon_flag.or(self.balloon_flag),
                    air_base_assault: battle
                        .air_base_assault
                        .clone()
                        .or(self.air_base_assault.clone()),
                    carrier_base_assault: battle
                        .carrier_base_assault
                        .clone()
                        .or(self.carrier_base_assault.clone()),
                    air_base_air_attacks: battle
                        .air_base_air_attacks
                        .clone()
                        .or(self.air_base_air_attacks.clone()),
                    opening_air_attack: battle
                        .opening_air_attack
                        .clone()
                        .or(self.opening_air_attack.clone()),
                    support_attack: battle
                        .support_attack
                        .clone()
                        .or(self.support_attack.clone()),
                    night_support_attack: battle
                        .night_support_attack
                        .clone()
                        .or(self.night_support_attack.clone()),
                    opening_taisen: battle
                        .opening_taisen
                        .clone()
                        .or(self.opening_taisen.clone()),
                    opening_raigeki: battle
                        .opening_raigeki
                        .clone()
                        .or(self.opening_raigeki.clone()),
                    hougeki: battle.hougeki.clone().or(self.hougeki.clone()),
                    closing_raigeki: battle
                        .closing_raigeki
                        .clone()
                        .or(self.closing_raigeki.clone()),
                    friendly_force_attack: battle
                        .friendly_force_attack
                        .clone()
                        .or(self.friendly_force_attack.clone()),
                    midnight_flare_pos: battle
                        .midnight_flare_pos
                        .clone()
                        .or(self.midnight_flare_pos.clone()),
                    midnight_touchplane: battle
                        .midnight_touchplane
                        .clone()
                        .or(self.midnight_touchplane.clone()),
                    midnight_hougeki: battle
                        .midnight_hougeki
                        .clone()
                        .or(self.midnight_hougeki.clone()),
                    f_nowhps: battle.f_nowhps.clone().or(self.f_nowhps.clone()),
                    e_nowhps: battle.e_nowhps.clone().or(self.e_nowhps.clone()),
                    midnight_f_nowhps: battle
                        .midnight_f_nowhps
                        .clone()
                        .or(self.midnight_f_nowhps.clone()),
                    midnight_e_nowhps: battle
                        .midnight_e_nowhps
                        .clone()
                        .or(self.midnight_e_nowhps.clone()),
                    battle_result: battle.battle_result.clone().or(self.battle_result.clone()),
                };
                battles.battles.insert(self.cell_id, battle_or);
            }
            None => {
                let mut normalized = self.clone();
                normalized.battle_order = merge_battle_order(None, normalized.battle_order.clone());
                battles.battles.insert(self.cell_id, normalized);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        battle_order_phase_kind_consistent, merge_battle_order, BattlePhaseKind, BattleType,
    };

    fn representative_types() -> Vec<BattleType> {
        vec![
            BattleType::AirBaseAssult(()),
            BattleType::CarrierBaseAssault(()),
            BattleType::AirBaseAirAttack(()),
            BattleType::OpeningAirAttack(0),
            BattleType::SupportAttack(()),
            BattleType::OpeningTaisen(()),
            BattleType::OpeningRaigeki(()),
            BattleType::Hougeki(0),
            BattleType::ClosingRaigeki(()),
            BattleType::FriendlyForceAttack(()),
            BattleType::NightSupportAttack(()),
            BattleType::MidnightHougeki(()),
        ]
    }

    #[test]
    fn battle_type_keys_are_unique() {
        let types = representative_types();
        for (i, left) in types.iter().enumerate() {
            for right in types.iter().skip(i + 1) {
                assert_ne!(
                    i64::from(left.clone()),
                    i64::from(right.clone()),
                    "BattleType key collision: {:?} and {:?}",
                    left,
                    right
                );
            }
        }
    }

    #[test]
    fn night_phase_classification_is_explicit() {
        assert_eq!(
            BattleType::NightSupportAttack(()).phase_kind(),
            BattlePhaseKind::Night
        );
        assert_eq!(
            BattleType::MidnightHougeki(()).phase_kind(),
            BattlePhaseKind::Night
        );
        assert_eq!(BattleType::Hougeki(0).phase_kind(), BattlePhaseKind::Day);
    }

    #[test]
    fn merge_battle_order_appends_only_new_phases() {
        let existing = Some(vec![BattleType::Hougeki(0), BattleType::ClosingRaigeki(())]);
        let incoming = Some(vec![
            BattleType::NightSupportAttack(()),
            BattleType::Hougeki(0),
        ]);

        let merged = merge_battle_order(existing, incoming).unwrap();
        let keys: Vec<i64> = merged.into_iter().map(i64::from).collect();

        assert_eq!(
            keys,
            vec![
                i64::from(BattleType::Hougeki(0)),
                i64::from(BattleType::ClosingRaigeki(())),
                i64::from(BattleType::NightSupportAttack(()))
            ]
        );
    }

    #[test]
    fn phase_kind_consistent_rejects_mixed_day_night() {
        // 昼戦フェーズのみ → OK
        assert!(battle_order_phase_kind_consistent(&[
            BattleType::OpeningRaigeki(()),
            BattleType::Hougeki(1),
            BattleType::ClosingRaigeki(()),
        ]));
        // 夜戦フェーズのみ → OK
        assert!(battle_order_phase_kind_consistent(&[
            BattleType::NightSupportAttack(()),
            BattleType::MidnightHougeki(()),
        ]));
        // 昼戦に夜戦を混入 → NG
        assert!(!battle_order_phase_kind_consistent(&[
            BattleType::Hougeki(1),
            BattleType::MidnightHougeki(()),
        ]));
        // 夜戦に昼戦を混入 → NG
        assert!(!battle_order_phase_kind_consistent(&[
            BattleType::NightSupportAttack(()),
            BattleType::Hougeki(0),
        ]));
    }

    #[test]
    fn merge_battle_order_panics_when_existing_has_duplicate_keys() {
        let existing = Some(vec![BattleType::Hougeki(0), BattleType::Hougeki(0)]);

        let result = std::panic::catch_unwind(|| {
            let _ = merge_battle_order(existing, None);
        });

        assert!(result.is_err());
    }

    #[test]
    fn merge_battle_order_panics_when_incoming_has_duplicate_keys() {
        let incoming = Some(vec![
            BattleType::NightSupportAttack(()),
            BattleType::NightSupportAttack(()),
            BattleType::MidnightHougeki(()),
        ]);

        let result = std::panic::catch_unwind(|| {
            let _ = merge_battle_order(None, incoming);
        });

        assert!(result.is_err());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct BattleResult {
    pub win_rank: String,
    pub drop_ship_id: Option<i64>,
    pub landing_hp_now: Option<i64>,
    pub landing_hp_max: Option<i64>,
    pub landing_sub_value: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct CarrierBaseAssault {
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
    pub f_sprite_fly_count: Option<i64>,
    pub e_sprite_fly_count: Option<i64>,
    pub f_sprite_crash_stage1_count: Option<i64>,
    pub f_sprite_crash_stage2_count: Option<i64>,
    pub e_sprite_crash_stage1_count: Option<i64>,
    pub e_sprite_crash_stage2_count: Option<i64>,
    pub f_sprite_damage_stage1_count: Option<i64>,
    pub f_sprite_damage_stage2_count: Option<i64>,
    pub e_sprite_damage_stage1_count: Option<i64>,
    pub e_sprite_damage_stage2_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct AirBaseAssult {
    pub squadron_plane: Vec<i64>,
    pub squadron_count: Vec<i64>,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
    pub f_sprite_fly_count: Option<i64>,
    pub e_sprite_fly_count: Option<i64>,
    pub f_sprite_crash_stage1_count: Option<i64>,
    pub f_sprite_crash_stage2_count: Option<i64>,
    pub e_sprite_crash_stage1_count: Option<i64>,
    pub e_sprite_crash_stage2_count: Option<i64>,
    pub f_sprite_damage_stage1_count: Option<i64>,
    pub f_sprite_damage_stage2_count: Option<i64>,
    pub e_sprite_damage_stage1_count: Option<i64>,
    pub e_sprite_damage_stage2_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct AirBaseAirAttacks {
    pub attacks: Vec<AirBaseAirAttack>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct AirBaseAirAttack {
    pub stage_flag: Vec<i64>,
    pub squadron_plane: Option<Vec<Option<i64>>>,
    pub squadron_count: Option<Vec<Option<i64>>>,
    pub base_id: i64,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
    pub f_sprite_fly_count: Option<i64>,
    pub e_sprite_fly_count: Option<i64>,
    pub f_sprite_crash_stage1_count: Option<i64>,
    pub f_sprite_crash_stage2_count: Option<i64>,
    pub e_sprite_crash_stage1_count: Option<i64>,
    pub e_sprite_crash_stage2_count: Option<i64>,
    pub f_sprite_damage_stage1_count: Option<i64>,
    pub f_sprite_damage_stage2_count: Option<i64>,
    pub e_sprite_damage_stage1_count: Option<i64>,
    pub e_sprite_damage_stage2_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct OpeningAirAttack {
    pub air_superiority: Option<i64>,
    pub air_fire: Option<AirFire>,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
    pub f_sprite_fly_count: Option<i64>,
    pub e_sprite_fly_count: Option<i64>,
    pub f_sprite_crash_count_stage1: Option<i64>,
    pub f_sprite_crash_count_stage2: Option<i64>,
    pub e_sprite_crash_count_stage1: Option<i64>,
    pub e_sprite_crash_count_stage2: Option<i64>,
    pub f_sprite_damage_count_stage1: Option<i64>,
    pub f_sprite_damage_count_stage2: Option<i64>,
    pub e_sprite_damage_count_stage1: Option<i64>,
    pub e_sprite_damage_count_stage2: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct AirDamage {
    pub plane_from: Option<Vec<i64>>,
    pub touch_plane: Option<i64>,
    /// Raw stage1 aircraft count from the API (`api_stage1.api_f/e_count`).
    /// main.js sprite crash simulation uses this value as the shared `count`
    /// denominator for both stage1 and stage2 damage distribution.
    /// 0 when stage1 data is unavailable.
    pub total_plane1: i64,
    pub loss_plane1: i64,
    /// Raw stage2 aircraft count from the API (`api_stage2.api_f/e_count`).
    /// This is kept for inspection/debugging, but main.js sprite crash simulation
    /// does not use it as the stage2 denominator.
    /// 0 when unavailable.
    pub total_plane2: i64,
    pub loss_plane2: i64,
    pub damages: Option<Vec<f32>>,
    pub cl: Option<Vec<i64>>,
    pub sp: Option<Vec<Option<Vec<i64>>>>,
    pub rai_flag: Option<Vec<Option<i64>>>,
    pub bak_flag: Option<Vec<Option<i64>>>,
    pub protect_flag: Option<Vec<bool>>,
    pub now_hps: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct AirFire {
    pub use_item: Vec<i64>,
    pub idx: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct OpeningRaigeki {
    pub fdam: Vec<f32>,
    pub edam: Vec<f32>,
    // pub fydam_list_items: Vec<Option<Vec<i64>>>,
    // pub eydam_list_items: Vec<Option<Vec<i64>>>,
    pub frai_list_items: Vec<Option<Vec<i64>>>,
    pub erai_list_items: Vec<Option<Vec<i64>>>,
    pub fcl_list: Vec<i64>,
    pub ecl_list: Vec<i64>,
    pub f_protect_flag: Vec<bool>,
    pub e_protect_flag: Vec<bool>,
    pub f_now_hps: Vec<i64>,
    pub e_now_hps: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct OpeningTaisen {
    pub at_list: Vec<i64>,
    pub at_type: Vec<i64>,
    pub df_list: Vec<Vec<i64>>,
    pub cl_list: Vec<Vec<i64>>,
    pub damage: Vec<Vec<f32>>,
    pub at_eflag: Vec<i64>,
    pub si_list: Vec<Vec<Option<i64>>>,
    pub protect_flag: Vec<Vec<bool>>,
    pub f_now_hps: Vec<Vec<i64>>,
    pub e_now_hps: Vec<Vec<i64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct ClosingRaigeki {
    pub fdam: Vec<f32>,
    pub edam: Vec<f32>,
    // pub fydam: Vec<i64>,
    // pub eydam: Vec<i64>,
    pub frai: Vec<i64>,
    pub erai: Vec<i64>,
    pub fcl: Vec<i64>,
    pub ecl: Vec<i64>,
    pub f_protect_flag: Vec<bool>,
    pub e_protect_flag: Vec<bool>,
    pub f_now_hps: Vec<i64>,
    pub e_now_hps: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct Hougeki {
    pub at_list: Vec<i64>,
    pub at_type: Vec<i64>,
    pub df_list: Vec<Vec<i64>>,
    pub cl_list: Vec<Vec<i64>>,
    pub damage: Vec<Vec<f32>>,
    pub at_eflag: Vec<i64>,
    pub si_list: Vec<Vec<Option<i64>>>,
    pub protect_flag: Vec<Vec<bool>>,
    pub f_now_hps: Vec<Vec<i64>>,
    pub e_now_hps: Vec<Vec<i64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct MidnightHougeki {
    pub at_list: Option<Vec<i64>>,
    pub df_list: Option<Vec<Vec<i64>>>,
    pub cl_list: Option<Vec<Vec<i64>>>,
    pub damage: Option<Vec<Vec<f32>>>,
    pub at_eflag: Option<Vec<i64>>,
    pub si_list: Option<Vec<Vec<Option<i64>>>>,
    pub sp_list: Option<Vec<i64>>,
    pub protect_flag: Option<Vec<Vec<bool>>>,
    pub f_now_hps: Vec<Vec<i64>>,
    pub e_now_hps: Vec<Vec<i64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct SupportHourai {
    pub cl_list: Vec<i64>,
    pub damage: Vec<f32>,
    pub deck_id: i64,
    pub ship_id: Vec<i64>,
    pub protect_flag: Vec<bool>,
    pub now_hps: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct SupportAttack {
    pub support_hourai: Option<SupportHourai>,
    pub support_airatack: Option<SupportAiratack>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct NightSupportAttack {
    pub hourai: Option<SupportHourai>,
    pub airatack: Option<SupportAiratack>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct SupportAiratack {
    pub deck_id: i64,
    pub ship_id: Vec<i64>,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
    pub f_sprite_fly_count: Option<i64>,
    pub e_sprite_fly_count: Option<i64>,
    pub f_sprite_crash_count: Option<i64>,
    pub e_sprite_crash_count: Option<i64>,
    pub f_sprite_damage_count: Option<i64>,
    pub e_sprite_damage_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct FriendlyForceAttack {
    pub fleet_info: FriendlyForceInfo,
    pub support_hourai: Option<FriendlySupportHourai>,
    // pub support_airatack: Option<FriendlySupportAiratack>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct FriendlySupportHourai {
    pub flare_pos: Vec<i64>,
    pub hougeki: MidnightHougeki,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct FriendlyForceInfo {
    pub slot_ex: Vec<i64>,
    pub max_hps: Vec<i64>,
    pub ship_id: Vec<i64>,
    pub params: Vec<Vec<i64>>,
    pub ship_lv: Vec<i64>,
    pub now_hps: Vec<i64>,
    pub slot: Vec<Vec<i64>>,
}

// #[derive(Debug, Clone, Serialize, Deserialize, TS)]
// #[ts(export, export_to = "battle.ts")]
// pub struct FriendlySupportAiratack {
//     pub stage_flag: Vec<i64>,
//     pub f_damage: AirDamage,
//     pub e_damage: AirDamage,
// }
