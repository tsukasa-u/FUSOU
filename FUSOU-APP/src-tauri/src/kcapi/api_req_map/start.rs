use std::collections::HashMap;
use serde::{Deserialize, Serialize};

use register_trait::register_struct;
use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;
use register_trait::TraitForRoot;
use register_trait::TraitForConvert;

use crate::interface::battle::Battles;
use crate::interface::cells::Cells;
use crate::interface::interface::{Set, EmitData};

use crate::kcapi_common::common_map::ApiSelectRoute;
use crate::kcapi_common::common_map::ApiCellFlavor;
use crate::kcapi_common::common_map::ApiEventmap;
use crate::kcapi_common::common_map::ApiAirsearch;
use crate::kcapi_common::common_map::ApiEDeckInfo;

#[derive(Getter, TraitForTest, TraitForRoot)]
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
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
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
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
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

impl TraitForConvert for Root {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let cells: Cells = self.api_data.clone().into();
        let battles: Battles = self.api_data.clone().into();
        Some(vec![
            EmitData::Set(Set::Cells(cells)),
            // EmitData::Set(Set::Battles(battles))
            ])
    }
}

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;
    use dotenvy::dotenv;
    use std::env;

    #[test]
    fn test_deserialize() {
        
        let mut target_path = "./../../FUSOU-PROXY-DATA/kcsapi".to_string();
    
        dotenv().expect(".env file not found");
        for (key, value) in env::vars() {
            if key.eq("TEST_DATA_PATH") {
                target_path = value.clone();
            }
        }

        let pattern_str = "S@api_req_map@start";
        let log_path = "./src/kcapi/api_req_map/start.log";
        simple_root_test::<Root>(target_path, pattern_str.to_string(), log_path.to_string());
    }
}