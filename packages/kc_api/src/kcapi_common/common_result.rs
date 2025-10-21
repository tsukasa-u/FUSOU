use serde::Deserialize;

use crate::kcapi_common::custom_type::DuoType;

use register_trait::add_field;

use register_trait::NumberSizeChecker;
use register_trait::TraitForTest;

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiGetShip {
    pub api_ship_id: i64,
    pub api_ship_type: String,
    pub api_ship_name: String,
    pub api_ship_getmes: String,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiEnemyInfo {
    pub api_level: String,
    pub api_rank: String,
    pub api_deck_name: String,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiGetEventitem {
    pub api_type: i64,
    pub api_value: i64,
    pub api_id: i64,
    pub api_slot_level: Option<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiLandingHp {
    pub api_now_hp: String,
    pub api_max_hp: String,
    pub api_sub_value: DuoType<i64, String>,
}
