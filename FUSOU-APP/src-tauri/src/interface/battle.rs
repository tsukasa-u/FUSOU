use std::collections::HashMap;

use serde_json::Value;

use crate::{kcapi, kcapi_common::{self, custom_type::DuoType}};

use std::sync::{LazyLock, Mutex};

use super::cells::KCS_CELLS;

// // Is it better to use onecell::sync::Lazy or std::sync::Lazy?
// pub static KCS_BATTLE: LazyLock<Mutex<Battles>> = LazyLock::new(|| {
//     Mutex::new( Battles::new())
// });

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Battles {
    pub cells: Vec<i64>,
    pub battles: HashMap<i64, Battle>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Battle {
    pub cell_id: i64,
    pub deck_id: Option<i64>,
    pub formation: Option<Vec<i64>>,
    pub enemy_ship_id: Option<Vec<i64>>,
    pub e_params: Option<Vec<Vec<i64>>>,
    pub e_slot: Option<Vec<Vec<i64>>>,
    pub total_damages_friends: Option<Vec<i64>>,
    pub total_damages_enemies: Option<Vec<i64>>,
    pub reconnaissance: Option<Vec<i64>>,
    pub forward_observe: Option<Vec<i64>>,
    pub escape_idx: Option<Vec<i64>>,
    pub smoke_type: Option<i64>,
    // pub air_base_assault: Option<AirBaseAssult>,
    // pub carrier_base_assault: Option<CarrierBaseAssault>,
    pub air_base_air_attacks: Option<AirBaseAirAttacks>,
    // pub friendly_task_force_attack: Option<FriendlyTaskForceAttack>,
    pub opening_air_attack: Option<OpeningAirAttack>,
    pub support_attack: Option<SupportAttack>,
    pub opening_taisen: Option<OpeningTaisen>,
    pub opening_raigeki: Option<OpeningRaigeki>,
    pub hougeki: Option<Vec<Option<Hougeki>>>,
    pub closing_raigeki: Option<ClosingRaigeki>,
    // pub friendly_fleet_attack: Option<FriendlyFleetAttack>,
    pub midnight_flare_pos: Option<Vec<i64>>,
    pub midngiht_touchplane: Option<Vec<i64>>,
    pub midnight_hougeki: Option<MidnightHougeki>,
}

// #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
// pub struct CarrierBaseAssault {
//     pub f_damage: AirDamage,
//     pub e_damage: AirDamage,
// }

// #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
// pub struct AirBaseAssult {
//     pub air_plane_id: Vec<i64>,
//     pub f_damage: AirDamage,
//     pub e_damage: AirDamage,
// }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AirBaseAirAttacks {
    attacks: Vec<AirBaseAirAttack>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AirBaseAirAttack {
    pub stage_flag: Vec<i64>,
    pub squadron_plane: Option<Vec<Option<i64>>>,
    pub base_id: i64,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpeningAirAttack {
    pub air_superiority: Option<i64>,
    pub air_fire: Option<AirFire>,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AirFire {
    pub use_item: Vec<i64>,
    pub idx: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpeningRaigeki {
    pub fdam: Vec<f32>,
    pub edam: Vec<f32>,
    pub fydam_list_items: Vec<Option<Vec<i64>>>,
    pub eydam_list_items: Vec<Option<Vec<i64>>>,
    pub frai_list_items: Vec<Option<Vec<i64>>>,
    pub erai_list_items: Vec<Option<Vec<i64>>>,
    pub fcl_list_items: Vec<Option<Vec<i64>>>,
    pub ecl_list_items: Vec<Option<Vec<i64>>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpeningTaisen {
    pub at_list: Vec<i64>,
    pub at_type: Vec<i64>,
    pub df_list: Vec<Vec<i64>>,
    pub cl_list: Vec<Vec<i64>>,
    pub damage: Vec<Vec<f32>>,
    pub at_eflag: Vec<i64>,
    pub si_list: Vec<Vec<Option<i64>>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ClosingRaigeki {
    pub fdam: Vec<f32>,
    pub edam: Vec<f32>,
    pub fydam: Vec<i64>,
    pub eydam: Vec<i64>,
    pub frai: Vec<i64>,
    pub erai: Vec<i64>,
    pub fcl: Vec<i64>,
    pub ecl: Vec<i64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Hougeki {
    pub at_list: Vec<i64>,
    pub at_type: Vec<i64>,
    pub df_list: Vec<Vec<i64>>,
    pub cl_list: Vec<Vec<i64>>,
    pub damage: Vec<Vec<f32>>,
    pub at_eflag: Vec<i64>,
    pub si_list: Vec<Vec<Option<i64>>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MidnightHougeki {
    pub at_list: Vec<i64>,
    pub df_list: Vec<Vec<i64>>,
    pub cl_list: Vec<Vec<i64>>,
    pub damage: Vec<Vec<f32>>,
    pub at_eflag: Vec<i64>,
    pub si_list: Vec<Vec<Option<i64>>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SupportAttack {
    pub support_hourai: Option<SupportHourai>,
    // pub support_airatack: Option<Value>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SupportHourai {
    pub cl_list: Vec<i64>,
    pub damage: Vec<f32>,
    pub deck_id: i64,
    pub ship_id: Vec<i64>,
}

impl From<kcapi_common::common_air::ApiAirBaseAttack> for AirBaseAirAttack {
    fn from(air_base_air_attack: kcapi_common::common_air::ApiAirBaseAttack) -> Self {
        let (f_damage, e_damage) = TupledAirStages(air_base_air_attack.api_plane_from.clone(), air_base_air_attack.api_stage1.clone(), air_base_air_attack.api_stage2.clone(), air_base_air_attack.api_stage3.clone()).into();
        Self {
            stage_flag: air_base_air_attack.api_stage_flag,
            squadron_plane: air_base_air_attack.api_squadron_plane.and_then(|squadron_planes| Some(squadron_planes.iter().map(|squadron_plane| squadron_plane.api_mst_id).collect())),
            base_id: air_base_air_attack.api_base_id,
            f_damage: f_damage,
            e_damage: e_damage,
        }
    }
}

struct TupledAirStages(Option<Vec<Option<Vec<i64>>>>, Option<kcapi_common::common_air::ApiStage1>, Option<kcapi_common::common_air::ApiStage2>, Option<kcapi_common::common_air::ApiStage3>);
// struct TupledAirDamage(AirDamage, AirDamage);
type TupledAirDamage = (AirDamage, AirDamage);
impl From<TupledAirStages> for (AirDamage, AirDamage) {
    fn from(tupled_air_stages: TupledAirStages) -> Self {
        let TupledAirStages(plane_from, stage1, stage2, stage3) = tupled_air_stages;
        (
            AirDamage {
                plane_from: plane_from.clone().and_then(|plane_from| plane_from[0].clone()),
                touch_plane: stage1.clone().and_then(|stage1| stage1.api_touch_plane.and_then(|touch_plane| Some(touch_plane[0]))),
                loss_plane1: stage1.clone().and_then(|stage1| Some(stage1.api_f_lostcount)).unwrap_or(0),
                loss_plane2: stage2.clone().and_then(|stage2| Some(stage2.api_f_lostcount)).unwrap_or(0),
                damages: stage3.clone().and_then(|stage3| stage3.api_fdam),
                cl: stage3.clone().and_then(|stage3| stage3.api_fcl_flag),
                sp: stage3.clone().and_then(|stage3| stage3.api_f_sp_list),
                rai_flag: stage3.clone().and_then(|stage3| stage3.api_frai_flag),
                bak_flag: stage3.clone().and_then(|stage3| stage3.api_fbak_flag),
            },
            AirDamage {
                plane_from: plane_from.clone().and_then(|plane_from| plane_from[1].clone()),
                touch_plane: stage1.clone().and_then(|stage1| stage1.api_touch_plane.and_then(|touch_plane| Some(touch_plane[1]))),
                loss_plane1: stage1.clone().and_then(|stage1| Some(stage1.api_e_lostcount)).unwrap_or(0),
                loss_plane2: stage2.clone().and_then(|stage2| Some(stage2.api_e_lostcount)).unwrap_or(0),
                damages: stage3.clone().and_then(|stage3| stage3.api_edam),
                cl: stage3.clone().and_then(|stage3| stage3.api_ecl_flag),
                sp: stage3.clone().and_then(|stage3| stage3.api_e_sp_list),
                rai_flag: stage3.clone().and_then(|stage3| stage3.api_erai_flag),
                bak_flag: stage3.clone().and_then(|stage3| stage3.api_ebak_flag),
            }

        )
    }
}

impl From<kcapi_common::common_air::ApiKouku> for OpeningAirAttack {
    fn from(air: kcapi_common::common_air::ApiKouku) -> Self {
        let (f_damage, e_damage) = TupledAirStages(air.api_plane_from.clone(), air.api_stage1.clone(), air.api_stage2.clone(), air.api_stage3.clone()).into();
        Self {
            air_superiority: air.api_stage1.clone().and_then(|stage1| stage1.api_disp_seiku),
            air_fire: match air.api_stage2.clone().and_then(|stage2| stage2.api_air_fire) {
                Some(air_fire) => Some(AirFire {
                    use_item: air_fire.api_use_items,
                    idx: air_fire.api_idx,
                }),
                None => None,
            },
            f_damage: f_damage,
            e_damage: e_damage,
        }
    }
}

impl From<kcapi_common::common_battle::ApiOpeningTaisen> for OpeningTaisen {
    fn from(opening_taisen: kcapi_common::common_battle::ApiOpeningTaisen) -> Self {
        Self {
            at_list: opening_taisen.api_at_list,
            at_type: opening_taisen.api_at_type,
            df_list: opening_taisen.api_df_list,
            cl_list: opening_taisen.api_cl_list,
            damage: opening_taisen.api_damage,
            at_eflag: opening_taisen.api_at_eflag,
            si_list: opening_taisen.api_si_list.iter().map(|si_list| si_list.iter().map(|si_option| {
                match si_option {
                    Some(si) => match si {
                        DuoType::Type1(num) => if *num == -1 { None } else { Some(*num) },
                        DuoType::Type2(string) => match string.parse::<i64>() {
                            Ok(num) => Some(num),
                            Err(_) => None,
                        }
                    },
                    None => None,
                }
            }).collect()).collect(),
        }
    }
}

impl From<kcapi_common::common_battle::ApiOpeningAtack> for OpeningRaigeki {
    fn from(opening_raigeki: kcapi_common::common_battle::ApiOpeningAtack) -> Self {
        Self {
            fdam: opening_raigeki.api_fdam,
            edam: opening_raigeki.api_edam,
            fydam_list_items: opening_raigeki.api_fydam_list_items,
            eydam_list_items: opening_raigeki.api_eydam_list_items,
            frai_list_items: opening_raigeki.api_frai_list_items,
            erai_list_items: opening_raigeki.api_erai_list_items,
            fcl_list_items: opening_raigeki.api_fcl_list_items,
            ecl_list_items: opening_raigeki.api_ecl_list_items,
        }
    }
}

impl From<kcapi_common::common_battle::ApiRaigeki> for ClosingRaigeki {
    fn from(closing_raigeki: kcapi_common::common_battle::ApiRaigeki) -> Self {
        Self {
            fdam: closing_raigeki.api_fdam,
            edam: closing_raigeki.api_edam,
            fydam: closing_raigeki.api_fydam,
            eydam: closing_raigeki.api_eydam,
            frai: closing_raigeki.api_frai,
            erai: closing_raigeki.api_erai,
            fcl: closing_raigeki.api_fcl,
            ecl: closing_raigeki.api_ecl,
        }
    }
}

impl From<kcapi_common::common_battle::ApiHougeki> for Hougeki {
    fn from(hougeki: kcapi_common::common_battle::ApiHougeki) -> Self {
        Self {
            at_list: hougeki.api_at_list,
            at_type: hougeki.api_at_type,
            df_list: hougeki.api_df_list,
            cl_list: hougeki.api_cl_list,
            damage: hougeki.api_damage,
            at_eflag: hougeki.api_at_eflag,
            si_list: hougeki.api_si_list.iter().map(|si_list| si_list.iter().map(|si_option| {
                match si_option {
                    Some(si) => match si {
                        DuoType::Type1(num) => if *num == -1 { None } else { Some(*num) },
                        DuoType::Type2(string) => match string.parse::<i64>() {
                            Ok(num) => Some(num),
                            Err(_) => None,
                        }
                    },
                    None => None,
                }
            }).collect()).collect(),
        }
    }
}

impl From<kcapi_common::common_midnight::ApiHougeki> for MidnightHougeki {
    fn from(hougeki: kcapi_common::common_midnight::ApiHougeki) -> Self {
        Self {
            at_list: hougeki.api_at_list,
            df_list: hougeki.api_df_list,
            cl_list: hougeki.api_cl_list,
            damage: hougeki.api_damage,
            at_eflag: hougeki.api_at_eflag,
            si_list: hougeki.api_si_list.iter().map(|si_list| si_list.iter().map(|si| match si {
                DuoType::Type1(num) => if *num == -1 { None } else { Some(*num) },
                DuoType::Type2(string) => match string.parse::<i64>(){
                    Ok(num) => Some(num),
                    Err(_) => None,
                },
            }).collect()).collect(),
        }
    }
}

impl From<kcapi::api_req_sortie::battle::ApiSupportInfo> for SupportAttack {
    fn from(support_info: kcapi::api_req_sortie::battle::ApiSupportInfo) -> Self {
        let support_hourai: Option<SupportHourai> = match support_info.api_support_hourai {
            Some(support_hourai) => Some(support_hourai.into()),
            None => None,
        };
        // let support_airatack: Option<Value> = None;
        Self {
            support_hourai: support_hourai,
        }
    }
}

impl From<kcapi::api_req_sortie::battle::ApiSupportHourai> for SupportHourai {
    fn from(support_hourai: kcapi::api_req_sortie::battle::ApiSupportHourai) -> Self {
        Self {
            cl_list: support_hourai.api_cl_list,
            damage: support_hourai.api_damage,
            deck_id: support_hourai.api_deck_id,
            ship_id: support_hourai.api_ship_id,
        }
    }
}

impl From<kcapi::api_req_sortie::battle::ApiData> for Battle {
    fn from(battle: kcapi::api_req_sortie::battle::ApiData) -> Self {
        let air_base_air_attacks: Option<AirBaseAirAttacks> = match battle.api_air_base_attack {
            Some(air_base_air_attack) => Some(AirBaseAirAttacks {
                attacks: air_base_air_attack.iter().map(|air_base_air_attack| air_base_air_attack.clone().into()).collect(),
            }),
            None => None,
        };
        let opening_air_attack: Option<OpeningAirAttack> = Some(battle.api_kouku.into());
        let opening_taisen: Option<OpeningTaisen> = match battle.api_opening_taisen {
            Some(opening_taisen) => Some(opening_taisen.into()),
            None => None,
        };
        let opening_raigeki: Option<OpeningRaigeki> = match battle.api_opening_atack {
            Some(opening_attack) => Some(opening_attack.into()),
            None => None,
        };
        let closing_taigeki: Option<ClosingRaigeki> = match battle.api_raigeki {
            Some(closing_raigeki) => Some(closing_raigeki.into()),
            None => None,
        };
        let hougeki_1: Option<Hougeki> = match battle.api_hougeki1 {
            Some(hougeki) => Some(hougeki.into()),
            None => None,
        };
        let hougeki_2: Option<Hougeki> = match battle.api_hougeki2 {
            Some(hougeki) => Some(hougeki.into()),
            None => None,
        };
        // Need to implement hougeki_3
        let hougeki_3: Option<Hougeki> = match battle.api_hougeki3 {
            _ => None,
        };
        let hougeki: Option<Vec<Option<Hougeki>>> = if hougeki_1.is_some() || hougeki_2.is_some() || hougeki_3.is_some() {
            Some(vec![hougeki_1, hougeki_2, hougeki_3])
        } else {
            None
        };
        
        let support_attack: Option<SupportAttack> = match battle.api_support_info {
            Some(support_attack) => Some(support_attack.into()),
            None => None,
        };

        let cell_no = match KCS_CELLS.lock().unwrap().last() {
            Some(cell) => cell.clone(),
            None => 0,
        };

        Self {
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_params: Some(battle.api_e_param),
            e_slot: Some(battle.api_e_slot),
            total_damages_friends: None,
            total_damages_enemies: None,
            reconnaissance: Some(battle.api_search),
            forward_observe: None,
            escape_idx: battle.api_escape_idx,
            smoke_type: Some(battle.api_smoke_type),
            // air_base_assault: None,
            // carrier_base_assault: None,
            air_base_air_attacks: air_base_air_attacks,
            opening_air_attack: opening_air_attack,
            support_attack: support_attack,
            opening_taisen: opening_taisen,
            opening_raigeki: opening_raigeki,
            hougeki: hougeki,
            closing_raigeki: closing_taigeki,
            // friendly_fleet_attack: None,
            midnight_flare_pos: None,
            midngiht_touchplane: None,
            midnight_hougeki: None,
        }
    }
}

impl From<kcapi::api_req_battle_midnight::battle::ApiData> for Battle {
    fn from(battle: kcapi::api_req_battle_midnight::battle::ApiData) -> Self {
        let midnight_hougeki: Option<MidnightHougeki> = Some(battle.api_hougeki.into());

        let cell_no = match KCS_CELLS.lock().unwrap().last() {
            Some(cell) => cell.clone(),
            None => 0,
        };

        Self {
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_params: Some(battle.api_e_param),
            e_slot: Some(battle.api_e_slot),
            total_damages_friends: None,
            total_damages_enemies: None,
            reconnaissance: None,
            forward_observe: None,
            escape_idx: battle.api_escape_idx,
            smoke_type: Some(battle.api_smoke_type),
            // air_base_assault: None,
            // carrier_base_assault: None,
            air_base_air_attacks: None,
            opening_air_attack: None,
            support_attack: None,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            // friendly_fleet_attack: None,
            midnight_flare_pos: Some(battle.api_flare_pos),
            midngiht_touchplane: Some(battle.api_touch_plane),
            midnight_hougeki: midnight_hougeki,
        }
    }
}

impl From<kcapi::api_req_battle_midnight::sp_midnight::ApiData> for Battle {
    fn from(battle: kcapi::api_req_battle_midnight::sp_midnight::ApiData) -> Self {
        let midnight_hougeki: Option<MidnightHougeki> = Some(battle.api_hougeki.into());

        let cell_no = match KCS_CELLS.lock().unwrap().last() {
            Some(cell) => cell.clone(),
            None => 0,
        };

        Self {
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_params: Some(battle.api_e_param),
            e_slot: Some(battle.api_e_slot),
            total_damages_friends: None,
            total_damages_enemies: None,
            reconnaissance: None,
            forward_observe: None,
            escape_idx: battle.api_escape_idx,
            smoke_type: Some(battle.api_smoke_type),
            // air_base_assault: None,
            // carrier_base_assault: None,
            air_base_air_attacks: None,
            opening_air_attack: None,
            support_attack: None,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            // friendly_fleet_attack: None,
            midnight_flare_pos: Some(battle.api_flare_pos),
            midngiht_touchplane: Some(battle.api_touch_plane),
            midnight_hougeki: midnight_hougeki,
        }
    }
}

impl From<kcapi::api_req_map::start::ApiData> for Battles {
    fn from(start: kcapi::api_req_map::start::ApiData) -> Self {
        let battles = HashMap::new();
        Self {
            cells: Vec::new(),
            battles: battles,
        }
    }
}