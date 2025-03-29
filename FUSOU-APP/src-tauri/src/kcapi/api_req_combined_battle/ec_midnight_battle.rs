//! # kanColle API
//! KC APIs are also dependent on kcapi::kcapi_common.
//! The dependency graph of the APIs is shown below.
//! <div style="height: 80vh; overflow: scroll;">
//!   <img src="https://tsukasa-u.github.io/FUSOU/struct_dependency_svg/api_req_combined_battle@ec_midnight_battle.svg" alt="KC_API_dependency(api_req_combined_battle/ec_midnight_battle)" style="max-width: 2000px;"/>
//! </div>

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
// use serde_json::Value;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::Getter;
use register_trait::TraitForConvert;
use register_trait::TraitForRoot;
use register_trait::TraitForTest;

use crate::interface::battle::Battle;
use crate::interface::interface::Add;
use crate::kcapi_common::common_midnight::ApiFriendlyBattle;
use crate::kcapi_common::common_midnight::ApiFriendlyInfo;
use crate::kcapi_common::common_midnight::ApiHougeki;

use crate::interface::interface::EmitData;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Req {
    #[serde(rename = "api_token")]
    pub api_token: String,
    #[serde(rename = "api_verno")]
    pub api_verno: String,
}

#[derive(Getter, TraitForTest, TraitForRoot, )]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_combined_battle/ec_midnight_battle")]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Res {
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
    #[serde(rename = "api_ship_ke_combined")]
    pub api_ship_ke_combined: Vec<i64>,
    #[serde(rename = "api_ship_lv_combined")]
    pub api_ship_lv_combined: Vec<i64>,
    #[serde(rename = "api_e_nowhps")]
    pub api_e_nowhps: Vec<i64>,
    #[serde(rename = "api_e_maxhps")]
    pub api_e_maxhps: Vec<i64>,
    #[serde(rename = "api_e_nowhps_combined")]
    pub api_e_nowhps_combined: Vec<i64>,
    #[serde(rename = "api_e_maxhps_combined")]
    pub api_e_maxhps_combined: Vec<i64>,
    #[serde(rename = "api_eSlot")]
    pub api_e_slot: Vec<Vec<i64>>,
    #[serde(rename = "api_eSlot_combined")]
    pub api_e_slot_combined: Vec<Vec<i64>>,
    #[serde(rename = "api_eParam")]
    pub api_e_param: Vec<Vec<i64>>,
    #[serde(rename = "api_eParam_combined")]
    pub api_e_param_combined: Vec<Vec<i64>>,
    #[serde(rename = "api_smoke_type")]
    pub api_smoke_type: i64,
    #[serde(rename = "api_balloon_cell")]
    pub api_balloon_cell: i64,
    #[serde(rename = "api_atoll_cell")]
    pub api_atoll_cell: i64,
    #[serde(rename = "api_active_deck")]
    pub api_active_deck: Vec<i64>,
    #[serde(rename = "api_touch_plane")]
    pub api_touch_plane: Vec<i64>,
    #[serde(rename = "api_flare_pos")]
    pub api_flare_pos: Vec<i64>,
    #[serde(rename = "api_hougeki")]
    pub api_hougeki: ApiHougeki,
    #[serde(rename = "api_escape_idx")]
    pub api_escape_idx: Option<Vec<i64>>,
    #[serde(rename = "api_escape_idx_combined")]
    pub api_escape_idx_combined: Option<Vec<i64>>,
    #[serde(rename = "api_f_nowhps_combined")]
    pub api_f_nowhps_combined: Option<Vec<i64>>,
    #[serde(rename = "api_f_maxhps_combined")]
    pub api_f_maxhps_combined: Option<Vec<i64>>,
    #[serde(rename = "api_fParam_combined")]
    pub api_f_param_combined: Option<Vec<Vec<i64>>>,
    #[serde(rename = "api_friendly_battle")]
    pub api_friendly_battle: Option<ApiFriendlyBattle>,
    #[serde(rename = "api_friendly_info")]
    pub api_friendly_info: Option<ApiFriendlyInfo>,
}

impl TraitForConvert for Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let battle: Battle = self.api_data.clone().into();
        Some(vec![EmitData::Add(Add::Battle(battle))])
    }
}

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

        let pattern_str = "S@api_req_combined_battle@ec_midnight_battle";
        let log_path = "./src/kcapi/api_req_combined_battle/ec_midnight_battle@S.log";
        simple_root_test::<Res>(target_path.clone(), pattern_str.to_string(), log_path.to_string());

        let pattern_str = "Q@api_req_combined_battle@ec_midnight_battle";
        let log_path = "./src/kcapi/api_req_combined_battle/ec_midnight_battle@Q.log";
        simple_root_test::<Req>(target_path.clone(), pattern_str.to_string(), log_path.to_string());
    }
}
