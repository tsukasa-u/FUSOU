//! # kanColle API
//! KC APIs are also dependent on kcapi::kcapi_common.
//! The dependency graph of the APIs is shown below.
//! <div style="height: 80vh; overflow: scroll;">
//!   <img src="https://tsukasa-u.github.io/FUSOU/struct_dependency_svg/api_req_sortie@battle.svg" alt="KC_API_dependency(api_req_sortie/battle)" style="max-width: 2000px;"/>
//! </div>

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
// use serde_json::Value;

use register_trait::{add_field, register_struct};

use register_trait::{Getter, TraitForConvert, TraitForRoot, TraitForTest};

use crate::interface::interface::{Add, EmitData};
// use crate::interface::ship::Ships;
use crate::interface::battle::Battle;

use crate::kcapi_common::common_air::ApiAirBaseAttack;
use crate::kcapi_common::common_air::ApiAirBaseInjection;
use crate::kcapi_common::common_air::ApiKouku;
use crate::kcapi_common::common_battle::ApiFlavoInfo;
use crate::kcapi_common::common_battle::ApiHougeki;
use crate::kcapi_common::common_battle::ApiOpeningAtack;
use crate::kcapi_common::common_battle::ApiOpeningTaisen;
use crate::kcapi_common::common_battle::ApiRaigeki;
use crate::kcapi_common::common_battle::ApiSupportInfo;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Req {}

#[derive(Getter, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_sortie/battle")]
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
    #[serde(rename = "api_e_nowhps")]
    pub api_e_nowhps: Vec<i64>,
    #[serde(rename = "api_e_maxhps")]
    pub api_e_maxhps: Vec<i64>,
    #[serde(rename = "api_eSlot")]
    pub api_e_slot: Vec<Vec<i64>>,
    #[serde(rename = "api_eParam")]
    pub api_e_param: Vec<Vec<i64>>,
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
    #[serde(rename = "api_support_flag")]
    pub api_support_flag: i64,
    #[serde(rename = "api_support_info")]
    pub api_support_info: Option<ApiSupportInfo>,
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
    pub api_hougeki3: Option<ApiHougeki>,
    #[serde(rename = "api_raigeki")]
    pub api_raigeki: Option<ApiRaigeki>,
    #[serde(rename = "api_flavor_info")]
    pub api_flavor_info: Option<Vec<ApiFlavoInfo>>,
    #[serde(rename = "api_air_base_attack")]
    pub api_air_base_attack: Option<Vec<ApiAirBaseAttack>>,
    #[serde(rename = "api_escape_idx")]
    pub api_escape_idx: Option<Vec<i64>>,
    #[serde(rename = "api_injection_kouku")]
    pub api_injection_kouku: Option<ApiKouku>,
    #[serde(rename = "api_air_base_injection")]
    pub api_air_base_injection: Option<ApiAirBaseInjection>,
}

impl TraitForConvert for Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        // let ships: Ships = self.api_data.clone().into();
        let battle: Battle = self.api_data.clone().into();
        Some(vec![
            // EmitData::Add(Add::Ships(ships)),
            EmitData::Add(Add::Battle(battle)),
        ])
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

        let pattern_str = "S@api_req_sortie@battle";
        let log_path = "./src/kcapi/api_req_sortie/battle@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_sortie@battle";
        let log_path = "./src/kcapi/api_req_sortie/battle@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
