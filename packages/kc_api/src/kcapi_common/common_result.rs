use serde::Deserialize;

use crate::kcapi_common::custom_type::DuoType;

use register_trait::add_field;

use register_trait::NumberSizeChecker;
use register_trait::TraitForTest;

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiGetShip {
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: i64,
    #[serde(rename = "api_ship_type")]
    pub api_ship_type: String,
    #[serde(rename = "api_ship_name")]
    pub api_ship_name: String,
    #[serde(rename = "api_ship_getmes")]
    pub api_ship_getmes: String,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEnemyInfo {
    #[serde(rename = "api_level")]
    pub api_level: String,
    #[serde(rename = "api_rank")]
    pub api_rank: String,
    #[serde(rename = "api_deck_name")]
    pub api_deck_name: String,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiGetEventitem {
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_value")]
    pub api_value: i64,
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_slot_level")]
    pub api_slot_level: Option<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiLandingHp {
    #[serde(rename = "api_now_hp")]
    pub api_now_hp: String,
    #[serde(rename = "api_max_hp")]
    pub api_max_hp: String,
    #[serde(rename = "api_sub_value")]
    pub api_sub_value: DuoType<i64, String>,
}
