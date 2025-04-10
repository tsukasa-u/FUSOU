use serde::{Deserialize, Serialize};
use std::collections::HashMap;
// use serde_json::Value;

use super::common_air::ApiSupportAiratack;
use super::custom_type::DuoType;

use register_trait::add_field;

use register_trait::Getter;
use register_trait::TraitForTest;

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRaigeki {
    #[serde(rename = "api_frai")]
    pub api_frai: Vec<i64>,
    #[serde(rename = "api_fcl")]
    pub api_fcl: Vec<i64>,
    #[serde(rename = "api_fdam")]
    pub api_fdam: Vec<f32>,
    #[serde(rename = "api_fydam")]
    pub api_fydam: Vec<i64>,
    #[serde(rename = "api_erai")]
    pub api_erai: Vec<i64>,
    #[serde(rename = "api_ecl")]
    pub api_ecl: Vec<i64>,
    #[serde(rename = "api_edam")]
    pub api_edam: Vec<f32>,
    #[serde(rename = "api_eydam")]
    pub api_eydam: Vec<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiHougeki {
    #[serde(rename = "api_at_eflag")]
    pub api_at_eflag: Vec<i64>,
    #[serde(rename = "api_at_list")]
    pub api_at_list: Vec<i64>,
    #[serde(rename = "api_at_type")]
    pub api_at_type: Vec<i64>,
    #[serde(rename = "api_df_list")]
    pub api_df_list: Vec<Vec<i64>>,
    #[serde(rename = "api_si_list")]
    pub api_si_list: Vec<Vec<Option<DuoType<i64, String>>>>,
    #[serde(rename = "api_cl_list")]
    pub api_cl_list: Vec<Vec<i64>>,
    #[serde(rename = "api_damage")]
    pub api_damage: Vec<Vec<f32>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiOpeningTaisen {
    #[serde(rename = "api_at_eflag")]
    pub api_at_eflag: Vec<i64>,
    #[serde(rename = "api_at_list")]
    pub api_at_list: Vec<i64>,
    #[serde(rename = "api_at_type")]
    pub api_at_type: Vec<i64>,
    #[serde(rename = "api_df_list")]
    pub api_df_list: Vec<Vec<i64>>,
    #[serde(rename = "api_si_list")]
    pub api_si_list: Vec<Vec<Option<DuoType<i64, String>>>>,
    #[serde(rename = "api_cl_list")]
    pub api_cl_list: Vec<Vec<i64>>,
    #[serde(rename = "api_damage")]
    pub api_damage: Vec<Vec<f32>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiOpeningAtack {
    #[serde(rename = "api_frai_list_items")]
    pub api_frai_list_items: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_fcl_list_items")]
    pub api_fcl_list_items: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_fdam")]
    pub api_fdam: Vec<f32>,
    #[serde(rename = "api_fydam_list_items")]
    pub api_fydam_list_items: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_erai_list_items")]
    pub api_erai_list_items: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_ecl_list_items")]
    pub api_ecl_list_items: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_edam")]
    pub api_edam: Vec<f32>,
    #[serde(rename = "api_eydam_list_items")]
    pub api_eydam_list_items: Vec<Option<Vec<i64>>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSupportInfo {
    #[serde(rename = "api_support_airatack")]
    pub api_support_airatack: Option<ApiSupportAiratack>,
    #[serde(rename = "api_support_hourai")]
    pub api_support_hourai: Option<ApiSupportHourai>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFlavoInfo {
    #[serde(rename = "api_boss_ship_id")]
    pub api_boss_ship_id: String,
    #[serde(rename = "api_type")]
    pub api_type: String,
    #[serde(rename = "api_voice_id")]
    pub api_voice_id: String,
    #[serde(rename = "api_class_name")]
    pub api_class_name: String,
    #[serde(rename = "api_ship_name")]
    pub api_ship_name: String,
    #[serde(rename = "api_message")]
    pub api_message: String,
    #[serde(rename = "api_pos_x")]
    pub api_pos_x: String,
    #[serde(rename = "api_pos_y")]
    pub api_pos_y: String,
    #[serde(rename = "api_data")]
    pub api_data: String,
    // #[serde(rename = "api_support_hourai")]
    // pub api_support_hourai: Option<ApiSupportHourai>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSupportHourai {
    #[serde(rename = "api_deck_id")]
    pub api_deck_id: i64,
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: Vec<i64>,
    #[serde(rename = "api_undressing_flag")]
    pub api_undressing_flag: Vec<i64>,
    #[serde(rename = "api_cl_list")]
    pub api_cl_list: Vec<i64>,
    #[serde(rename = "api_damage")]
    pub api_damage: Vec<f32>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFlavorInfo {
    #[serde(rename = "api_boss_ship_id")]
    pub api_boss_ship_id: String,
    #[serde(rename = "api_type")]
    pub api_type: String,
    #[serde(rename = "api_voice_id")]
    pub api_voice_id: String,
    #[serde(rename = "api_class_name")]
    pub api_class_name: String,
    #[serde(rename = "api_ship_name")]
    pub api_ship_name: String,
    #[serde(rename = "api_message")]
    pub api_message: String,
    #[serde(rename = "api_pos_x")]
    pub api_pos_x: String,
    #[serde(rename = "api_pos_y")]
    pub api_pos_y: String,
    #[serde(rename = "api_data")]
    pub api_data: String,
}
