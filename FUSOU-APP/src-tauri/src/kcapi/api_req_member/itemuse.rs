//! # kanColle API
//! KC APIs are also dependent on kcapi::kcapi_common.
//! The dependency graph of the APIs is shown below.
//! <div style="height: 80vh; overflow: scroll;">
//!   <img src="https://tsukasa-u.github.io/FUSOU/struct_dependency_svg/api_req_member@itemuse.svg" alt="KC_API_dependency(api_req_member/itemuse)" style="max-width: 2000px;"/>
//! </div>

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
// use serde_json::Value;

use register_trait::register_struct;
use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;
use register_trait::TraitForRoot;
use register_trait::TraitForConvert;

use crate::interface::interface::EmitData;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_member/itemuse")]
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
    #[serde(rename = "api_caution_flag")]
    pub api_caution_flag: i64,
    #[serde(rename = "api_flag")]
    pub api_flag: i64,
    #[serde(rename = "api_getitem")]
    pub api_getitem: Option<Vec<ApiGetitem>>,
    #[serde(rename = "api_material")]
    pub api_material: Option<Vec<i64>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiGetitem {
    #[serde(rename = "api_usemst")]
    pub api_usemst: i64,
    #[serde(rename = "api_mst_id")]
    pub api_mst_id: i64,
    #[serde(rename = "api_getcount")]
    pub api_getcount: i64,
    #[serde(rename = "api_slotitem")]
    pub api_slotitem: Option<ApiSlotitem>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSlotitem {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_slotitem_id")]
    pub api_slotitem_id: i64,
    #[serde(rename = "api_locked")]
    pub api_locked: i64,
    #[serde(rename = "api_level")]
    pub api_level: i64,
    #[serde(rename = "api_alv")]
    pub api_alv: Option<i64>,
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

        let pattern_str = "S@api_req_member@itemuse";
        let log_path = "./src/kcapi/api_req_member/itemuse.log";
        simple_root_test::<Root>(target_path, pattern_str.to_string(), log_path.to_string());
    }
}