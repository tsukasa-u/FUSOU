#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_map@next.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_map/next)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;
use std::collections::HashMap;
// use serde_json::Value;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::NumberSizeChecker;
use register_trait::TraitForConvert;
use register_trait::TraitForRoot;
use register_trait::TraitForTest;

use crate::interface::cells::Cell;
use crate::interface::interface::{Add, EmitData};

use crate::kcapi_common::common_air::ApiStage1;
use crate::kcapi_common::common_air::ApiStage2;
use crate::kcapi_common::common_air::ApiStage3;

use crate::kcapi_common::common_map::ApiAirsearch;
use crate::kcapi_common::common_map::ApiCellFlavor;
use crate::kcapi_common::common_map::ApiEDeckInfo;
use crate::kcapi_common::common_map::ApiEventmap;
use crate::kcapi_common::common_map::ApiHappening;
use crate::kcapi_common::common_map::ApiSelectRoute;

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct Req {
    pub api_token: String,
    pub api_verno: String,
    pub api_recovery_type: String,
    pub api_cell_id: Option<String>,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_map/next")]
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
    pub api_rashin_flg: i64,
    pub api_rashin_id: i64,
    pub api_maparea_id: i64,
    pub api_mapinfo_no: i64,
    pub api_no: i64,
    pub api_color_no: i64,
    pub api_event_id: i64,
    pub api_event_kind: i64,
    pub api_next: i64,
    pub api_bosscell_no: i64,
    pub api_bosscomp: i64,
    pub api_comment_kind: Option<i64>,
    pub api_production_kind: Option<i64>,
    pub api_airsearch: ApiAirsearch,
    pub api_e_deck_info: Option<Vec<ApiEDeckInfo>>,
    pub api_limit_state: i64,
    pub api_ration_flag: Option<i64>,
    pub api_select_route: Option<ApiSelectRoute>,
    pub api_cell_flavor: Option<ApiCellFlavor>,
    pub api_itemget: Option<Vec<ApiItemget>>,
    pub api_eventmap: Option<ApiEventmap>,
    pub api_m1: Option<i64>,
    pub api_destruction_battle: Option<ApiDestructionBattle>,
    pub api_happening: Option<ApiHappening>,
    pub api_itemget_eo_comment: Option<ApiItemgetEoComment>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiItemgetEoComment {
    pub api_usemst: i64,
    pub api_id: i64,
    pub api_getcount: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiDestructionBattle {
    pub api_formation: Vec<i64>,
    pub api_ship_ke: Vec<i64>,
    pub api_ship_lv: Vec<i64>,
    pub api_e_nowhps: Vec<i64>,
    pub api_e_maxhps: Vec<i64>,
    #[serde(rename = "api_eSlot")]
    pub api_e_slot: Vec<Vec<i64>>,
    pub api_f_nowhps: Vec<i64>,
    pub api_f_maxhps: Vec<i64>,
    pub api_air_base_attack: ApiAirBaseAttack,
    pub api_lost_kind: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiAirBaseAttack {
    pub api_stage_flag: Vec<i64>,
    pub api_plane_from: Vec<Option<Vec<i64>>>,
    pub api_map_squadron_plane: Option<HashMap<String, Vec<ApiMapSquadronPlane>>>,
    pub api_stage1: Option<ApiStage1>,
    pub api_stage2: Option<ApiStage2>,
    pub api_stage3: Option<ApiStage3>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMapSquadronPlane {
    pub api_mst_id: i64,
    pub api_count: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiItemget {
    pub api_usemst: i64,
    pub api_id: i64,
    pub api_getcount: i64,
    pub api_name: String,
    pub api_icon_id: i64,
}

impl TraitForConvert for Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let cell: Cell = self.api_data.clone().into();
        Some(vec![EmitData::Add(Add::Cell(cell))])
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

        let pattern_str = "S@api_req_map@next";
        let log_path = "./src/kcapi_main/api_req_map/next@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_map@next";
        let log_path = "./src/kcapi_main/api_req_map/next@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
