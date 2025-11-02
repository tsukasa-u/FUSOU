#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/api_req_sortie@ld_airbattle.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_sortie/ld_airbattle)")]
#![doc = include_str!("../../../../../js/svg_pan_zoom.html")]

use serde::Deserialize;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::FieldSizeChecker;

use register_trait::TraitForRoot;
use register_trait::TraitForTest;



use crate::common::common_air::ApiAirBaseAttack;
use crate::common::common_air::ApiKouku;

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]

#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Req {
    #[serde(rename = "api_token")]
    pub api_token: String,
    #[serde(rename = "api_verno")]
    pub api_verno: String,
    #[serde(rename = "api_formation")]
    pub api_formation: String,
    #[serde(rename = "api_recovery_type")]
    pub api_recovery_type: String,
    #[serde(rename = "api_start")]
    pub api_start: Option<String>,
    #[serde(rename = "api_smoke_flag")]
    pub api_smoke_flag: Option<String>,
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_sortie/ld_airbattle")]
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
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_deck_id")]
    pub api_deck_id: i64,
    #[serde(rename = "api_formation")]
    pub api_formation: Vec<i64>,
    #[serde(rename = "api_f_nowhps")]
    pub api_f_nowhps: Vec<i64>,
    #[serde(rename = "api_f_maxhps")]
    pub api_f_maxhps: Vec<i64>,
    #[serde(rename = "api_fParam")]
    pub api_f_param: Vec<Vec<i64>>,
    #[serde(rename = "api_ship_ke")]
    pub api_ship_ke: Vec<i64>,
    #[serde(rename = "api_ship_lv")]
    pub api_ship_lv: Vec<i64>,
    #[serde(rename = "api_e_nowhps")]
    pub api_e_nowhps: Vec<i64>,
    #[serde(rename = "api_e_maxhps")]
    pub api_e_maxhps: Vec<i64>,
    #[serde(rename = "api_eSlot")]
    pub api_e_slot: Vec<Vec<i64>>,
    #[serde(rename = "api_eParam")]
    pub api_e_param: Vec<Vec<i64>>,
    #[serde(rename = "api_smoke_type")]
    pub api_smoke_type: i64,
    #[serde(rename = "api_balloon_cell")]
    pub api_balloon_cell: i64,
    #[serde(rename = "api_atoll_cell")]
    pub api_atoll_cell: i64,
    #[serde(rename = "api_midnight_flag")]
    pub api_midnight_flag: i64,
    #[serde(rename = "api_search")]
    pub api_search: Vec<i64>,
    #[serde(rename = "api_stage_flag")]
    pub api_stage_flag: Vec<i64>,
    #[serde(rename = "api_kouku")]
    pub api_kouku: ApiKouku,
    #[serde(rename = "api_escape_idx")]
    pub api_escape_idx: Option<Vec<i64>>,
    #[serde(rename = "api_air_base_attack")]
    pub api_air_base_attack: Option<Vec<ApiAirBaseAttack>>,
}

// #[derive(FieldSizeChecker, TraitForTest)]
// #[struct_test_case(field_extra, type_value, integration)]
// #[add_field(extra)]
// #[derive(Debug, Clone, Deserialize)]
// #[serde(rename_all = "camelCase")]
// pub struct ApiAirBaseAttack {
//     #[serde(rename = "api_base_id")]
//     api_base_id: i64,
//     #[serde(rename = "api_stage_flag")]
//     api_stage_flag: Vec<i64>,
//     #[serde(rename = "api_plane_from")]
//     api_plane_from: Vec<Option<Vec<i64>>>,
//     #[serde(rename = "api_squadron_plane")]
//     pub api_squadron_plane: Option<Vec<ApiSquadronPlane>>,
//     #[serde(rename = "api_stage1")]
//     pub api_stage1: ApiStage1,
//     #[serde(rename = "api_stage2")]
//     pub api_stage2: Option<ApiStage2>,
//     #[serde(rename = "api_stage3")]
//     pub api_stage3: Option<ApiStage3>,
// }

// #[derive(FieldSizeChecker, TraitForTest)]
// #[struct_test_case(field_extra, type_value, integration)]
// #[add_field(extra)]
// #[derive(Debug, Clone, Deserialize)]
// #[serde(rename_all = "camelCase")]
// pub struct ApiSquadronPlane {
//     #[serde(rename = "api_mst_id")]
//     api_mst_id: i64,
//     #[serde(rename = "api_count")]
//     api_count: i64,
// }

// #[derive(FieldSizeChecker, TraitForTest)]
// #[struct_test_case(field_extra, type_value, integration)]
// #[add_field(extra)]
// #[derive(Debug, Clone, Deserialize)]
// #[serde(rename_all = "camelCase")]
// pub struct ApiKouku {
//     #[serde(rename = "api_plane_from")]
//     pub api_plane_from: Vec<Option<Vec<i64>>>,
//     #[serde(rename = "api_stage1")]
//     pub api_stage1: ApiStage1,
//     #[serde(rename = "api_stage2")]
//     pub api_stage2: ApiStage2,
//     #[serde(rename = "api_stage3")]
//     pub api_stage3: Option<ApiStage3>,
// }

#[cfg(test)]
mod tests {
    use dotenvy::dotenv;
    use register_trait::simple_root_test;

    use super::*;
    #[test]
    fn test_deserialize() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = "S@api_req_sortie@ld_airbattle";
        let log_path = "./src/endpoints/api_req_sortie/ld_airbattle@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_sortie@ld_airbattle";
        let log_path = "./src/endpoints/api_req_sortie/ld_airbattle@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
