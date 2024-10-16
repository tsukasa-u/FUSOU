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

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_sortie/battleresult")]
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
    #[serde(rename = "api_win_rank")]
    pub api_win_rank: String,
    #[serde(rename = "api_get_exp")]
    pub api_get_exp: i64,
    #[serde(rename = "api_mvp")]
    pub api_mvp: i64,
    #[serde(rename = "api_member_lv")]
    pub api_member_lv: i64,
    #[serde(rename = "api_member_exp")]
    pub api_member_exp: i64,
    #[serde(rename = "api_get_base_exp")]
    pub api_get_base_exp: i64,
    #[serde(rename = "api_get_ship_exp")]
    pub api_get_ship_exp: Vec<i64>,
    #[serde(rename = "api_get_exp_lvup")]
    pub api_get_exp_lvup: Vec<Vec<i64>>,
    #[serde(rename = "api_dests")]
    pub api_dests: i64,
    #[serde(rename = "api_destsf")]
    pub api_destsf: i64,
    #[serde(rename = "api_quest_name")]
    pub api_quest_name: String,
    #[serde(rename = "api_quest_level")]
    pub api_quest_level: i64,
    #[serde(rename = "api_enemy_info")]
    pub api_enemy_info: ApiEnemyInfo,
    #[serde(rename = "api_first_clear")]
    pub api_first_clear: i64,
    #[serde(rename = "api_mapcell_incentive")]
    pub api_mapcell_incentive: i64,
    #[serde(rename = "api_get_flag")]
    pub api_get_flag: Vec<i64>,
    #[serde(rename = "api_get_eventflag")]
    pub api_get_eventflag: Option<i64>,
    #[serde(rename = "api_get_exmap_rate")]
    pub api_get_exmap_rate: Value,
    #[serde(rename = "api_get_exmap_useitem_id")]
    pub api_get_exmap_useitem_id: Value,
    #[serde(rename = "api_escape_flag")]
    pub api_escape_flag: i64,
    #[serde(rename = "api_escape")]
    pub api_escape: Option<ApiEscapeFlag>,
    #[serde(rename = "api_get_ship")]
    pub api_get_ship: Option<ApiGetShip>,
    #[serde(rename = "api_m1")]
    pub api_m1: Option<i64>,
    #[serde(rename = "api_landing_hp")]
    pub api_landing_hp: Option<ApiLandingHp>,
    #[serde(rename = "api_m_suffix")]
    pub api_m_suffix: Option<String>,
    #[serde(rename = "api_get_eventitem")]
    pub api_get_eventitem: Option<Vec<Value>>,
    #[serde(rename = "api_next_map_ids")]
    pub api_next_map_ids: Option<Vec<Value>>,
    #[serde(rename = "api_select_reward_dict")]
    pub api_select_reward_dict: Option<HashMap<String, Vec<ApiSelectRewardDict>>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSelectRewardDict {
    #[serde(rename = "api_item_no")]
    api_item_no: i64,
    #[serde(rename = "api_type")]
    api_type: i64,
    #[serde(rename = "api_id")]
    api_id: i64,
    #[serde(rename = "api_value")]
    api_value: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiLandingHp {
    #[serde(rename = "api_max_hp")]
    api_max_hp: String,
    #[serde(rename = "api_now_hp")]
    api_now_hp: String,
    #[serde(rename = "api_sub_value")]
    api_sub_value: Value
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEscapeFlag {
    #[serde(rename = "api_escape_idx")]
    api_escape_idx: Vec<i64>,
    #[serde(rename = "api_escape_type")]
    api_escape_type: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiGetShip {
    #[serde(rename = "api_ship_id")]
    api_ship_id: i64,
    #[serde(rename = "api_ship_type")]
    api_ship_type: String,
    #[serde(rename = "api_ship_name")]
    api_ship_name: String,
    #[serde(rename = "api_ship_getmes")]
    api_ship_getmes: String,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEnemyInfo {
    #[serde(rename = "api_level")]
    pub api_level: String,
    #[serde(rename = "api_rank")]
    pub api_rank: String,
    #[serde(rename = "api_deck_name")]
    pub api_deck_name: String,
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

        let pattern_str = "S@api_req_sortie@battleresult";
        let log_path = "./src/kcapi/api_req_sortie/battleresult.log";
        simple_root_test::<Root>(target_path, pattern_str.to_string(), log_path.to_string());
    }
}