//! # kanColle API
//! KC APIs are also dependent on kcapi::kcapi_common.
//! The dependency graph of the APIs is shown below.
//! <div style="height: 80vh; overflow: scroll;">
//!   <img src="https://tsukasa-u.github.io/FUSOU/struct_dependency_svg/api_req_quest@clearitemget.svg" alt="KC_API_dependency(api_req_quest/clearitemget)" style="max-width: 2000px;"/>
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
    #[serde(rename = "api_quest_id")]
    pub api_quest_id: String,
}

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_quest/clearitemget")]
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
    #[serde(rename = "api_material")]
    pub api_material: Vec<i64>,
    #[serde(rename = "api_bounus_count")]
    pub api_bounus_count: i64,
    #[serde(rename = "api_bounus")]
    pub api_bounus: Vec<ApiBounu>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiBounu {
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_count")]
    pub api_count: i64,
    #[serde(rename = "api_item")]
    pub api_item: Option<ApiItem>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiItem {
    #[serde(rename = "api_id")]
    pub api_id: Option<i64>,
    #[serde(rename = "api_name")]
    pub api_name: Option<String>,
    #[serde(rename = "api_id_from")]
    pub api_id_from: Option<i64>,
    #[serde(rename = "api_id_to")]
    pub api_id_to: Option<i64>,
    #[serde(rename = "api_message")]
    pub api_message: Option<String>,
    #[serde(rename = "api_slotitem_level")]
    pub api_slotitem_level: Option<i64>,
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: Option<i64>,
    #[serde(rename = "api_getmes")]
    pub api_getmes: Option<String>,
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

        let pattern_str = "S@api_req_quest@clearitemget";
        let log_path = "./src/kcapi/api_req_quest/clearitemget@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_quest@clearitemget";
        let log_path = "./src/kcapi/api_req_quest/clearitemget@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
