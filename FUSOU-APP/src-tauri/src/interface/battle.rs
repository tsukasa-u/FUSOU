use std::collections::HashMap;

use chrono::Local;
use regex::Match;
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
    pub timestamp: Option<i64>,
    pub midnight_timestamp: Option<i64>,
    pub cell_id: i64,
    pub deck_id: Option<i64>,
    pub formation: Option<Vec<i64>>,
    pub enemy_ship_id: Option<Vec<i64>>,
    pub e_params: Option<Vec<Vec<i64>>>,
    pub e_slot: Option<Vec<Vec<i64>>>,
    pub e_hp_max: Option<Vec<i64>>,
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
    pub protect_flag: Option<Vec<bool>>,
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
    // pub fydam_list_items: Vec<Option<Vec<i64>>>,
    // pub eydam_list_items: Vec<Option<Vec<i64>>>,
    pub frai_list_items: Vec<Option<Vec<i64>>>,
    pub erai_list_items: Vec<Option<Vec<i64>>>,
    pub fcl_list: Vec<i64>,
    pub ecl_list: Vec<i64>,
    pub f_protect_flag: Vec<bool>,
    pub e_protect_flag: Vec<bool>,
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
    pub protect_flag: Vec<Vec<bool>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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
    pub protect_flag: Vec<Vec<bool>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MidnightHougeki {
    pub at_list: Vec<i64>,
    pub df_list: Vec<Vec<i64>>,
    pub cl_list: Vec<Vec<i64>>,
    pub damage: Vec<Vec<f32>>,
    pub at_eflag: Vec<i64>,
    pub si_list: Vec<Vec<Option<i64>>>,
    pub api_sp_list: Vec<i64>,
    pub protect_flag: Vec<Vec<bool>>,
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
    pub protect_flag: Vec<bool>,
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

pub struct TupledAirStages(pub(super) Option<Vec<Option<Vec<i64>>>>, pub(super) Option<kcapi_common::common_air::ApiStage1>, pub(super) Option<kcapi_common::common_air::ApiStage2>, pub(super) Option<kcapi_common::common_air::ApiStage3>);
impl From<TupledAirStages> for (AirDamage, AirDamage) {
    fn from(tupled_air_stages: TupledAirStages) -> Self {
        let TupledAirStages(plane_from, stage1, stage2, stage3) = tupled_air_stages;
        let f_damages: Option<Vec<f32>> = stage3.clone().and_then(|stage3| stage3.api_fdam.and_then(|f_damages| Some(calc_floor(&f_damages))));
        let e_damages: Option<Vec<f32>> = stage3.clone().and_then(|stage3| stage3.api_edam.and_then(|e_damages| Some(calc_floor(&e_damages))));
        let f_cl: Option<Vec<i64>> = stage3.clone().and_then(|stage3| stage3.api_fcl_flag.and_then(|f_cl| Some(calc_critical(&f_damages.clone().unwrap_or(vec![0_f32; f_cl.len()]), &f_cl))));
        let e_cl: Option<Vec<i64>> = stage3.clone().and_then(|stage3| stage3.api_ecl_flag.and_then(|e_cl| Some(calc_critical(&e_damages.clone().unwrap_or(vec![0_f32; e_cl.len()]), &e_cl))));
        let f_protect: Option<Vec<bool>> = stage3.clone().and_then(|stage3| stage3.api_fdam.and_then(|f_damages| Some(calc_protect_flag(&f_damages))));
        let e_protect: Option<Vec<bool>> = stage3.clone().and_then(|stage3| stage3.api_edam.and_then(|e_damages| Some(calc_protect_flag(&e_damages))));
        (
            AirDamage {
                plane_from: plane_from.clone().and_then(|plane_from| plane_from[0].clone()),
                touch_plane: stage1.clone().and_then(|stage1| stage1.api_touch_plane.and_then(|touch_plane| Some(touch_plane[0]))),
                loss_plane1: stage1.clone().and_then(|stage1| Some(stage1.api_f_lostcount)).unwrap_or(0),
                loss_plane2: stage2.clone().and_then(|stage2| Some(stage2.api_f_lostcount)).unwrap_or(0),
                damages: f_damages,
                cl: f_cl,
                sp: stage3.clone().and_then(|stage3| stage3.api_f_sp_list),
                rai_flag: stage3.clone().and_then(|stage3| stage3.api_frai_flag),
                bak_flag: stage3.clone().and_then(|stage3| stage3.api_fbak_flag),
                protect_flag: f_protect,
            },
            AirDamage {
                plane_from: plane_from.clone().and_then(|plane_from| plane_from[1].clone()),
                touch_plane: stage1.clone().and_then(|stage1| stage1.api_touch_plane.and_then(|touch_plane| Some(touch_plane[1]))),
                loss_plane1: stage1.clone().and_then(|stage1| Some(stage1.api_e_lostcount)).unwrap_or(0),
                loss_plane2: stage2.clone().and_then(|stage2| Some(stage2.api_e_lostcount)).unwrap_or(0),
                damages: e_damages,
                cl: e_cl,
                sp: stage3.clone().and_then(|stage3| stage3.api_e_sp_list),
                rai_flag: stage3.clone().and_then(|stage3| stage3.api_erai_flag),
                bak_flag: stage3.clone().and_then(|stage3| stage3.api_ebak_flag),
                protect_flag: e_protect,
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

        let damages: Vec<Vec<f32>> = opening_taisen.api_damage.iter().map(|damage| calc_floor(damage)).collect();
        let cl_list: Vec<Vec<i64>> = opening_taisen.api_cl_list.iter().enumerate().map(|(idx, cl_list)| calc_critical(&damages[idx], cl_list)).collect();
        let protect_flag: Vec<Vec<bool>> = opening_taisen.api_damage.iter().map(|damage| calc_protect_flag(damage)).collect();

        Self {
            at_list: opening_taisen.api_at_list,
            at_type: opening_taisen.api_at_type,
            df_list: opening_taisen.api_df_list,
            cl_list: cl_list,
            damage: damages,
            at_eflag: opening_taisen.api_at_eflag,
            si_list: opening_taisen.api_si_list.iter().map(|si_list| calc_si_list(si_list)).collect(),
            protect_flag: protect_flag,
        }
    }
}

impl From<kcapi_common::common_battle::ApiOpeningAtack> for OpeningRaigeki {
    fn from(opening_raigeki: kcapi_common::common_battle::ApiOpeningAtack) -> Self {

        let f_damages: Vec<f32> = calc_floor(&opening_raigeki.api_fdam);
        let f_protect_flag: Vec<bool> = calc_protect_flag(&opening_raigeki.api_fdam);
        let e_damages: Vec<f32> = calc_floor(&opening_raigeki.api_edam);
        let e_protect_flag: Vec<bool> = calc_protect_flag(&opening_raigeki.api_edam);

        let f_cl_list = calc_critical(&f_damages, &opening_raigeki.api_fcl_list_items.clone().iter().map(|fcl_list| fcl_list.clone().and_then(|fcl| Some(calc_max_critical(&fcl))).unwrap_or(0)).collect::<Vec<i64>>());
        let e_cl_list = calc_critical(&e_damages, &opening_raigeki.api_ecl_list_items.clone().iter().map(|ecl_list| ecl_list.clone().and_then(|ecl| Some(calc_max_critical(&ecl))).unwrap_or(0)).collect::<Vec<i64>>());

        Self {
            fdam: f_damages,
            edam: e_damages,
            // fydam_list_items: opening_raigeki.api_fydam_list_items,
            // eydam_list_items: opening_raigeki.api_eydam_list_items,
            frai_list_items: opening_raigeki.api_frai_list_items,
            erai_list_items: opening_raigeki.api_erai_list_items,
            fcl_list: f_cl_list,
            ecl_list: e_cl_list,
            f_protect_flag: f_protect_flag,
            e_protect_flag: e_protect_flag,
        }
    }
}

impl From<kcapi_common::common_battle::ApiRaigeki> for ClosingRaigeki {
    fn from(closing_raigeki: kcapi_common::common_battle::ApiRaigeki) -> Self {
        
        let f_damages: Vec<f32> = calc_floor(&closing_raigeki.api_fdam);
        let f_cl = calc_critical(&f_damages, &closing_raigeki.api_fcl.iter().map(|&fcl| fcl).collect::<Vec<i64>>());
        let f_protect_flag: Vec<bool> = calc_protect_flag(&closing_raigeki.api_fdam);
        let e_damages: Vec<f32> = calc_floor(&closing_raigeki.api_edam);
        let e_cl = calc_critical(&e_damages, &closing_raigeki.api_ecl.iter().map(|&ecl| ecl).collect::<Vec<i64>>());
        let e_protect_flag: Vec<bool> = calc_protect_flag(&closing_raigeki.api_edam);

        Self {
            fdam: f_damages,
            edam: e_damages,
            // fydam: closing_raigeki.api_fydam,
            // eydam: closing_raigeki.api_eydam,
            frai: closing_raigeki.api_frai,
            erai: closing_raigeki.api_erai,
            fcl: f_cl,
            ecl: e_cl,
            f_protect_flag: f_protect_flag,
            e_protect_flag: e_protect_flag,
        }
    }
}

impl From<kcapi_common::common_battle::ApiHougeki> for Hougeki {
    fn from(hougeki: kcapi_common::common_battle::ApiHougeki) -> Self {

        let si_list: Vec<Vec<Option<i64>>> = hougeki.api_si_list.iter().map(|si_list| calc_si_list(si_list)).collect();

        let damages: Vec<Vec<f32>> = hougeki.api_damage.iter().enumerate().map(|(idx, damage)| remove_m1(damage, &hougeki.api_df_list[idx])).enumerate().map(|(idx, damages)| {
            match hougeki.api_at_type[idx] {
                0 | 1 | 2 => damages,
                n if n < 100 => {
                    let df_0 = hougeki.api_df_list[idx][0].clone();
                    if hougeki.api_df_list[idx].iter().all(|x| *x == df_0) {
                        return vec![damages.iter().fold(0_f32, |acc, y| acc + *y)];
                    } else {
                        return damages;
                    }
                },
                _ => damages,
            }.to_vec()
        }).collect();
        
        let cl_list: Vec<Vec<i64>> = hougeki.api_cl_list.iter().enumerate().map(|(idx, cl_list)| remove_m1(cl_list, &hougeki.api_df_list[idx])).enumerate().map(|(idx, cl_list)| {
            match hougeki.api_at_type[idx] {
                0 | 1 | 2 => cl_list,
                n if n < 100 => {
                    let df_0 = hougeki.api_df_list[idx][0].clone();
                    if hougeki.api_df_list[idx].iter().all(|x| *x == df_0) {
                        return vec![cl_list.iter().max().unwrap_or(&0).to_owned()];
                    } else {
                        return cl_list;
                    }
                },
                _ => cl_list,
            }.to_vec()
        }).enumerate().map(|(idx, cl_list)| calc_critical(&damages[idx], &cl_list)).collect();
        
        let protect_flag: Vec<Vec<bool>> = hougeki.api_damage.iter().enumerate().map(|(idx, damage)| remove_m1(damage, &hougeki.api_df_list[idx])).map(|damage| calc_protect_flag(&damage)).collect();

        let df_list: Vec<Vec<i64>> = hougeki.api_df_list.iter().enumerate().map(|(idx, df_list)| remove_m1(df_list, &hougeki.api_df_list[idx])).enumerate().map(|(idx, df_list)| {
            match hougeki.api_at_type[idx] {
                0 | 1 | 2 => df_list,
                n if n < 100 => {
                    let df_0 = df_list[0].clone();
                    if df_list.iter().all(|x| *x == df_0) {
                        return vec![df_0];
                    } else {
                        return df_list;
                    }
                },
                _ => df_list,
            }.to_vec()
        }).collect();

        Self {
            at_list: hougeki.api_at_list,
            at_type: hougeki.api_at_type,
            df_list: hougeki.api_df_list,
            cl_list: cl_list,
            damage: damages,
            at_eflag: hougeki.api_at_eflag,
            si_list: si_list,
            protect_flag: protect_flag,
        }
    }
}

impl From<kcapi_common::common_midnight::ApiHougeki> for MidnightHougeki {
    fn from(hougeki: kcapi_common::common_midnight::ApiHougeki) -> Self {

        let si_list: Vec<Vec<Option<i64>>> = hougeki.api_si_list.iter().map(|si_list| calc_si_list(&si_list.iter().map(|si| Some(si.to_owned())).collect::<Vec<Option<DuoType<i64, String>>>>())).collect();

        let damages: Vec<Vec<f32>> = hougeki.api_damage.iter().enumerate().map(|(idx, damage)| remove_m1(damage, &hougeki.api_df_list[idx])).enumerate().map(|(idx, damages)| {
            match hougeki.api_sp_list[idx] {
                0 | 1 => damages,
                n if n < 100 => {
                    let df_0 = hougeki.api_df_list[idx][0].clone();
                    if hougeki.api_df_list[idx].iter().all(|x| *x == df_0) {
                        return vec![damages.iter().fold(0_f32, |acc, y| acc + *y)];
                    } else {
                        return damages;
                    }
                },
                _ => damages,
            }.to_vec()
        }).collect();
        
        let cl_list: Vec<Vec<i64>> = hougeki.api_cl_list.iter().enumerate().map(|(idx, cl_list)| remove_m1(cl_list, &hougeki.api_df_list[idx])).enumerate().map(|(idx, cl_list)| {
            match hougeki.api_sp_list[idx] {
                0 | 1 => cl_list,
                n if n < 100 => {
                    let df_0 = hougeki.api_df_list[idx][0].clone();
                    if hougeki.api_df_list[idx].iter().all(|x| *x == df_0) {
                        return vec![cl_list.iter().max().unwrap_or(&0).to_owned()];
                    } else {
                        return cl_list;
                    }
                },
                _ => cl_list,
            }.to_vec()
        }).enumerate().map(|(idx, cl_list)| calc_critical(&damages[idx], &cl_list)).collect();
        
        let protect_flag: Vec<Vec<bool>> = hougeki.api_damage.iter().enumerate().map(|(idx, damage)| remove_m1(damage, &hougeki.api_df_list[idx])).map(|damage| calc_protect_flag(&damage)).collect();

        let df_list: Vec<Vec<i64>> = hougeki.api_df_list.iter().enumerate().map(|(idx, df_list)| remove_m1(df_list, &hougeki.api_df_list[idx])).enumerate().map(|(idx, df_list)| {
            match hougeki.api_sp_list[idx] {
                0 | 1 => df_list,
                n if n < 100 => {
                    let df_0 = df_list[0].clone();
                    if df_list.iter().all(|x| *x == df_0) {
                        return vec![df_0];
                    } else {
                        return df_list;
                    }
                },
                _ => df_list,
            }.to_vec()
        }).collect();

        Self {
            at_list: hougeki.api_at_list,
            df_list: df_list,
            cl_list: cl_list,
            damage: damages,
            at_eflag: hougeki.api_at_eflag,
            si_list: si_list,
            api_sp_list: hougeki.api_sp_list,
            protect_flag: protect_flag,
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

        let damages: Vec<f32> = calc_floor(&support_hourai.api_damage);
        let cl_list: Vec<i64> = calc_critical(&damages, &support_hourai.api_cl_list);
        let protect_flag: Vec<bool> = calc_protect_flag(&damages);

        Self {
            cl_list: cl_list,
            damage: damages,
            deck_id: support_hourai.api_deck_id,
            ship_id: support_hourai.api_ship_id,
            protect_flag: protect_flag,
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
            timestamp: Some(Local::now().timestamp()),
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_params: Some(battle.api_e_param),
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
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
            timestamp: None,
            midnight_timestamp: Some(Local::now().timestamp()),
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_params: Some(battle.api_e_param),
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
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
            timestamp: None,
            midnight_timestamp: Some(Local::now().timestamp()),
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_params: Some(battle.api_e_param),
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
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

impl From<kcapi::api_req_sortie::ld_airbattle::ApiData> for Battle {
    fn from(airbattle: kcapi::api_req_sortie::ld_airbattle::ApiData) -> Self {
        let air_base_air_attacks: Option<AirBaseAirAttacks> = match airbattle.api_air_base_attack {
            Some(air_base_air_attack) => Some(AirBaseAirAttacks {
                attacks: air_base_air_attack.iter().map(|air_base_air_attack| air_base_air_attack.clone().into()).collect(),
            }),
            None => None,
        };
        let opening_air_attack: Option<OpeningAirAttack> = Some(airbattle.api_kouku.into());

        let cell_no = match KCS_CELLS.lock().unwrap().last() {
            Some(cell) => cell.clone(),
            None => 0,
        };

        Self {
            timestamp: Some(Local::now().timestamp()),
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: Some(airbattle.api_deck_id),
            formation: Some(airbattle.api_formation),
            enemy_ship_id: Some(airbattle.api_ship_ke),
            e_params: Some(airbattle.api_e_param),
            e_slot: Some(airbattle.api_e_slot),
            e_hp_max: Some(airbattle.api_e_maxhps),
            total_damages_friends: None,
            total_damages_enemies: None,
            reconnaissance: Some(airbattle.api_search),
            forward_observe: None,
            escape_idx: airbattle.api_escape_idx,
            smoke_type: Some(airbattle.api_smoke_type),
            // air_base_assault: None,
            // carrier_base_assault: None,
            air_base_air_attacks: air_base_air_attacks,
            opening_air_attack: opening_air_attack,
            support_attack: None,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            // friendly_fleet_attack: None,
            midnight_flare_pos: None,
            midngiht_touchplane: None,
            midnight_hougeki: None,
        }
    }
}

// impl From<kcapi::api_req_map::start::ApiData> for Battles {
//     fn from(start: kcapi::api_req_map::start::ApiData) -> Self {
//         let battles = HashMap::new();
//         Self {
//             cells: Vec::new(),
//             battles: battles,
//         }
//     }
// }

fn calc_critical(damages: &Vec<f32>, cl_list: &Vec<i64>) -> Vec<i64> {
    cl_list.iter().enumerate().map(|(idx, cl)| {
        match damages[idx] {
            n if n < 15_f32 => 1,
            n if n >= 40_f32 => 2,
            _ => cl.clone(), 
        }
    }).collect()
}

fn calc_floor(damages: &Vec<f32>) -> Vec<f32> {
    damages.iter().map(|dmg| (*dmg).floor()).collect()
}

fn calc_si_list(si_list: &Vec<Option<DuoType<i64, String>>>) -> Vec<Option<i64>> {
    si_list.iter().map(|si| {
        match si {
            Some(si) => match si {
                DuoType::Type1(num) => if *num == -1 { None } else { Some(*num) },
                DuoType::Type2(string) => match string.parse::<i64>() {
                    Ok(num) => Some(num),
                    Err(_) => None,
                }
            },
            None => None,
        }
    }).collect()
}

fn calc_protect_flag(damages: &Vec<f32>) -> Vec<bool> {
    damages.iter().map(|dmg| (*dmg).floor() < *dmg).collect()
}

fn calc_max_critical(cl_list: &Vec<i64>) -> i64 {
    cl_list.iter().max().and_then(|x| Some(*x)).unwrap_or(0)
}

fn remove_m1<T>(vec: &Vec<T>, df_list: &Vec<i64>) -> Vec<T> where T: Clone {
    vec.clone().iter().enumerate().filter_map(|(idx, y)| if df_list[idx] != -1 { Some(y.clone()) } else { None }).collect::<Vec<T>>()
}