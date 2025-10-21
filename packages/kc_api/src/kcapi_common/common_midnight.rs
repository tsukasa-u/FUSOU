use serde::Deserialize;

use crate::kcapi_common::custom_type::DuoType;

use register_trait::add_field;

use register_trait::NumberSizeChecker;
use register_trait::TraitForTest;

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiHougeki {
    pub api_at_eflag: Option<Vec<i64>>,
    pub api_at_list: Option<Vec<i64>>,
    pub api_n_mother_list: Option<Vec<i64>>,
    pub api_df_list: Option<Vec<Vec<i64>>>,
    pub api_si_list: Option<Vec<Vec<DuoType<i64, String>>>>,
    pub api_cl_list: Option<Vec<Vec<i64>>>,
    pub api_sp_list: Option<Vec<i64>>,
    pub api_damage: Option<Vec<Vec<f32>>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiFriendlyInfo {
    pub api_production_type: i64,
    pub api_ship_lv: Vec<i64>,
    pub api_ship_id: Vec<i64>,
    pub api_maxhps: Vec<i64>,
    pub api_slot_ex: Vec<i64>,
    pub api_voice_p_no: Vec<i64>,
    pub api_param: Vec<Vec<i64>>,
    pub api_slot: Vec<Vec<i64>>,
    pub api_voice_id: Vec<i64>,
    pub api_nowhps: Vec<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiFriendlyBattle {
    pub api_flare_pos: Vec<i64>,
    pub api_hougeki: ApiHougeki,
}
