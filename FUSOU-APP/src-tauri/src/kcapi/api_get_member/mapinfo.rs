use std::collections::HashMap;
use serde::{Deserialize, Serialize};
// use serde_json::Value;

use register_trait::register_struct;
use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;
use register_trait::TraitForRoot;
use register_trait::TraitForConvert;

use crate::interface::interface::{EmitData, Set};
use crate::interface::air_base::AirBases;

#[derive(Getter, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_get_member/mapinfo")]
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
    #[serde(rename = "api_map_info")]
    pub api_map_info: Vec<ApiMapInfo>,
    #[serde(rename = "api_air_base")]
    pub api_air_base: Vec<ApiAirBase>,
    #[serde(rename = "api_air_base_expanded_info")]
    pub api_air_base_expanded_info: Vec<ApiAirBaseExpandedInfo>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMapInfo {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_cleared")]
    pub api_cleared: i64,
    #[serde(rename = "api_gauge_type")]
    pub api_gauge_type: Option<i64>,
    #[serde(rename = "api_gauge_num")]
    pub api_gauge_num: Option<i64>,
    #[serde(rename = "api_defeat_count")]
    pub api_defeat_count: Option<i64>,
    #[serde(rename = "api_required_defeat_count")]
    pub api_required_defeat_count: Option<i64>,
    #[serde(rename = "api_air_base_decks")]
    pub api_air_base_decks: Option<i64>,
    #[serde(rename = "api_s_no")]
    pub api_s_no: Option<i64>,
    #[serde(rename = "api_eventmap")]
    pub api_eventmap: Option<ApiEventmap>,
    #[serde(rename = "api_sally_flag")]
    pub api_sally_flag: Option<Vec<i64>>,
    #[serde(rename = "api_m10")]
    pub api_m10: Option<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEventmap {
    #[serde(rename = "api_now_maphp")]
    pub api_now_maphp: Option<i64>,
    #[serde(rename = "api_max_maphp")]
    pub api_max_maphp: Option<i64>,
    #[serde(rename = "api_state")]
    pub api_state: i64,
    #[serde(rename = "api_selected_rank")]
    pub api_selected_rank: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiAirBase {
    #[serde(rename = "api_area_id")]
    pub api_area_id: i64,
    #[serde(rename = "api_rid")]
    pub api_rid: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_distance")]
    pub api_distance: ApiDistance,
    #[serde(rename = "api_action_kind")]
    pub api_action_kind: i64,
    #[serde(rename = "api_plane_info")]
    pub api_plane_info: Vec<ApiPlaneInfo>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiDistance {
    #[serde(rename = "api_base")]
    pub api_base: i64,
    #[serde(rename = "api_bonus")]
    pub api_bonus: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiPlaneInfo {
    #[serde(rename = "api_squadron_id")]
    pub api_squadron_id: i64,
    #[serde(rename = "api_state")]
    pub api_state: i64,
    #[serde(rename = "api_slotid")]
    pub api_slotid: i64,
    #[serde(rename = "api_count")]
    pub api_count: Option<i64>,
    #[serde(rename = "api_max_count")]
    pub api_max_count: Option<i64>,
    #[serde(rename = "api_cond")]
    pub api_cond: Option<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiAirBaseExpandedInfo {
    #[serde(rename = "api_area_id")]
    pub api_area_id: i64,
    #[serde(rename = "api_maintenance_level")]
    pub api_maintenance_level: i64,
}


impl TraitForConvert for Root {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        
        let air_bases: AirBases = self.api_data.api_air_base.clone().into();

        Some(vec![
            EmitData::Set(Set::AirBases(air_bases))
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

        let pattern_str = "S@api_get_member@mapinfo";
        let log_path = "./src/kcapi/api_get_member/mapinfo.log";
        simple_root_test::<Root>(target_path.to_string(), pattern_str.to_string(), log_path.to_string());
    }
}