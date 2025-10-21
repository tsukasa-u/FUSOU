#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_sortie@ld_airbattle.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_sortie/ld_airbattle)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::NumberSizeChecker;
use register_trait::TraitForConvert;
use register_trait::TraitForRoot;
use register_trait::TraitForTest;

use crate::interface::battle::Battle;
use crate::interface::interface::{Add, EmitData};

use crate::kcapi_common::common_air::ApiAirBaseAttack;
use crate::kcapi_common::common_air::ApiKouku;

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct Req {
    pub api_token: String,
    pub api_verno: String,
    pub api_formation: String,
    pub api_recovery_type: String,
    pub api_start: Option<String>,
    pub api_smoke_flag: Option<String>,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_sortie/ld_airbattle")]
#[derive(Debug, Clone, Deserialize)]
pub struct Res {
    pub api_result: i64,
    pub api_result_msg: String,
    pub api_data: ApiData,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiData {
    pub api_deck_id: i64,
    pub api_formation: Vec<i64>,
    pub api_f_nowhps: Vec<i64>,
    pub api_f_maxhps: Vec<i64>,
    #[serde(rename = "api_fParam")]
    pub api_f_param: Vec<Vec<i64>>,
    pub api_ship_ke: Vec<i64>,
    pub api_ship_lv: Vec<i64>,
    pub api_e_nowhps: Vec<i64>,
    pub api_e_maxhps: Vec<i64>,
    #[serde(rename = "api_eSlot")]
    pub api_e_slot: Vec<Vec<i64>>,
    #[serde(rename = "api_eParam")]
    pub api_e_param: Vec<Vec<i64>>,
    pub api_smoke_type: i64,
    pub api_balloon_cell: i64,
    pub api_atoll_cell: i64,
    pub api_midnight_flag: i64,
    pub api_search: Vec<i64>,
    pub api_stage_flag: Vec<i64>,
    pub api_kouku: ApiKouku,
    pub api_escape_idx: Option<Vec<i64>>,
    pub api_air_base_attack: Option<Vec<ApiAirBaseAttack>>,
}

// #[derive(NumberSizeChecker, TraitForTest)]
// #[struct_test_case(field_extra, type_value, integration)]
// #[add_field(extra)]
// #[derive(Debug, Clone, Deserialize)]
// pub struct ApiAirBaseAttack {
//     api_base_id: i64,
//     api_stage_flag: Vec<i64>,
//     api_plane_from: Vec<Option<Vec<i64>>>,
//     pub api_squadron_plane: Option<Vec<ApiSquadronPlane>>,
//     pub api_stage1: ApiStage1,
//     pub api_stage2: Option<ApiStage2>,
//     pub api_stage3: Option<ApiStage3>,
// }

// #[derive(NumberSizeChecker, TraitForTest)]
// #[struct_test_case(field_extra, type_value, integration)]
// #[add_field(extra)]
// #[derive(Debug, Clone, Deserialize)]
// pub struct ApiSquadronPlane {
//     api_mst_id: i64,
//     api_count: i64,
// }

// #[derive(NumberSizeChecker, TraitForTest)]
// #[struct_test_case(field_extra, type_value, integration)]
// #[add_field(extra)]
// #[derive(Debug, Clone, Deserialize)]
// pub struct ApiKouku {
//     pub api_plane_from: Vec<Option<Vec<i64>>>,
//     pub api_stage1: ApiStage1,
//     pub api_stage2: ApiStage2,
//     pub api_stage3: Option<ApiStage3>,
// }

impl TraitForConvert for Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        // let ships: Ships = self.api_data.clone().into();
        let battle: Battle = self.api_data.clone().into();
        Some(vec![
            // EmitData::Add(Add::Ships(ships)),
            EmitData::Add(Add::Battle(battle)),
        ])
    }
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

        let pattern_str = "S@api_req_sortie@ld_airbattle";
        let log_path = "./src/kcapi_main/api_req_sortie/ld_airbattle@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_sortie@ld_airbattle";
        let log_path = "./src/kcapi_main/api_req_sortie/ld_airbattle@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
