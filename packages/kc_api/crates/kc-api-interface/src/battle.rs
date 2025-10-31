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
    MidnightHougeki(()),
}

impl From<BattleType> for i64 {
    fn from(battle_type: BattleType) -> Self {
        match battle_type {
            BattleType::AirBaseAssult(()) => 1 << 3,
            BattleType::CarrierBaseAssault(()) => 2 << 3,
            BattleType::AirBaseAirAttack(()) => 3 << 3,
            BattleType::OpeningAirAttack(x) if (0..=7).contains(&x) => (4 << 3) | x,
            BattleType::OpeningAirAttack(_) => (4 << 3) | 0x111,
            BattleType::SupportAttack(()) => 5 << 3,
            BattleType::OpeningTaisen(()) => 6 << 3,
            BattleType::OpeningRaigeki(()) => 7 << 3,
            BattleType::Hougeki(x) if (0..=7).contains(&x) => (8 << 3) | x,
            BattleType::Hougeki(_) => (8 << 3) | 0x111,
            BattleType::ClosingRaigeki(()) => 9 << 3,
            BattleType::FriendlyForceAttack(()) => 10 << 3,
            BattleType::MidnightHougeki(()) => 11 << 3,
        }
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
    pub e_params: Option<Vec<Vec<i64>>>,
    pub e_slot: Option<Vec<Vec<i64>>>,
    pub e_hp_max: Option<Vec<i64>>,
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
}

impl Battle {
    pub fn add_or(&self) {
        let mut battles = KCS_CELLS.lock().unwrap();
        match battles.battles.get(&self.cell_id) {
            Some(battle) => {
                let battle_or = Battle {
                    battle_order: battle.battle_order.clone().or(self.battle_order.clone()),
                    timestamp: battle.timestamp.or(self.timestamp),
                    midnight_timestamp: battle
                        .clone()
                        .midnight_timestamp
                        .or(self.midnight_timestamp),
                    cell_id: battle.cell_id,
                    deck_id: battle.deck_id.or(self.deck_id),
                    formation: battle.formation.clone().or(self.formation.clone()),
                    enemy_ship_id: battle.enemy_ship_id.clone().or(self.enemy_ship_id.clone()),
                    e_params: battle.e_params.clone().or(self.e_params.clone()),
                    e_slot: battle.e_slot.clone().or(self.e_slot.clone()),
                    e_hp_max: battle.e_hp_max.clone().or(self.e_hp_max.clone()),
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
                };
                battles.battles.insert(self.cell_id, battle_or);
            }
            None => {
                battles.battles.insert(self.cell_id, self.clone());
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct CarrierBaseAssault {
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct AirBaseAssult {
    pub squadron_plane: Vec<i64>,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
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
    pub base_id: i64,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct OpeningAirAttack {
    pub air_superiority: Option<i64>,
    pub air_fire: Option<AirFire>,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "battle.ts")]
pub struct AirDamage {
    pub plane_from: Option<Vec<i64>>,
    pub touch_plane: Option<i64>,
    pub loss_plane1: i64,
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
pub struct SupportAttack {
    pub support_hourai: Option<SupportHourai>,
    pub support_airatack: Option<SupportAiratack>,
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
pub struct SupportAiratack {
    pub deck_id: i64,
    pub ship_id: Vec<i64>,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
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
