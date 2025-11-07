#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/api_req_mission@result.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_mission/result)")]
#![doc = include_str!("../../../../../js/svg_pan_zoom.html")]

use serde::Deserialize;

use crate::common::custom_type::DuoType;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::FieldSizeChecker;

use register_trait::TraitForRoot;
use register_trait::TraitForTest;
use register_trait::QueryWithExtra;



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
    pub api_deck_id: String,
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]

#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[register_struct(name = "api_req_mission/result")]
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

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: Vec<i64>,
    #[serde(rename = "api_clear_result")]
    pub api_clear_result: i64,
    #[serde(rename = "api_get_exp")]
    pub api_get_exp: i64,
    #[serde(rename = "api_member_lv")]
    pub api_member_lv: i64,
    #[serde(rename = "api_member_exp")]
    pub api_member_exp: i64,
    #[serde(rename = "api_get_ship_exp")]
    pub api_get_ship_exp: Vec<i64>,
    #[serde(rename = "api_get_exp_lvup")]
    pub api_get_exp_lvup: Vec<Vec<i64>>,
    #[serde(rename = "api_maparea_name")]
    pub api_maparea_name: String,
    #[serde(rename = "api_detail")]
    pub api_detail: String,
    #[serde(rename = "api_quest_name")]
    pub api_quest_name: String,
    #[serde(rename = "api_quest_level")]
    pub api_quest_level: i64,
    #[serde(rename = "api_get_material")]
    pub api_get_material: Option<DuoType<Vec<i64>, i64>>,
    #[serde(rename = "api_useitem_flag")]
    pub api_useitem_flag: Vec<i64>,
    #[serde(rename = "api_get_item1")]
    pub api_get_item1: Option<ApiGetItem>,
    #[serde(rename = "api_get_item2")]
    pub api_get_item2: Option<ApiGetItem>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiGetItem {
    #[serde(rename = "api_useitem_id")]
    pub api_useitem_id: i64,
    #[serde(rename = "api_useitem_name")]
    pub api_useitem_name: Option<String>,
    #[serde(rename = "api_useitem_count")]
    pub api_useitem_count: i64,
}

#[cfg(test)]
mod tests {
    use dotenvy::dotenv;
    use register_trait::simple_root_test;

    use super::*;
    #[test]
    fn test_deserialize() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = "S@api_req_mission@result";
        let log_path = "./src/endpoints/api_req_mission/result@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_mission@result";
        let log_path = "./src/endpoints/api_req_mission/result@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
