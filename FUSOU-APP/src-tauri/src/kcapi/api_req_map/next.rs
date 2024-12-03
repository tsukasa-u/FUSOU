use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use register_trait::register_struct;
use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;
use register_trait::TraitForRoot;
use register_trait::TraitForConvert;

use crate::interface::interface::EmitData;

use crate::kcapi_common::common_air::ApiStage1;
use crate::kcapi_common::common_air::ApiStage2;
use crate::kcapi_common::common_air::ApiStage3;

use crate::kcapi_common::common_map::ApiSelectRoute;
use crate::kcapi_common::common_map::ApiCellFlavor;
use crate::kcapi_common::common_map::ApiEventmap;
use crate::kcapi_common::common_map::ApiAirsearch;
use crate::kcapi_common::common_map::ApiEDeckInfo;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_map/next")]
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
    #[serde(rename = "api_comment_kind")]
    pub api_comment_kind: Option<i64>,
    #[serde(rename = "api_production_kind")]
    pub api_production_kind: Option<i64>,
    #[serde(rename = "api_airsearch")]
    pub api_airsearch: ApiAirsearch,
    #[serde(rename = "api_e_deck_info")]
    pub api_e_deck_info: Option<Vec<ApiEDeckInfo>>,
    #[serde(rename = "api_limit_state")]
    pub api_limit_state: i64,
    #[serde(rename = "api_ration_flag")]
    pub api_ration_flag: Option<i64>,
    #[serde(rename = "api_select_route")]
    pub api_select_route: Option<ApiSelectRoute>,
    #[serde(rename = "api_cell_flavor")]
    pub api_cell_flavor: Option<ApiCellFlavor>,
    #[serde(rename = "api_itemget")]
    pub api_itemget: Option<Vec<ApiItemget>>,
    #[serde(rename = "api_eventmap")]
    pub api_eventmap: Option<ApiEventmap>,
    #[serde(rename = "api_m1")]
    pub api_m1: Option<i64>,
    #[serde(rename = "api_destruction_battle")]
    pub api_destruction_battle: Option<ApiDestructionBattle>,
    #[serde(rename = "api_happening")]
    pub api_happening: Option<ApiHappening>,
    #[serde(rename = "api_itemget_eo_comment")]
    pub api_itemget_eo_comment: Option<ApiItemgetEoComment>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")] 
pub struct ApiItemgetEoComment {
    #[serde(rename = "api_usemst")]
    api_usemst: i64,
    #[serde(rename = "api_id")]
    api_id: i64,
    #[serde(rename = "api_getcount")]
    api_getcount: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")] 
pub struct ApiHappening {
    #[serde(rename = "api_type")]
    api_type: i64,
    #[serde(rename = "api_count")]
    api_count: i64,
    #[serde(rename = "api_usemst")]
    api_usemst: i64,
    #[serde(rename = "api_mst_id")]
    api_mst_id: i64,
    #[serde(rename = "api_icon_id")]
    api_icon_id: i64,
    #[serde(rename = "api_dentan")]
    api_dentan: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")] 
pub struct ApiDestructionBattle {
    #[serde(rename = "api_formation")]
    pub api_formation: Vec<i64>,
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
    #[serde(rename = "api_f_nowhps")]
    pub api_f_nowhps: Vec<i64>,
    #[serde(rename = "api_f_maxhps")]
    pub api_f_maxhps: Vec<i64>,
    #[serde(rename = "api_air_base_attack")]
    pub api_air_base_attack: ApiAirBaseAttack,
    #[serde(rename = "api_lost_kind")]
    pub api_lost_kind: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")] 
pub struct ApiAirBaseAttack {
    #[serde(rename = "api_stage_flag")]
    pub api_stage_flag: Vec<i64>,
    #[serde(rename = "api_plane_from")]
    pub api_plane_from: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_map_squadron_plane")]
    pub api_map_squadron_plane: Option<HashMap<String, Vec<ApiMapSquadronPlane>>>,
    #[serde(rename = "api_stage1")]
    pub api_stage1: Option<ApiStage1>,
    #[serde(rename = "api_stage2")]
    pub api_stage2: Option<ApiStage2>,
    #[serde(rename = "api_stage3")]
    pub api_stage3: Option<ApiStage3>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")] 
pub struct ApiMapSquadronPlane {
    #[serde(rename = "api_mst_id")]
    pub api_mst_id: i64,
    #[serde(rename = "api_count")]
    pub api_count: i64,
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

        let pattern_str = "S@api_req_map@next";
        let log_path = "./src/kcapi/api_req_map/next.log";
        simple_root_test::<Root>(target_path, pattern_str.to_string(), log_path.to_string());
    }
}