#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/api_get_member@require_info.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_get_member/require_info)")]
#![doc = include_str!("../../../../../js/svg_pan_zoom.html")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use register_trait::{add_field, register_struct};
use register_trait::{FieldSizeChecker, QueryWithExtra, TraitForRoot, TraitForTest};

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_for_qs)]
#[derive(Debug, Clone, QueryWithExtra)]
pub struct Req {
    #[qs(rename = "api_token")]
    pub api_token: String,
    #[qs(rename = "api_verno")]
    pub api_verno: i64,
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[register_struct(name = "api_get_member/require_info")]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Res {
    #[serde(rename = "api_result")]
    pub api_result: i64,
    #[serde(rename = "api_result_msg")]
    pub api_result_msg: String,
    #[serde(rename = "api_data")]
    pub api_data: ApiData,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_basic")]
    pub api_basic: ApiBasic,
    #[serde(rename = "api_slot_item")]
    pub api_slot_item: Vec<ApiSlotItem>,
    #[serde(rename = "api_unsetslot")]
    pub api_unsetslot: HashMap<String, Vec<i64>>,
    #[serde(rename = "api_kdock")]
    pub api_kdock: Vec<ApiKdock>,
    #[serde(rename = "api_useitem")]
    pub api_useitem: Vec<ApiUseitem>,
    #[serde(rename = "api_furniture")]
    pub api_furniture: Vec<ApiFurniture>,
    #[serde(rename = "api_extra_supply")]
    pub api_extra_supply: Vec<i64>,
    #[serde(rename = "api_oss_setting")]
    pub api_oss_setting: ApiOssSetting,
    #[serde(rename = "api_skin_id")]
    pub api_skin_id: i64,
    #[serde(rename = "api_position_id")]
    pub api_position_id: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiBasic {
    #[serde(rename = "api_member_id")]
    pub api_member_id: i64,
    #[serde(rename = "api_firstflag")]
    pub api_firstflag: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSlotItem {
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

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKdock {
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

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiUseitem {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_count")]
    pub api_count: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFurniture {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_furniture_type")]
    pub api_furniture_type: i64,
    #[serde(rename = "api_furniture_no")]
    pub api_furniture_no: i64,
    #[serde(rename = "api_furniture_id")]
    pub api_furniture_id: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiOssSetting {
    #[serde(rename = "api_language_type")]
    pub api_language_type: i64,
    #[serde(rename = "api_oss_items")]
    pub api_oss_items: Vec<i64>,
}

#[cfg(test)]
mod tests {
    use crate::test_utils::struct_normalize::{glob_match_normalize, FormatType};
    use dotenvy::dotenv;
    use register_trait::simple_root_test;

    use super::*;
    #[test]
    fn test_deserialize() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = "S@api_get_member@require_info";
        let log_path = "./src/endpoints/api_get_member/require_info@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_get_member@require_info";
        let log_path = "./src/endpoints/api_get_member/require_info@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
    #[test]
    fn test_organize_test_data() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");
        let snap_file_path = std::env::var("TEST_DATA_REPO_PATH").expect("failed to get env data");

        let req_and_res_pattern_str = "@api_get_member@require_info";
        let snap_path = format!("{snap_file_path}/kcsapi");
        let log_path = "./src/endpoints/api_get_member/require_info@snap_data@S.log";
        glob_match_normalize::<Req, Res>(
            target_path.clone(),
            req_and_res_pattern_str.to_string(),
            snap_path.to_string(),
            FormatType::Json,
            log_path.to_string(),
        );

        let log_path = "./src/endpoints/api_get_member/require_info@snap_data@Q.log";
        glob_match_normalize::<Req, Res>(
            target_path.clone(),
            req_and_res_pattern_str.to_string(),
            snap_path.to_string(),
            FormatType::QueryString,
            log_path.to_string(),
        );
    }

}
