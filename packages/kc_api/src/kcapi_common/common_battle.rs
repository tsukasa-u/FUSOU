use serde::Deserialize;

use crate::kcapi_common::common_air::ApiSupportAiratack;
use crate::kcapi_common::custom_type::DuoType;

use register_trait::add_field;

use register_trait::NumberSizeChecker;
use register_trait::TraitForTest;

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiRaigeki {
    pub api_frai: Vec<i64>,
    pub api_fcl: Vec<i64>,
    pub api_fdam: Vec<f32>,
    pub api_fydam: Vec<i64>,
    pub api_erai: Vec<i64>,
    pub api_ecl: Vec<i64>,
    pub api_edam: Vec<f32>,
    pub api_eydam: Vec<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiHougeki {
    pub api_at_eflag: Vec<i64>,
    pub api_at_list: Vec<i64>,
    pub api_at_type: Vec<i64>,
    pub api_df_list: Vec<Vec<i64>>,
    pub api_si_list: Vec<Vec<Option<DuoType<i64, String>>>>,
    pub api_cl_list: Vec<Vec<i64>>,
    pub api_damage: Vec<Vec<f32>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiOpeningTaisen {
    pub api_at_eflag: Vec<i64>,
    pub api_at_list: Vec<i64>,
    pub api_at_type: Vec<i64>,
    pub api_df_list: Vec<Vec<i64>>,
    pub api_si_list: Vec<Vec<Option<DuoType<i64, String>>>>,
    pub api_cl_list: Vec<Vec<i64>>,
    pub api_damage: Vec<Vec<f32>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiOpeningAtack {
    pub api_frai_list_items: Vec<Option<Vec<i64>>>,
    pub api_fcl_list_items: Vec<Option<Vec<i64>>>,
    pub api_fdam: Vec<f32>,
    pub api_fydam_list_items: Vec<Option<Vec<i64>>>,
    pub api_erai_list_items: Vec<Option<Vec<i64>>>,
    pub api_ecl_list_items: Vec<Option<Vec<i64>>>,
    pub api_edam: Vec<f32>,
    pub api_eydam_list_items: Vec<Option<Vec<i64>>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiSupportInfo {
    pub api_support_airatack: Option<ApiSupportAiratack>,
    pub api_support_hourai: Option<ApiSupportHourai>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiFlavoInfo {
    pub api_boss_ship_id: String,
    pub api_type: String,
    pub api_voice_id: String,
    pub api_class_name: String,
    pub api_ship_name: String,
    pub api_message: String,
    pub api_pos_x: String,
    pub api_pos_y: String,
    pub api_data: String,
    // pub api_support_hourai: Option<ApiSupportHourai>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiSupportHourai {
    pub api_deck_id: i64,
    pub api_ship_id: Vec<i64>,
    pub api_undressing_flag: Vec<i64>,
    pub api_cl_list: Vec<i64>,
    pub api_damage: Vec<f32>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiFlavorInfo {
    pub api_boss_ship_id: String,
    pub api_type: String,
    pub api_voice_id: String,
    pub api_class_name: String,
    pub api_ship_name: String,
    pub api_message: String,
    pub api_pos_x: String,
    pub api_pos_y: String,
    pub api_data: String,
}
