#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_map@start.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_map/start)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;

use register_trait::{add_field, register_struct};

use register_trait::{Getter, TraitForConvert, TraitForRoot, TraitForTest};

use crate::interface::cells::Cells;
use crate::interface::interface::{EmitData, Identifier, Set};

use crate::kcapi_common::common_map::ApiAirsearch;
use crate::kcapi_common::common_map::ApiCellFlavor;
use crate::kcapi_common::common_map::ApiEDeckInfo;
use crate::kcapi_common::common_map::ApiEventmap;
use crate::kcapi_common::common_map::ApiHappening;
use crate::kcapi_common::common_map::ApiSelectRoute;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Req {
    #[serde(rename = "api_token")]
    pub api_token: String,
    #[serde(rename = "api_verno")]
    pub api_verno: String,
    #[serde(rename = "api_mapinfo_no")]
    pub api_mapinfo_no: String,
    #[serde(rename = "api_deck_id")]
    pub api_deck_id: String,
    #[serde(rename = "api_serial_cid")]
    pub api_serial_cid: String,
    #[serde(rename = "api_maparea_id")]
    pub api_maparea_id: String,
}

#[derive(Getter, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_map/start")]
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

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_cell_data")]
    pub api_cell_data: Vec<ApiCellData>,
    #[serde(rename = "api_rashin_flg")]
    pub api_rashin_flg: i64,
    #[serde(rename = "api_rashin_id")]
    pub api_rashin_id: i64,
    #[serde(rename = "api_maparea_id")]
    pub api_maparea_id: i64,
    #[serde(rename = "api_mapinfo_no")]
    pub api_mapinfo_no: i64,
    #[serde(rename = "api_no")]
    pub api_no: i64,
    #[serde(rename = "api_color_no")]
    pub api_color_no: i64,
    #[serde(rename = "api_event_id")]
    pub api_event_id: i64,
    #[serde(rename = "api_event_kind")]
    pub api_event_kind: i64,
    #[serde(rename = "api_next")]
    pub api_next: i64,
    #[serde(rename = "api_bosscell_no")]
    pub api_bosscell_no: i64,
    #[serde(rename = "api_bosscomp")]
    pub api_bosscomp: i64,
    #[serde(rename = "api_airsearch")]
    pub api_airsearch: ApiAirsearch,
    #[serde(rename = "api_e_deck_info")]
    pub api_e_deck_info: Option<Vec<ApiEDeckInfo>>,
    #[serde(rename = "api_limit_state")]
    pub api_limit_state: i64,
    #[serde(rename = "api_from_no")]
    pub api_from_no: i64,
    #[serde(rename = "api_eventmap")]
    pub api_eventmap: Option<ApiEventmap>,
    #[serde(rename = "api_cell_flavor")]
    pub api_cell_flavor: Option<ApiCellFlavor>,
    #[serde(rename = "api_select_route")]
    pub api_select_route: Option<ApiSelectRoute>,
    #[serde(rename = "api_itemget")]
    pub api_itemget: Option<Vec<ApiItemget>>,
    #[serde(rename = "api_happening")]
    pub api_happening: Option<ApiHappening>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiItemget {
    #[serde(rename = "api_usemst")]
    pub api_usemst: i64,
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_getcount")]
    pub api_getcount: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_icon_id")]
    pub api_icon_id: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCellData {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_no")]
    pub api_no: i64,
    #[serde(rename = "api_color_no")]
    pub api_color_no: i64,
    #[serde(rename = "api_passed")]
    pub api_passed: i64,
    #[serde(rename = "api_distance")]
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
