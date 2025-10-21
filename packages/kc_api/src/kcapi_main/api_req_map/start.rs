#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_map@start.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_map/start)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;

use register_trait::{add_field, register_struct};

use register_trait::{NumberSizeChecker, TraitForConvert, TraitForRoot, TraitForTest};

use crate::interface::cells::Cells;
use crate::interface::interface::{EmitData, Identifier, Set};

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
    pub api_mapinfo_no: String,
    pub api_deck_id: String,
    pub api_serial_cid: String,
    pub api_maparea_id: String,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_map/start")]
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
    pub api_cell_data: Vec<ApiCellData>,
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
    pub api_airsearch: ApiAirsearch,
    pub api_e_deck_info: Option<Vec<ApiEDeckInfo>>,
    pub api_limit_state: i64,
    pub api_from_no: i64,
    pub api_eventmap: Option<ApiEventmap>,
    pub api_cell_flavor: Option<ApiCellFlavor>,
    pub api_select_route: Option<ApiSelectRoute>,
    pub api_itemget: Option<Vec<ApiItemget>>,
    pub api_happening: Option<ApiHappening>,
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

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiCellData {
    pub api_id: i64,
    pub api_no: i64,
    pub api_color_no: i64,
    pub api_passed: i64,
    pub api_distance: Option<i64>,
}

impl TraitForConvert for Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let cells: Cells = self.api_data.clone().into();
        Some(vec![
            EmitData::Set(Set::Cells(cells)),
            EmitData::Identifier(Identifier::MapStart(())),
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

        let pattern_str = "S@api_req_map@start";
        let log_path = "./src/kcapi_main/api_req_map/start@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_map@start";
        let log_path = "./src/kcapi_main/api_req_map/start@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
