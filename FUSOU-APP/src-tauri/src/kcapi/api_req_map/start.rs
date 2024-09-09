use std::collections::HashMap;
use serde::{Deserialize, Serialize};

use register_trait::register_struct;
use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;
use register_trait::TraitForRoot;
use register_trait::TraitForConvert;

use crate::interface::interface::EmitData;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_map/start")]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
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
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_cell_data")]
    pub api_cell_data: Vec<ApiCellDaum>,
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
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCellDaum {
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

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiAirsearch {
    #[serde(rename = "api_plane_type")]
    pub api_plane_type: i64,
    #[serde(rename = "api_result")]
    pub api_result: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEDeckInfo {
    #[serde(rename = "api_kind")]
    pub api_kind: i64,
    #[serde(rename = "api_ship_ids")]
    pub api_ship_ids: Vec<i64>,
}

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;

    #[test]
    fn test_deserialize() {
        let target_path = "./../../test_data";
        let pattern_str = "S@api_req_map@start.json";
        let log_path = "./src/kc2api/api_req_map/start.log";
        simple_root_test::<Root>(target_path.to_string(), pattern_str.to_string(), log_path.to_string());
    }
}