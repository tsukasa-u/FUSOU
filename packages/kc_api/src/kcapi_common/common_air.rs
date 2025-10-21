use serde::Deserialize;

use register_trait::add_field;

use register_trait::NumberSizeChecker;
use register_trait::TraitForTest;

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiStage1 {
    pub api_f_count: i64,
    pub api_f_lostcount: i64,
    pub api_e_count: i64,
    pub api_e_lostcount: i64,
    pub api_disp_seiku: Option<i64>,
    pub api_touch_plane: Option<Vec<i64>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiStage2 {
    pub api_f_count: i64,
    pub api_f_lostcount: i64,
    pub api_e_count: Option<i64>,
    pub api_e_lostcount: Option<i64>,
    pub api_air_fire: Option<ApiAirFire>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiAirFire {
    pub api_idx: i64,
    pub api_kind: i64,
    pub api_use_items: Vec<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiStage3 {
    pub api_frai_flag: Option<Vec<Option<i64>>>,
    pub api_erai_flag: Option<Vec<Option<i64>>>,
    pub api_fbak_flag: Option<Vec<Option<i64>>>,
    pub api_ebak_flag: Option<Vec<Option<i64>>>,
    pub api_fcl_flag: Option<Vec<i64>>,
    pub api_ecl_flag: Option<Vec<i64>>,
    pub api_fdam: Option<Vec<f32>>,
    pub api_edam: Option<Vec<f32>>,
    pub api_f_sp_list: Option<Vec<Option<Vec<i64>>>>,
    pub api_e_sp_list: Option<Vec<Option<Vec<i64>>>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiKouku {
    pub api_plane_from: Option<Vec<Option<Vec<i64>>>>,
    pub api_stage1: Option<ApiStage1>,
    pub api_stage2: Option<ApiStage2>,
    pub api_stage3: Option<ApiStage3>,
    pub api_stage3_combined: Option<ApiStage3>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiAirBaseAttack {
    pub api_stage1: Option<ApiStage1>,
    pub api_stage2: Option<ApiStage2>,
    pub api_stage3: Option<ApiStage3>,
    pub api_base_id: i64,
    pub api_stage_flag: Vec<i64>,
    pub api_plane_from: Option<Vec<Option<Vec<i64>>>>,
    pub api_squadron_plane: Option<Vec<ApiSquadronPlane>>,
    pub api_stage3_combined: Option<ApiStage3>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiSquadronPlane {
    pub api_mst_id: Option<i64>,
    pub api_count: Option<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiAirBaseInjection {
    pub api_plane_from: Vec<Option<Vec<i64>>>,
    pub api_air_base_data: Vec<ApiAirBaseData>,
    pub api_stage1: ApiStage1,
    pub api_stage2: ApiStage2,
    pub api_stage3: ApiStage3,
    pub api_stage3_combined: Option<ApiStage3>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiAirBaseData {
    pub api_mst_id: i64,
    pub api_count: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiSupportAiratack {
    pub api_deck_id: i64,
    pub api_ship_id: Vec<i64>,
    pub api_undressing_flag: Vec<i64>,
    pub api_stage_flag: Vec<i64>,
    pub api_plane_from: Vec<Option<Vec<i64>>>,
    pub api_stage1: ApiStage1,
    pub api_stage2: ApiStage2,
    pub api_stage3: ApiStage3,
    pub api_stage3_combined: Option<ApiStage3>,
}
