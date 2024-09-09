use std::collections::HashMap;
use serde::{Deserialize, Serialize};
// use serde_json::Value;

use register_trait::register_struct;
use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;
use register_trait::TraitForRoot;
use register_trait::TraitForConvert;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_mission/result")]
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
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: Vec<i64>,
    #[serde(rename = "api_clear_result")]
    pub api_clear_result: i64,
    #[serde(rename = "api_get_exp")]
    pub api_get_exp: i64,
    #[serde(rename = "api_member_lv")]
    pub api_member_lv: i64,
    #[serde(rename = "api_member_exp")]
    pub api_member_exp: i64,
    #[serde(rename = "api_get_ship_exp")]
    pub api_get_ship_exp: Vec<i64>,
    #[serde(rename = "api_get_exp_lvup")]
    pub api_get_exp_lvup: Vec<Vec<i64>>,
    #[serde(rename = "api_maparea_name")]
    pub api_maparea_name: String,
    #[serde(rename = "api_detail")]
    pub api_detail: String,
    #[serde(rename = "api_quest_name")]
    pub api_quest_name: String,
    #[serde(rename = "api_quest_level")]
    pub api_quest_level: i64,
    #[serde(rename = "api_get_material")]
    pub api_get_material: Vec<i64>,
    #[serde(rename = "api_useitem_flag")]
    pub api_useitem_flag: Vec<i64>,
    #[serde(rename = "api_get_item1")]
    pub api_get_item1: Option<ApiGetItem>,
    #[serde(rename = "api_get_item2")]
    pub api_get_item2: Option<ApiGetItem>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiGetItem {
    #[serde(rename = "api_useitem_id")]
    pub api_useitem_id: i64,
    #[serde(rename = "api_useitem_name")]
    pub api_useitem_name: String,
    #[serde(rename = "api_useitem_count")]
    pub api_useitem_count: i64,
}

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;

    #[test]
    fn test_deserialize() {
        let target_path = "./../../test_data";
        let pattern_str = "S@api_req_mission@result.json";
        let log_path = "./src/kc2api/api_req_mission/result.log";
        simple_root_test::<Root>(target_path.to_string(), pattern_str.to_string(), log_path.to_string());
    }
}