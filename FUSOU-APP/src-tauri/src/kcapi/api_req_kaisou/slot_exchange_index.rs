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
#[register_struct(name = "api_req_kaisou/slot_exchange_index")]
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
    #[serde(rename = "api_ship_data")]
    pub api_ship_data: ApiShipData,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiShipData {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_sortno")]
    pub api_sortno: i64,
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: i64,
    #[serde(rename = "api_lv")]
    pub api_lv: i64,
    #[serde(rename = "api_exp")]
    pub api_exp: Vec<i64>,
    #[serde(rename = "api_nowhp")]
    pub api_nowhp: i64,
    #[serde(rename = "api_maxhp")]
    pub api_maxhp: i64,
    #[serde(rename = "api_soku")]
    pub api_soku: i64,
    #[serde(rename = "api_leng")]
    pub api_leng: i64,
    #[serde(rename = "api_slot")]
    pub api_slot: Vec<i64>,
    #[serde(rename = "api_onslot")]
    pub api_onslot: Vec<i64>,
    #[serde(rename = "api_slot_ex")]
    pub api_slot_ex: i64,
    #[serde(rename = "api_kyouka")]
    pub api_kyouka: Vec<i64>,
    #[serde(rename = "api_backs")]
    pub api_backs: i64,
    #[serde(rename = "api_fuel")]
    pub api_fuel: i64,
    #[serde(rename = "api_bull")]
    pub api_bull: i64,
    #[serde(rename = "api_slotnum")]
    pub api_slotnum: i64,
    #[serde(rename = "api_ndock_time")]
    pub api_ndock_time: i64,
    #[serde(rename = "api_ndock_item")]
    pub api_ndock_item: Vec<i64>,
    #[serde(rename = "api_srate")]
    pub api_srate: i64,
    #[serde(rename = "api_cond")]
    pub api_cond: i64,
    #[serde(rename = "api_karyoku")]
    pub api_karyoku: Vec<i64>,
    #[serde(rename = "api_raisou")]
    pub api_raisou: Vec<i64>,
    #[serde(rename = "api_taiku")]
    pub api_taiku: Vec<i64>,
    #[serde(rename = "api_soukou")]
    pub api_soukou: Vec<i64>,
    #[serde(rename = "api_kaihi")]
    pub api_kaihi: Vec<i64>,
    #[serde(rename = "api_taisen")]
    pub api_taisen: Vec<i64>,
    #[serde(rename = "api_sakuteki")]
    pub api_sakuteki: Vec<i64>,
    #[serde(rename = "api_lucky")]
    pub api_lucky: Vec<i64>,
    #[serde(rename = "api_locked")]
    pub api_locked: i64,
    #[serde(rename = "api_locked_equip")]
    pub api_locked_equip: i64,
    #[serde(rename = "api_sally_area")]
    pub api_sally_area: i64,
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

        let pattern_str = "S@api_req_kaisou@slot_exchange_index.json";
        let log_path = "./src/kcapi/api_req_kaisou/slot_exchange_index.log";
        simple_root_test::<Root>(target_path, pattern_str.to_string(), log_path.to_string());
    }
}