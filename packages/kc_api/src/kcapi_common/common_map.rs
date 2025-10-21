use serde::Deserialize;

use register_trait::add_field;

use register_trait::NumberSizeChecker;
use register_trait::TraitForTest;

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiSelectRoute {
    pub api_select_cells: Vec<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiCellFlavor {
    pub api_type: i64,
    pub api_message: String,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiEventmap {
    pub api_max_maphp: i64,
    pub api_now_maphp: i64,
    pub api_dmg: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiAirsearch {
    pub api_plane_type: i64,
    pub api_result: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiEDeckInfo {
    pub api_kind: i64,
    pub api_ship_ids: Vec<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiHappening {
    pub api_type: i64,
    pub api_count: i64,
    pub api_usemst: i64,
    pub api_mst_id: i64,
    pub api_icon_id: i64,
    pub api_dentan: i64,
}
