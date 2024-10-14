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
#[register_struct(name = "api_get_member/questlist")]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    #[serde(rename = "api_result")]
    pub api_result: Option<i64>,
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
    #[serde(rename = "api_count")]
    pub api_count: i64,
    #[serde(rename = "api_completed_kind")]
    pub api_completed_kind: i64,
    #[serde(rename = "api_list")]
    pub api_list: Option<Vec<ApiList>>,
    #[serde(rename = "api_exec_count")]
    pub api_exec_count: i64,
    #[serde(rename = "api_exec_type")]
    pub api_exec_type: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiList {
    #[serde(rename = "api_no")]
    pub api_no: i64,
    #[serde(rename = "api_category")]
    pub api_category: i64,
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_label_type")]
    pub api_label_type: i64,
    #[serde(rename = "api_state")]
    pub api_state: i64,
    #[serde(rename = "api_title")]
    pub api_title: String,
    #[serde(rename = "api_detail")]
    pub api_detail: String,
    #[serde(rename = "api_voice_id")]
    pub api_voice_id: i64,
    #[serde(rename = "api_get_material")]
    pub api_get_material: Vec<i64>,
    #[serde(rename = "api_bonus_flag")]
    pub api_bonus_flag: i64,
    #[serde(rename = "api_progress_flag")]
    pub api_progress_flag: i64,
    #[serde(rename = "api_invalid_flag")]
    pub api_invalid_flag: i64,
    #[serde(rename = "api_lost_badges")]
    pub api_lost_badges: Option<i64>,
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

        let pattern_str = "S@api_get_member@questlist";
        let log_path = "./src/kcapi/api_get_member/questlist.log";
        simple_root_test::<Root>(target_path.to_string(), pattern_str.to_string(), log_path.to_string());
    }
}