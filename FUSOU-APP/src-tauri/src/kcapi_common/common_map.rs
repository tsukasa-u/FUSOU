use std::collections::HashMap;
use serde::{Deserialize, Serialize};

use register_trait::register_struct;
use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;
use register_trait::TraitForRoot;
use register_trait::TraitForConvert;

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSelectRoute {
    #[serde(rename = "api_select_cells")]
    pub api_select_cells: Vec<i64>,
}


#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCellFlavor {
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_message")]
    pub api_message: String,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEventmap {
    #[serde(rename = "api_max_maphp")]
    pub api_max_maphp: i64,
    #[serde(rename = "api_now_maphp")]
    pub api_now_maphp: i64,
    #[serde(rename = "api_dmg")]
    pub api_dmg: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiAirsearch {
    #[serde(rename = "api_plane_type")]
    pub api_plane_type: i64,
    #[serde(rename = "api_result")]
    pub api_result: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEDeckInfo {
    #[serde(rename = "api_kind")]
    pub api_kind: i64,
    #[serde(rename = "api_ship_ids")]
    pub api_ship_ids: Vec<i64>,
}
