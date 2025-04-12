//! # kanColle API
//! KC APIs are also dependent on kcapi::kcapi_common.
//! The dependency graph of the APIs is shown below.
//! <div style="height: 80vh; overflow: scroll;">
//!   <img src="https://tsukasa-u.github.io/FUSOU/struct_dependency_svg/api_get_member@preset_slot.svg" alt="KC_API_dependency(api_get_member/preset_slot)" style="max-width: 2000px;"/>
//! </div>

use serde::Deserialize;
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
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Req {
    #[serde(rename = "api_token")]
    pub api_token: String,
    #[serde(rename = "api_verno")]
    pub api_verno: String,
}

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_get_member/preset_slot")]
#[derive(Debug, Clone, Deserialize)]
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
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_max_num")]
    pub api_max_num: i64,
    #[serde(rename = "api_preset_items")]
    pub api_preset_items: Vec<ApiPresetItem>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiPresetItem {
    #[serde(rename = "api_preset_no")]
    pub api_preset_no: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_selected_mode")]
    pub api_selected_mode: i64,
    #[serde(rename = "api_lock_flag")]
    pub api_lock_flag: i64,
    #[serde(rename = "api_slot_ex_flag")]
    pub api_slot_ex_flag: i64,
    #[serde(rename = "api_slot_item")]
    pub api_slot_item: Vec<ApiSlotItem>,
    #[serde(rename = "api_slot_item_ex")]
    pub api_slot_item_ex: Option<ApiSlotItemEx>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSlotItem {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_level")]
    pub api_level: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSlotItemEx {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_level")]
    pub api_level: i64,
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

        let pattern_str = "S@api_get_member@preset_slot";
        let log_path = "./src/kcapi/api_get_member/preset_slot@S.log";
        simple_root_test::<Res>(target_path.clone(), pattern_str.to_string(), log_path.to_string());

        let pattern_str = "Q@api_get_member@preset_slot";
        let log_path = "./src/kcapi/api_get_member/preset_slot@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
