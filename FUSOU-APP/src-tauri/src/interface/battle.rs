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
    pub total_damages_friends: Vec<i64>,
    pub total_damages_enemies: Vec<i64>,
    pub reconnaissance: Vec<i64>,
    pub forward_observe: Vec<i64>,
    // pub air_base_force_jet_assault: Option<Vec<i64>>,
    // pub force_jet_assault: Option<Vec<i64>>,
    // pub AirBaseCombat: Option<AirBaseCombat>,
    // pub Mobile TaskForceFriendlyAirCombat: Option<MobileTaskForceFriendlyAirCombat>
    // pub opening_kouku: Option<Kouku>,
    // pub support_attack: Option<SupportAttack>,
    pub opening_taisen: Option<OpeningTaisen>,
    pub opening_raigeki: Option<OpeningRaigeki>,
    pub hougeki: Option<Vec<Option<Hougeki>>>,
    pub ending_raigeki: Option<EndingRaigeki>,
    // pub friendly_fleet_attack: Option<FriendlyFleetAttack>,
    // pub midnight_hougeki: Option<Vec<Option<Hougeki>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpeningRaigeki {
    pub fdam: Vec<f32>,
    pub edam: Vec<f32>,
    pub fydam: Vec<Option<Vec<i64>>>,
    pub eydam: Vec<Option<Vec<i64>>>,
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
pub struct EndingRaigeki {
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

impl From<kcapi::api_req_sortie::battle::ApiData> for Battle {
    fn from(battle: kcapi::api_req_sortie::battle::ApiData) -> Self {
        let opening_taisen: Option<OpeningTaisen> = match battle.api_opening_taisen {
            Some(opening_taisen) => Some(opening_taisen.into()),
            None => None,
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
            total_damages_friends: empty.clone(),
            total_damages_enemies: empty.clone(),
            reconnaissance: empty.clone(),
            forward_observe: empty.clone(),
            opening_taisen: opening_taisen,
            opening_raigeki: None,
            hougeki: None,
            ending_raigeki: None,
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