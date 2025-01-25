use std::collections::HashMap;
use serde::{Deserialize, Serialize};
// use serde_json::Value;

use super::custom_type::DuoType;

use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;

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
