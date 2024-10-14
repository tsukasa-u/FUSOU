use std::collections::HashMap;
use serde::{Deserialize, Serialize};
// use serde_json::Value;

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
#[register_struct(name = "api_get_member/practice")]
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
    #[serde(rename = "api_create_kind")]
    pub api_create_kind: i64,
    #[serde(rename = "api_selected_kind")]
    pub api_selected_kind: i64,
    #[serde(rename = "api_entry_limit")]
    pub api_entry_limit: Option<i64>,
    #[serde(rename = "api_list")]
    pub api_list: Vec<ApiList>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiList {
    #[serde(rename = "api_enemy_id")]
    pub api_enemy_id: i64,
    #[serde(rename = "api_enemy_name")]
    pub api_enemy_name: String,
    #[serde(rename = "api_enemy_name_id")]
    pub api_enemy_name_id: String,
    #[serde(rename = "api_enemy_level")]
    pub api_enemy_level: i64,
    #[serde(rename = "api_enemy_rank")]
    pub api_enemy_rank: String,
    #[serde(rename = "api_enemy_flag")]
    pub api_enemy_flag: i64,
    #[serde(rename = "api_enemy_flag_ship")]
    pub api_enemy_flag_ship: i64,
    #[serde(rename = "api_enemy_comment")]
    pub api_enemy_comment: String,
    #[serde(rename = "api_enemy_comment_id")]
    pub api_enemy_comment_id: String,
    #[serde(rename = "api_state")]
    pub api_state: i64,
    #[serde(rename = "api_medals")]
    pub api_medals: i64,
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

        let pattern_str = "S@api_get_member@practice.json";
        let log_path = "./src/kcapi/api_get_member/practice.log";
        simple_root_test::<Root>(target_path.to_string(), pattern_str.to_string(), log_path.to_string());
    }
}