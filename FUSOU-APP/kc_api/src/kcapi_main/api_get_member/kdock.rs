#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_get_member@kdock.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_get_member/kdock)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

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
#[register_struct(name = "api_get_member/kdock")]
#[derive(Debug, Clone, Deserialize)]
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
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_state")]
    pub api_state: i64,
    #[serde(rename = "api_created_ship_id")]
    pub api_created_ship_id: i64,
    #[serde(rename = "api_complete_time")]
    pub api_complete_time: i64,
    #[serde(rename = "api_complete_time_str")]
    pub api_complete_time_str: String,
    #[serde(rename = "api_item1")]
    pub api_item1: i64,
    #[serde(rename = "api_item2")]
    pub api_item2: i64,
    #[serde(rename = "api_item3")]
    pub api_item3: i64,
    #[serde(rename = "api_item4")]
    pub api_item4: i64,
    #[serde(rename = "api_item5")]
    pub api_item5: i64,
}

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;
    #[test]
    fn test_deserialize() {
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = "S@api_get_member@kdock";
        let log_path = "./src/kcapi_main/api_get_member/kdock@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_get_member@kdock";
        let log_path = "./src/kcapi_main/api_get_member/kdock@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
