#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/api_req_hensei@preset_select.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_hensei/preset_select)")]
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
    #[qs(rename = "api_deck_id")]
    pub api_deck_id: i64,
    #[qs(rename = "api_preset_no")]
    pub api_preset_no: i64,
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[register_struct(name = "api_req_hensei/preset_select")]
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
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_name_id")]
    pub api_name_id: String,
    #[serde(rename = "api_mission")]
    pub api_mission: Vec<i64>,
    #[serde(rename = "api_flagship")]
    pub api_flagship: String,
    #[serde(rename = "api_ship")]
    pub api_ship: Vec<i64>,
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

        let pattern_str = "S@api_req_hensei@preset_select";
        let log_path = "./src/endpoints/api_req_hensei/preset_select@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_hensei@preset_select";
        let log_path = "./src/endpoints/api_req_hensei/preset_select@Q.log";
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

        let req_and_res_pattern_str = "@api_req_hensei@preset_select";
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
