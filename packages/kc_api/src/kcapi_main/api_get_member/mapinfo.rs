#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_get_member@mapinfo.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_get_member/mapinfo)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::NumberSizeChecker;
use register_trait::TraitForConvert;
use register_trait::TraitForRoot;
use register_trait::TraitForTest;

use crate::interface::air_base::AirBases;
use crate::interface::interface::{EmitData, Set};

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct Req {
    pub api_token: String,
    pub api_verno: String,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_get_member/mapinfo")]
#[derive(Debug, Clone, Deserialize)]
pub struct Res {
    pub api_result: i64,
    pub api_result_msg: String,
    pub api_data: ApiData,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiData {
    pub api_map_info: Vec<ApiMapInfo>,
    pub api_air_base: Vec<ApiAirBase>,
    pub api_air_base_expanded_info: Vec<ApiAirBaseExpandedInfo>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMapInfo {
    pub api_id: i64,
    pub api_cleared: i64,
    pub api_gauge_type: Option<i64>,
    pub api_gauge_num: Option<i64>,
    pub api_defeat_count: Option<i64>,
    pub api_required_defeat_count: Option<i64>,
    pub api_air_base_decks: Option<i64>,
    pub api_s_no: Option<i64>,
    pub api_eventmap: Option<ApiEventmap>,
    pub api_sally_flag: Option<Vec<i64>>,
    pub api_m10: Option<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiEventmap {
    pub api_now_maphp: Option<i64>,
    pub api_max_maphp: Option<i64>,
    pub api_state: i64,
    pub api_selected_rank: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiAirBase {
    pub api_area_id: i64,
    pub api_rid: i64,
    pub api_name: String,
    pub api_distance: ApiDistance,
    pub api_action_kind: i64,
    pub api_plane_info: Vec<ApiPlaneInfo>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiDistance {
    pub api_base: i64,
    pub api_bonus: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiPlaneInfo {
    pub api_squadron_id: i64,
    pub api_state: i64,
    pub api_slotid: i64,
    pub api_count: Option<i64>,
    pub api_max_count: Option<i64>,
    pub api_cond: Option<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiAirBaseExpandedInfo {
    pub api_area_id: i64,
    pub api_maintenance_level: i64,
}

impl TraitForConvert for Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let air_bases: AirBases = self.api_data.api_air_base.clone().into();

        Some(vec![EmitData::Set(Set::AirBases(air_bases))])
    }
}

#[cfg(test)]
mod tests {
    use dotenvy::dotenv;
    use register_trait::simple_root_test;

    use super::*;
    #[test]
    fn test_deserialize() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = "S@api_get_member@mapinfo";
        let log_path = "./src/kcapi_main/api_get_member/mapinfo@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_get_member@mapinfo";
        let log_path = "./src/kcapi_main/api_get_member/mapinfo@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
