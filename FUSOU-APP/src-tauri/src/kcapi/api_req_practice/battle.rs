//! # kanColle API
//! KC APIs are also dependent on kcapi::kcapi_common.
//! The dependency graph of the APIs is shown below.
//! <div style="height: 80vh; overflow: scroll;">
//!   <img src="https://tsukasa-u.github.io/FUSOU/struct_dependency_svg/api_req_practice@battle.svg" alt="KC_API_dependency(api_req_practice/battle)" style="max-width: 2000px;"/>
//! </div>

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use register_trait::register_struct;
use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;
use register_trait::TraitForRoot;
use register_trait::TraitForConvert;

use crate::interface::interface::EmitData;

use crate::kcapi_common::common_air::ApiStage1;
use crate::kcapi_common::common_air::ApiStage2;
use crate::kcapi_common::common_air::ApiStage3;
use crate::kcapi_common::common_air::ApiKouku;
use crate::kcapi_common::common_battle::ApiRaigeki;
use crate::kcapi_common::common_battle::ApiHougeki;
use crate::kcapi_common::common_battle::ApiOpeningTaisen;
use crate::kcapi_common::common_battle::ApiOpeningAtack;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_practice/battle")]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    #[serde(rename = "api_result")]
    pub api_result: i64,
    #[serde(rename = "api_result_msg")]
    pub api_result_msg: String,
    #[serde(rename = "api_data")]
    pub api_data: ApiData,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_deck_id")]
    pub api_deck_id: i64,
    #[serde(rename = "api_formation")]
    pub api_formation: Vec<i64>,
    #[serde(rename = "api_f_nowhps")]
    pub api_f_nowhps: Vec<i64>,
    #[serde(rename = "api_f_maxhps")]
    pub api_f_maxhps: Vec<i64>,
    #[serde(rename = "api_fParam")]
    pub api_f_param: Vec<Vec<i64>>,
    #[serde(rename = "api_ship_ke")]
    pub api_ship_ke: Vec<i64>,
    #[serde(rename = "api_ship_lv")]
    pub api_ship_lv: Vec<i64>,
    #[serde(rename = "api_e_nowhps")]
    pub api_e_nowhps: Vec<i64>,
    #[serde(rename = "api_e_maxhps")]
    pub api_e_maxhps: Vec<i64>,
    #[serde(rename = "api_eSlot")]
    pub api_e_slot: Vec<Vec<i64>>,
    #[serde(rename = "api_eParam")]
    pub api_e_param: Vec<Vec<i64>>,
    #[serde(rename = "api_e_effect_list")]
    pub api_e_effect_list: Vec<Vec<i64>>,
    #[serde(rename = "api_smoke_type")]
    pub api_smoke_type: i64,
    #[serde(rename = "api_balloon_cell")]
    pub api_balloon_cell: i64,
    #[serde(rename = "api_atoll_cell")]
    pub api_atoll_cell: i64,
    #[serde(rename = "api_midnight_flag")]
    pub api_midnight_flag: i64,
    #[serde(rename = "api_search")]
    pub api_search: Vec<i64>,
    #[serde(rename = "api_stage_flag")]
    pub api_stage_flag: Vec<i64>,
    #[serde(rename = "api_kouku")]
    pub api_kouku: ApiKouku,
    // #[serde(rename = "api_support_flag")]
    // pub api_support_flag: Value,
    // #[serde(rename = "api_support_info")]
    // pub api_support_info: Value,
    #[serde(rename = "api_opening_taisen_flag")]
    pub api_opening_taisen_flag: i64,
    #[serde(rename = "api_opening_taisen")]
    pub api_opening_taisen: Option<ApiOpeningTaisen>,
    #[serde(rename = "api_opening_flag")]
    pub api_opening_flag: i64,
    #[serde(rename = "api_opening_atack")]
    pub api_opening_atack: Option<ApiOpeningAtack>,
    #[serde(rename = "api_hourai_flag")]
    pub api_hourai_flag: Vec<i64>,
    #[serde(rename = "api_hougeki1")]
    pub api_hougeki1: Option<ApiHougeki>,
    #[serde(rename = "api_hougeki2")]
    pub api_hougeki2: Option<ApiHougeki>,
    #[serde(rename = "api_hougeki3")]
    pub api_hougeki3: Value,
    #[serde(rename = "api_raigeki")]
    pub api_raigeki: Option<ApiRaigeki>,
    #[serde(rename = "api_flavor_info")]
    pub api_flavor_info: Option<Vec<ApiFlavoInfo>>,
    #[serde(rename = "api_injection_kouku")]
    pub api_injection_kouku: Option<ApiKouku>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFlavoInfo {
    #[serde(rename = "api_boss_ship_id")]
    pub api_boss_ship_id: String,
    #[serde(rename = "api_type")]
    pub api_type: String,
    #[serde(rename = "api_voice_id")]
    pub api_voice_id: String,
    #[serde(rename = "api_class_name")]
    pub api_class_name: String,
    #[serde(rename = "api_ship_name")]
    pub api_ship_name: String,
    #[serde(rename = "api_message")]
    pub api_message: String,
    #[serde(rename = "api_pos_x")]
    pub api_pos_x: String,
    #[serde(rename = "api_pos_y")]
    pub api_pos_y: String,
    #[serde(rename = "api_data")]
    pub api_data: String,
}

// impl TraitForConvert for Root {
//     type Output = EmitData;
//     fn convert(&self) -> Option<Vec<EmitData>> {
//         let materials: Materials = self.api_data.api_material.clone().into();
//         let ships: Ships = self.api_data.api_ship.clone().into();
//         let ndocks: NDocks = self.api_data.api_ndock.clone().into();
//         let logs: Logs = self.api_data.api_log.clone().into();
//         let deck_ports: DeckPorts = self.api_data.api_deck_port.clone().into();
//         deck_ports.restore();
//         Some(vec![
//             EmitData::Set(Set::Materials(materials)), 
//             EmitData::Set(Set::Ships(ships)), 
//             EmitData::Set(Set::NDocks(ndocks)), 
//             EmitData::Set(Set::Logs(logs)), 
//             EmitData::Set(Set::DeckPorts(deck_ports))])
//     }
// }

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;
    use dotenvy::dotenv;
    use std::env;

    #[test]
    fn test_deserialize() {
        
        let mut target_path = "./../../FUSOU-PROXY-DATA/kcsapi".to_string();
    
        dotenv().expect(".env file not found");
        for (key, value) in env::vars() {
            if key.eq("TEST_DATA_PATH") {
                target_path = value.clone();
            }
        }

        let pattern_str = "S@api_req_practice@battle";
        let log_path = "./src/kcapi/api_req_practice/battle.log";
        simple_root_test::<Root>(target_path, pattern_str.to_string(), log_path.to_string());
    }
}