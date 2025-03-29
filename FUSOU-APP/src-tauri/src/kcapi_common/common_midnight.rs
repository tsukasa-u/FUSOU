use serde::{Deserialize, Serialize};
use std::collections::HashMap;
// use serde_json::Value;

use super::custom_type::DuoType;

use register_trait::add_field;

use register_trait::Getter;
use register_trait::TraitForTest;

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiHougeki {
    #[serde(rename = "api_at_eflag")]
    pub api_at_eflag: Option<Vec<i64>>,
    #[serde(rename = "api_at_list")]
    pub api_at_list: Option<Vec<i64>>,
    #[serde(rename = "api_n_mother_list")]
    pub api_n_mother_list: Option<Vec<i64>>,
    #[serde(rename = "api_df_list")]
    pub api_df_list: Option<Vec<Vec<i64>>>,
    #[serde(rename = "api_si_list")]
    pub api_si_list: Option<Vec<Vec<DuoType<i64, String>>>>,
    #[serde(rename = "api_cl_list")]
    pub api_cl_list: Option<Vec<Vec<i64>>>,
    #[serde(rename = "api_sp_list")]
    pub api_sp_list: Option<Vec<i64>>,
    #[serde(rename = "api_damage")]
    pub api_damage: Option<Vec<Vec<f32>>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFriendlyInfo {
    #[serde(rename = "api_production_type")]
    pub api_production_type: i64,
    #[serde(rename = "api_ship_lv")]
    pub api_ship_lv: Vec<i64>,
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: Vec<i64>,
    #[serde(rename = "api_maxhps")]
    pub api_maxhps: Vec<i64>,
    #[serde(rename = "api_slot_ex")]
    pub api_slot_ex: Vec<i64>,
    #[serde(rename = "api_voice_p_no")]
    pub api_voice_p_no: Vec<i64>,
    #[serde(rename = "api_Param")]
    pub api_param: Vec<Vec<i64>>,
    #[serde(rename = "api_Slot")]
    pub api_slot: Vec<Vec<i64>>,
    #[serde(rename = "api_voice_id")]
    pub api_voice_id: Vec<i64>,
    #[serde(rename = "api_nowhps")]
    pub api_nowhps: Vec<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFriendlyBattle {
    #[serde(rename = "api_flare_pos")]
    pub api_flare_pos: Vec<i64>,
    #[serde(rename = "api_hougeki")]
    pub api_hougeki: ApiHougeki,
}
