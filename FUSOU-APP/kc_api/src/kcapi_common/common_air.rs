use serde::Deserialize;
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
pub struct ApiStage1 {
    #[serde(rename = "api_f_count")]
    pub api_f_count: i64,
    #[serde(rename = "api_f_lostcount")]
    pub api_f_lostcount: i64,
    #[serde(rename = "api_e_count")]
    pub api_e_count: i64,
    #[serde(rename = "api_e_lostcount")]
    pub api_e_lostcount: i64,
    #[serde(rename = "api_disp_seiku")]
    pub api_disp_seiku: Option<i64>,
    #[serde(rename = "api_touch_plane")]
    pub api_touch_plane: Option<Vec<i64>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiStage2 {
    #[serde(rename = "api_f_count")]
    pub api_f_count: i64,
    #[serde(rename = "api_f_lostcount")]
    pub api_f_lostcount: i64,
    #[serde(rename = "api_e_count")]
    pub api_e_count: Option<i64>,
    #[serde(rename = "api_e_lostcount")]
    pub api_e_lostcount: Option<i64>,
    #[serde(rename = "api_air_fire")]
    pub api_air_fire: Option<ApiAirFire>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiAirFire {
    #[serde(rename = "api_idx")]
    pub api_idx: i64,
    #[serde(rename = "api_kind")]
    pub api_kind: i64,
    #[serde(rename = "api_use_items")]
    pub api_use_items: Vec<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiStage3 {
    #[serde(rename = "api_frai_flag")]
    pub api_frai_flag: Option<Vec<Option<i64>>>,
    #[serde(rename = "api_erai_flag")]
    pub api_erai_flag: Option<Vec<Option<i64>>>,
    #[serde(rename = "api_fbak_flag")]
    pub api_fbak_flag: Option<Vec<Option<i64>>>,
    #[serde(rename = "api_ebak_flag")]
    pub api_ebak_flag: Option<Vec<Option<i64>>>,
    #[serde(rename = "api_fcl_flag")]
    pub api_fcl_flag: Option<Vec<i64>>,
    #[serde(rename = "api_ecl_flag")]
    pub api_ecl_flag: Option<Vec<i64>>,
    #[serde(rename = "api_fdam")]
    pub api_fdam: Option<Vec<f32>>,
    #[serde(rename = "api_edam")]
    pub api_edam: Option<Vec<f32>>,
    #[serde(rename = "api_f_sp_list")]
    pub api_f_sp_list: Option<Vec<Option<Vec<i64>>>>,
    #[serde(rename = "api_e_sp_list")]
    pub api_e_sp_list: Option<Vec<Option<Vec<i64>>>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKouku {
    #[serde(rename = "api_plane_from")]
    pub api_plane_from: Option<Vec<Option<Vec<i64>>>>,
    #[serde(rename = "api_stage1")]
    pub api_stage1: Option<ApiStage1>,
    #[serde(rename = "api_stage2")]
    pub api_stage2: Option<ApiStage2>,
    #[serde(rename = "api_stage3")]
    pub api_stage3: Option<ApiStage3>,
    #[serde(rename = "api_stage3_combined")]
    pub api_stage3_combined: Option<ApiStage3>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiAirBaseAttack {
    #[serde(rename = "api_stage1")]
    pub api_stage1: Option<ApiStage1>,
    #[serde(rename = "api_stage2")]
    pub api_stage2: Option<ApiStage2>,
    #[serde(rename = "api_stage3")]
    pub api_stage3: Option<ApiStage3>,
    #[serde(rename = "api_base_id")]
    pub api_base_id: i64,
    #[serde(rename = "api_stage_flag")]
    pub api_stage_flag: Vec<i64>,
    #[serde(rename = "api_plane_from")]
    pub api_plane_from: Option<Vec<Option<Vec<i64>>>>,
    #[serde(rename = "api_squadron_plane")]
    pub api_squadron_plane: Option<Vec<ApiSquadronPlane>>,
    #[serde(rename = "api_stage3_combined")]
    pub api_stage3_combined: Option<ApiStage3>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSquadronPlane {
    #[serde(rename = "api_mst_id")]
    pub api_mst_id: Option<i64>,
    #[serde(rename = "api_count")]
    pub api_count: Option<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiAirBaseInjection {
    #[serde(rename = "api_plane_from")]
    pub api_plane_from: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_air_base_data")]
    pub api_air_base_data: Vec<ApiAirBaseData>,
    #[serde(rename = "api_stage1")]
    pub api_stage1: ApiStage1,
    #[serde(rename = "api_stage2")]
    pub api_stage2: ApiStage2,
    #[serde(rename = "api_stage3")]
    pub api_stage3: ApiStage3,
    #[serde(rename = "api_stage3_combined")]
    pub api_stage3_combined: Option<ApiStage3>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiAirBaseData {
    #[serde(rename = "api_mst_id")]
    pub api_mst_id: i64,
    #[serde(rename = "api_count")]
    pub api_count: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSupportAiratack {
    #[serde(rename = "api_deck_id")]
    pub api_deck_id: i64,
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: Vec<i64>,
    #[serde(rename = "api_undressing_flag")]
    pub api_undressing_flag: Vec<i64>,
    #[serde(rename = "api_stage_flag")]
    pub api_stage_flag: Vec<i64>,
    #[serde(rename = "api_plane_from")]
    pub api_plane_from: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_stage1")]
    pub api_stage1: ApiStage1,
    #[serde(rename = "api_stage2")]
    pub api_stage2: ApiStage2,
    #[serde(rename = "api_stage3")]
    pub api_stage3: ApiStage3,
    #[serde(rename = "api_stage3_combined")]
    pub api_stage3_combined: Option<ApiStage3>,
}
