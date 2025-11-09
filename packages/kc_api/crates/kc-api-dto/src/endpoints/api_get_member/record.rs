#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/api_get_member@record.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_get_member/record)")]
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
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[register_struct(name = "api_get_member/record")]
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
    #[serde(rename = "api_member_id")]
    pub api_member_id: i64,
    #[serde(rename = "api_nickname")]
    pub api_nickname: String,
    #[serde(rename = "api_nickname_id")]
    pub api_nickname_id: String,
    #[serde(rename = "api_cmt")]
    pub api_cmt: String,
    #[serde(rename = "api_cmt_id")]
    pub api_cmt_id: String,
    #[serde(rename = "api_photo_url")]
    pub api_photo_url: String,
    #[serde(rename = "api_level")]
    pub api_level: i64,
    #[serde(rename = "api_rank")]
    pub api_rank: i64,
    #[serde(rename = "api_experience")]
    pub api_experience: Vec<i64>,
    #[serde(rename = "api_war")]
    pub api_war: ApiWar,
    #[serde(rename = "api_mission")]
    pub api_mission: ApiMission,
    #[serde(rename = "api_practice")]
    pub api_practice: ApiPractice,
    #[serde(rename = "api_friend")]
    pub api_friend: i64,
    #[serde(rename = "api_deck")]
    pub api_deck: i64,
    #[serde(rename = "api_kdoc")]
    pub api_kdoc: i64,
    #[serde(rename = "api_ndoc")]
    pub api_ndoc: i64,
    #[serde(rename = "api_ship")]
    pub api_ship: Vec<i64>,
    #[serde(rename = "api_slotitem")]
    pub api_slotitem: Vec<i64>,
    #[serde(rename = "api_furniture")]
    pub api_furniture: i64,
    #[serde(rename = "api_complate")]
    pub api_complate: Vec<String>,
    #[serde(rename = "api_large_dock")]
    pub api_large_dock: i64,
    #[serde(rename = "api_material_max")]
    pub api_material_max: i64,
    #[serde(rename = "api_air_base_expanded_info")]
    pub api_air_base_expanded_info: Vec<ApiAirBaseExpandedInfo>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiWar {
    #[serde(rename = "api_win")]
    pub api_win: String,
    #[serde(rename = "api_lose")]
    pub api_lose: String,
    #[serde(rename = "api_rate")]
    pub api_rate: String,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMission {
    #[serde(rename = "api_count")]
    pub api_count: String,
    #[serde(rename = "api_success")]
    pub api_success: String,
    #[serde(rename = "api_rate")]
    pub api_rate: String,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiPractice {
    #[serde(rename = "api_win")]
    pub api_win: String,
    #[serde(rename = "api_lose")]
    pub api_lose: String,
    #[serde(rename = "api_rate")]
    pub api_rate: String,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiAirBaseExpandedInfo {
    #[serde(rename = "api_area_id")]
    pub api_area_id: i64,
    #[serde(rename = "api_maintenance_level")]
    pub api_maintenance_level: i64,
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

        let pattern_str = "S@api_get_member@record";
        let log_path = "./src/endpoints/api_get_member/record@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_get_member@record";
        let log_path = "./src/endpoints/api_get_member/record@Q.log";
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

        let req_and_res_pattern_str = "@api_get_member@record";
        let snap_path = format!("{snap_file_path}/kcsapi");
        glob_match_normalize::<Req, Res>(
            target_path.clone(),
            req_and_res_pattern_str.to_string(),
            snap_path.to_string(),
            FormatType::Json,
        );

        glob_match_normalize::<Req, Res>(
            target_path.clone(),
            req_and_res_pattern_str.to_string(),
            snap_path.to_string(),
            FormatType::QueryString,
        );
    }

}
