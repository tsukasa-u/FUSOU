use std::collections::HashMap;

use serde_json::Value;

use crate::{kcapi, kcapi_common};

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
    pub api_deck_id: i64,
    pub formation: Vec<i64>,
    pub enemy_ship_id: Vec<i64>,
    pub total_damages_friends: Vec<i64>,
    pub total_damages_enemies: Vec<i64>,
    pub reconnaissance: Vec<i64>,
    pub forward_observe: Vec<i64>,
    // pub air_base_force_jet_assault: Option<Vec<i64>>,
    // pub force_jet_assault: Option<Vec<i64>>,
    // pub AirBaseCombat: Option<AirBaseCombat>,
    // pub Mobile TaskForceFriendlyAirCombat: Option<MobileTaskForceFriendlyAirCombat>
    pub opening_air_Attack: Option<OprningAirAttack>,
    // pub support_attack: Option<SupportAttack>,
    pub opening_taisen: Option<OpeningTaisen>,
    pub opening_raigeki: Option<OpeningRaigeki>,
    pub hougeki: Option<Vec<Option<Hougeki>>>,
    pub closing_raigeki: Option<ClosingRaigeki>,
    // pub friendly_fleet_attack: Option<FriendlyFleetAttack>,
    // pub midnight_hougeki: Option<Vec<Option<Hougeki>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OprningAirAttack {
    pub f_plane_from: Option<Vec<Option<i64>>>,
    pub e_plane_from: Option<Vec<Option<i64>>>,
    pub stage1: Option<OprningAirAttackStage1>,
    pub stage2: Option<OprningAirAttackStage2>,
    pub stage3: Option<OprningAirAttackStage3>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OprningAirAttackStage1 {
    pub f_loss_plane: i64,
    pub e_loss_plane: i64,
    pub air_superiority: Option<i64>,
}


#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OprningAirAttackStage2 {
    pub f_loss_plane: i64,
    pub e_loss_plane: i64,
    pub air_fire: Option<AirFire>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AirFire {
    pub use_item: Vec<i64>,
    pub idx: i64,
    pub kind: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OprningAirAttackStage3 {
    pub frai_flag: Option<Vec<i64>>,
    pub erai_flag: Option<Vec<i64>>,
    pub fbak_flag: Option<Vec<i64>>,
    pub ebak_flag: Option<Vec<i64>>,
    pub fcl_flag: Option<Vec<i64>>,
    pub ecl_flag: Option<Vec<i64>>,
    pub fdam: Option<Vec<f32>>,
    pub edam: Option<Vec<f32>>,
    pub f_sp_list: Option<Vec<Option<Vec<i64>>>>,
    pub e_sp_list: Option<Vec<Option<Vec<i64>>>>,
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
    pub si_list: Vec<Vec<Value>>,
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
    pub si_list: Vec<Vec<Value>>,
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
            si_list: opening_taisen.api_si_list,
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
            si_list: hougeki.api_si_list,
        }
    }
}

impl From<kcapi::api_req_sortie::battle::ApiData> for Battle {
    fn from(battle: kcapi::api_req_sortie::battle::ApiData) -> Self {
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

        let empty = Vec::new();
        let cell_no = match KCS_CELLS.lock().unwrap().last() {
            Some(cell) => cell.clone(),
            None => 0,
        };

        Self {
            cell_id: cell_no,
            api_deck_id: battle.api_deck_id,
            formation: battle.api_formation,
            enemy_ship_id: battle.api_ship_ke,
            total_damages_friends: empty.clone(),
            total_damages_enemies: empty.clone(),
            reconnaissance: empty.clone(),
            forward_observe: empty.clone(),
            opening_air_Attack: None,
            opening_taisen: opening_taisen,
            opening_raigeki: opening_raigeki,
            hougeki: hougeki,
            closing_raigeki: closing_taigeki,
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