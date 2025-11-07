#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/api_req_kousyou@remodel_slotlist.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_kousyou/remodel_slotlist)")]
#![doc = include_str!("../../../../../js/svg_pan_zoom.html")]

use serde::Deserialize;

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
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]

#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[register_struct(name = "api_req_kousyou/remodel_slotlist")]
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

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
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
    use dotenvy::dotenv;
    use register_trait::simple_root_test;

    use super::*;
    #[test]
    fn test_deserialize() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = "S@api_req_kousyou@remodel_slotlist";
        let log_path = "./src/endpoints/api_req_kousyou/remodel_slotlist@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_kousyou@remodel_slotlist";
        let log_path = "./src/endpoints/api_req_kousyou/remodel_slotlist@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
