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
#[register_struct(name = "api_req_member/get_practice_enemyinfo")]
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
    #[serde(rename = "api_member_id")]
    pub api_member_id: i64,
    #[serde(rename = "api_nickname")]
    pub api_nickname: String,
    #[serde(rename = "api_nickname_id")]
    pub api_nickname_id: String,
    #[serde(rename = "api_cmt")]
    pub api_cmt: String,
    #[serde(rename = "api_cmt_id")]
    pub api_cmt_id: String,
    #[serde(rename = "api_level")]
    pub api_level: i64,
    #[serde(rename = "api_rank")]
    pub api_rank: i64,
    #[serde(rename = "api_experience")]
    pub api_experience: Vec<i64>,
    #[serde(rename = "api_friend")]
    pub api_friend: i64,
    #[serde(rename = "api_ship")]
    pub api_ship: Vec<i64>,
    #[serde(rename = "api_slotitem")]
    pub api_slotitem: Vec<i64>,
    #[serde(rename = "api_furniture")]
    pub api_furniture: i64,
    #[serde(rename = "api_deckname")]
    pub api_deckname: String,
    #[serde(rename = "api_deckname_id")]
    pub api_deckname_id: String,
    #[serde(rename = "api_deck")]
    pub api_deck: ApiDeck,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiDeck {
    #[serde(rename = "api_ships")]
    pub api_ships: Vec<ApiShip>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiShip {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: Option<i64>,
    #[serde(rename = "api_level")]
    pub api_level: Option<i64>,
    #[serde(rename = "api_star")]
    pub api_star: Option<i64>,
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

        let pattern_str = "S@api_req_member@get_practice_enemyinfo";
        let log_path = "./src/kcapi/api_req_member/get_practice_enemyinfo.log";
        simple_root_test::<Root>(target_path, pattern_str.to_string(), log_path.to_string());
    }
}