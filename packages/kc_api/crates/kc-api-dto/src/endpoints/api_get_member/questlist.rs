#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/api_get_member@questlist.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_get_member/questlist)")]
#![doc = include_str!("../../../../../js/svg_pan_zoom.html")]

use serde::{Deserialize, Serialize};

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
    #[qs(rename = "api_tab_id")]
    pub api_tab_id: i64,
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[register_struct(name = "api_get_member/questlist")]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Res {
    #[serde(rename = "api_result")]
    pub api_result: Option<i64>,
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
    #[serde(rename = "api_count")]
    pub api_count: i64,
    #[serde(rename = "api_completed_kind")]
    pub api_completed_kind: i64,
    #[serde(rename = "api_list")]
    pub api_list: Option<Vec<ApiList>>,
    #[serde(rename = "api_exec_count")]
    pub api_exec_count: i64,
    #[serde(rename = "api_exec_type")]
    pub api_exec_type: i64,
    #[serde(rename = "api_c_list")]
    pub api_c_list: Option<Vec<ApiCList>>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCList {
    #[serde(rename = "api_no")]
    pub api_no: i64,
    #[serde(rename = "api_state")]
    pub api_state: i64,
    #[serde(rename = "api_progress_flag")]
    pub api_progress_flag: i64,
    #[serde(rename = "api_c_flag")]
    pub api_c_flag: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiList {
    #[serde(rename = "api_no")]
    pub api_no: i64,
    #[serde(rename = "api_category")]
    pub api_category: i64,
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_label_type")]
    pub api_label_type: i64,
    #[serde(rename = "api_state")]
    pub api_state: i64,
    #[serde(rename = "api_title")]
    pub api_title: String,
    #[serde(rename = "api_detail")]
    pub api_detail: String,
    #[serde(rename = "api_voice_id")]
    pub api_voice_id: i64,
    #[serde(rename = "api_get_material")]
    pub api_get_material: Vec<i64>,
    #[serde(rename = "api_bonus_flag")]
    pub api_bonus_flag: i64,
    #[serde(rename = "api_progress_flag")]
    pub api_progress_flag: i64,
    #[serde(rename = "api_invalid_flag")]
    pub api_invalid_flag: i64,
    #[serde(rename = "api_lost_badges")]
    pub api_lost_badges: Option<i64>,
    #[serde(rename = "api_select_rewards")]
    pub api_select_rewards: Option<Vec<Vec<ApiSelectRewards>>>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSelectRewards {
    #[serde(rename = "api_no")]
    pub api_no: i64,
    #[serde(rename = "api_kind")]
    pub api_kind: i64,
    #[serde(rename = "api_mst_id")]
    pub api_mst_id: i64,
    #[serde(rename = "api_count")]
    pub api_count: i64,
    #[serde(rename = "api_slotitem_level")]
    pub api_slotitem_level: Option<i64>,
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

        let pattern_str = "S@api_get_member@questlist";
        let log_path = "./src/endpoints/api_get_member/questlist@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_get_member@questlist";
        let log_path = "./src/endpoints/api_get_member/questlist@Q.log";
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

        let req_and_res_pattern_str = "@api_get_member@questlist";
        let snap_path = format!("{snap_file_path}/kcsapi");
        let log_path = "./src/endpoints/api_get_member/questlist@snap_data@S.log";
        glob_match_normalize::<Req, Res>(
            target_path.clone(),
            req_and_res_pattern_str.to_string(),
            snap_path.to_string(),
            FormatType::Json,
            log_path.to_string(),
        );

        let log_path = "./src/endpoints/api_get_member/questlist@snap_data@Q.log";
        glob_match_normalize::<Req, Res>(
            target_path.clone(),
            req_and_res_pattern_str.to_string(),
            snap_path.to_string(),
            FormatType::QueryString,
            log_path.to_string(),
        );
    }

}
