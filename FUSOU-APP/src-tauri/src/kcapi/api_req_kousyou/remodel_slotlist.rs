//! # kanColle API
//! KC APIs are also dependent on kcapi::kcapi_common.
//! The dependency graph of the APIs is shown below.
//! <div style="height: 80vh; overflow: scroll;">
//!   <img src="https://tsukasa-u.github.io/FUSOU/struct_dependency_svg/api_req_kousyou@remodel_slotlist.svg" alt="KC_API_dependency(api_req_kousyou/remodel_slotlist)" style="max-width: 2000px;"/>
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

use crate::interface::interface::EmitData;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Req {}

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_kousyou/remodel_slotlist")]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Res {
    #[serde(rename = "api_result")]
    pub api_result: i64,
    #[serde(rename = "api_result_msg")]
    pub api_result_msg: String,
    #[serde(rename = "api_data")]
    pub api_data: Vec<ApiData>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_slot_id")]
    pub api_slot_id: i64,
    #[serde(rename = "api_sp_type")]
    pub api_sp_type: i64,
    #[serde(rename = "api_req_fuel")]
    pub api_req_fuel: i64,
    #[serde(rename = "api_req_bull")]
    pub api_req_bull: i64,
    #[serde(rename = "api_req_steel")]
    pub api_req_steel: i64,
    #[serde(rename = "api_req_bauxite")]
    pub api_req_bauxite: i64,
    #[serde(rename = "api_req_buildkit")]
    pub api_req_buildkit: i64,
    #[serde(rename = "api_req_remodelkit")]
    pub api_req_remodelkit: i64,
    #[serde(rename = "api_req_slot_id")]
    pub api_req_slot_id: i64,
    #[serde(rename = "api_req_slot_num")]
    pub api_req_slot_num: i64,
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

        let pattern_str = "S@api_req_kousyou@remodel_slotlist";
        let log_path = "./src/kcapi/api_req_kousyou/remodel_slotlist.log";
        simple_root_test::<Res>(target_path, pattern_str.to_string(), log_path.to_string());
    }
}
