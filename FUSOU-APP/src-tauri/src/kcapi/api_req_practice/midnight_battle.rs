use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use register_trait::register_struct;
use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;
use register_trait::TraitForRoot;
use register_trait::TraitForConvert;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_practice/midnight_battle")]
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
    #[serde(rename = "api_deck_id")]
    pub api_deck_id: i64,
    #[serde(rename = "api_formation")]
    pub api_formation: Vec<i64>,
    #[serde(rename = "api_f_nowhps")]
    pub api_f_nowhps: Vec<i64>,
    #[serde(rename = "api_f_maxhps")]
    pub api_f_maxhps: Vec<i64>,
    #[serde(rename = "api_fParam")]
    pub api_f_param: Vec<Vec<i64>>,
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
    #[serde(rename = "api_eParam")]
    pub api_e_param: Vec<Vec<i64>>,
    #[serde(rename = "api_e_effect_list")]
    pub api_e_effect_list: Vec<Vec<i64>>,
    #[serde(rename = "api_smoke_type")]
    pub api_smoke_type: i64,
    #[serde(rename = "api_balloon_cell")]
    pub api_balloon_cell: i64,
    #[serde(rename = "api_atoll_cell")]
    pub api_atoll_cell: i64,
    #[serde(rename = "api_touch_plane")]
    pub api_touch_plane: Vec<i64>,
    #[serde(rename = "api_flare_pos")]
    pub api_flare_pos: Vec<i64>,
    #[serde(rename = "api_hougeki")]
    pub api_hougeki: ApiHougeki,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiHougeki {
    #[serde(rename = "api_at_eflag")]
    pub api_at_eflag: Vec<i64>,
    #[serde(rename = "api_at_list")]
    pub api_at_list: Vec<i64>,
    #[serde(rename = "api_n_mother_list")]
    pub api_n_mother_list: Vec<i64>,
    #[serde(rename = "api_df_list")]
    pub api_df_list: Vec<Vec<i64>>,
    #[serde(rename = "api_si_list")]
    pub api_si_list: Vec<Vec<Value>>,
    #[serde(rename = "api_cl_list")]
    pub api_cl_list: Vec<Vec<i64>>,
    #[serde(rename = "api_sp_list")]
    pub api_sp_list: Vec<i64>,
    #[serde(rename = "api_damage")]
    pub api_damage: Vec<Vec<f64>>,
}

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;

    #[test]
    fn test_deserialize() {
        let target_path = "./../../test_data";
        let pattern_str = "S@api_req_practice@midnight_battle.json";
        let log_path = "./src/kc2api/api_req_practice/midnight_battle.log";
        simple_root_test::<Root>(target_path.to_string(), pattern_str.to_string(), log_path.to_string());
    }
}