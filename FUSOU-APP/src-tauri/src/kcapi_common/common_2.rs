use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
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
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    pub api_si_list: Vec<Vec<Value>>, 
    #[serde(rename = "api_cl_list")]
    pub api_cl_list: Vec<Vec<i64>>,
    #[serde(rename = "api_damage")]
    pub api_damage: Vec<Vec<f32>>,
}
