use serde::Deserialize;
#[cfg(test)]
use std::collections::HashMap;
// use serde_json::Value;

use register_trait::add_field;

use register_trait::Getter;
use register_trait::TraitForTest;

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSelectRoute {
    #[serde(rename = "api_select_cells")]
    pub api_select_cells: Vec<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
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
#[derive(Debug, Clone, Deserialize)]
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
#[derive(Debug, Clone, Deserialize)]
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
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEDeckInfo {
    #[serde(rename = "api_kind")]
    pub api_kind: i64,
    #[serde(rename = "api_ship_ids")]
    pub api_ship_ids: Vec<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiHappening {
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_count")]
    pub api_count: i64,
    #[serde(rename = "api_usemst")]
    pub api_usemst: i64,
    #[serde(rename = "api_mst_id")]
    pub api_mst_id: i64,
    #[serde(rename = "api_icon_id")]
    pub api_icon_id: i64,
    #[serde(rename = "api_dentan")]
    pub api_dentan: i64,
}
