#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/api_start2@get_data.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_start2/get_data)")]
#![doc = include_str!("../../../../../js/svg_pan_zoom.html")]

use serde::Deserialize;
use std::collections::HashMap;

use register_trait::{add_field, register_struct};

use register_trait::{FieldSizeChecker, TraitForRoot, TraitForTest};
use register_trait::QueryWithExtra;



#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]

#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_for_qs)]
#[derive(Debug, Clone, QueryWithExtra)]
pub struct Req {
    #[qs(rename = "api_token")]
    pub api_token: String,
    #[qs(rename = "api_verno")]
    pub api_verno: String,
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[register_struct(name = "api_start2/getData")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Res {
    #[serde(rename = "api_result")]
    pub api_result: i64,
    #[serde(rename = "api_result_msg")]
    pub api_result_msg: String,
    #[serde(rename = "api_data")]
    pub api_data: ApiData,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_mst_ship")]
    pub api_mst_ship: Vec<ApiMstShip>,
    #[serde(rename = "api_mst_shipgraph")]
    pub api_mst_shipgraph: Vec<ApiMstShipgraph>,
    #[serde(rename = "api_mst_slotitem_equiptype")]
    pub api_mst_slotitem_equiptype: Vec<ApiMstSlotitemEquiptype>,
    #[serde(rename = "api_mst_equip_exslot")]
    pub api_mst_equip_exslot: Vec<i64>,
    #[serde(rename = "api_mst_equip_exslot_ship")]
    pub api_mst_equip_exslot_ship: HashMap<String, ApiMstEquipExslotShip>,
    #[serde(rename = "api_mst_stype")]
    pub api_mst_stype: Vec<ApiMstStype>,
    #[serde(rename = "api_mst_slotitem")]
    pub api_mst_slotitem: Vec<ApiMstSlotitem>,
    #[serde(rename = "api_mst_furnituregraph")]
    pub api_mst_furnituregraph: Vec<ApiMstFurnituregraph>,
    #[serde(rename = "api_mst_useitem")]
    pub api_mst_useitem: Vec<ApiMstUseitem>,
    #[serde(rename = "api_mst_payitem")]
    pub api_mst_payitem: Vec<ApiMstPayitem>,
    #[serde(rename = "api_mst_item_shop")]
    pub api_mst_item_shop: ApiMstItemShop,
    #[serde(rename = "api_mst_maparea")]
    pub api_mst_maparea: Vec<ApiMstMaparea>,
    #[serde(rename = "api_mst_mapinfo")]
    pub api_mst_mapinfo: Vec<ApiMstMapinfo>,
    #[serde(rename = "api_mst_mapbgm")]
    pub api_mst_mapbgm: Vec<ApiMstMapbgm>,
    #[serde(rename = "api_mst_mission")]
    pub api_mst_mission: Vec<ApiMstMission>,
    #[serde(rename = "api_mst_const")]
    pub api_mst_const: ApiMstConst,
    #[serde(rename = "api_mst_shipupgrade")]
    pub api_mst_shipupgrade: Vec<ApiMstShipupgrade>,
    #[serde(rename = "api_mst_bgm")]
    pub api_mst_bgm: Vec<ApiMstBgm>,
    #[cfg(not(feature = "20250627"))]
    #[serde(rename = "api_mst_equip_ship")]
    pub api_mst_equip_ship: Vec<ApiMstEquipShip>,
    #[cfg(feature = "20250627")]
    #[serde(rename = "api_mst_equip_ship")]
    pub api_mst_equip_ship: HashMap<i64, ApiMstEquipShip>,
    // 20250627
    #[serde(rename = "api_mst_equip_limit_exslot")]
    pub api_mst_equip_limit_exslot: Option<HashMap<i64, Vec<i64>>>,
    #[serde(rename = "api_mst_furniture")]
    pub api_mst_furniture: Vec<ApiMstFurniture>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstStype {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_sortno")]
    pub api_sortno: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_scnt")]
    pub api_scnt: i64,
    #[serde(rename = "api_kcnt")]
    pub api_kcnt: i64,
    #[serde(rename = "api_equip_type")]
    pub api_equip_type: HashMap<String, i64>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstShip {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_sortno")]
    pub api_sortno: Option<i64>,
    #[serde(rename = "api_sort_id")]
    pub api_sort_id: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_yomi")]
    pub api_yomi: String,
    #[serde(rename = "api_stype")]
    pub api_stype: i64,
    #[serde(rename = "api_ctype")]
    pub api_ctype: i64,
    #[serde(rename = "api_afterlv")]
    pub api_afterlv: Option<i64>,
    #[serde(rename = "api_aftershipid")]
    pub api_aftershipid: Option<String>,
    #[serde(rename = "api_taik")]
    pub api_taik: Option<Vec<i64>>,
    #[serde(rename = "api_souk")]
    pub api_souk: Option<Vec<i64>>,
    #[serde(rename = "api_houg")]
    pub api_houg: Option<Vec<i64>>,
    #[serde(rename = "api_raig")]
    pub api_raig: Option<Vec<i64>>,
    #[serde(rename = "api_tyku")]
    pub api_tyku: Option<Vec<i64>>,
    #[serde(rename = "api_luck")]
    pub api_luck: Option<Vec<i64>>,
    #[serde(rename = "api_soku")]
    pub api_soku: i64,
    #[serde(rename = "api_leng")]
    pub api_leng: Option<i64>,
    #[serde(rename = "api_slot_num")]
    pub api_slot_num: i64,
    #[serde(rename = "api_maxeq")]
    pub api_maxeq: Option<Vec<i64>>,
    #[serde(rename = "api_buildtime")]
    pub api_buildtime: Option<i64>,
    #[serde(rename = "api_broken")]
    pub api_broken: Option<Vec<i64>>,
    #[serde(rename = "api_powup")]
    pub api_powup: Option<Vec<i64>>,
    #[serde(rename = "api_backs")]
    pub api_backs: Option<i64>,
    #[serde(rename = "api_getmes")]
    pub api_getmes: Option<String>,
    #[serde(rename = "api_afterfuel")]
    pub api_afterfuel: Option<i64>,
    #[serde(rename = "api_afterbull")]
    pub api_afterbull: Option<i64>,
    #[serde(rename = "api_fuel_max")]
    pub api_fuel_max: Option<i64>,
    #[serde(rename = "api_bull_max")]
    pub api_bull_max: Option<i64>,
    #[serde(rename = "api_voicef")]
    pub api_voicef: Option<i64>,
    #[serde(rename = "api_tais")]
    pub api_tais: Option<Vec<i64>>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstShipgraph {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_filename")]
    pub api_filename: String,
    #[serde(rename = "api_version")]
    pub api_version: Vec<String>,
    #[serde(rename = "api_battle_n")]
    pub api_battle_n: Option<Vec<i64>>,
    #[serde(rename = "api_battle_d")]
    pub api_battle_d: Option<Vec<i64>>,
    #[serde(rename = "api_sortno")]
    pub api_sortno: Option<i64>,
    #[serde(rename = "api_boko_n")]
    pub api_boko_n: Option<Vec<i64>>,
    #[serde(rename = "api_boko_d")]
    pub api_boko_d: Option<Vec<i64>>,
    #[serde(rename = "api_kaisyu_n")]
    pub api_kaisyu_n: Option<Vec<i64>>,
    #[serde(rename = "api_kaisyu_d")]
    pub api_kaisyu_d: Option<Vec<i64>>,
    #[serde(rename = "api_kaizo_n")]
    pub api_kaizo_n: Option<Vec<i64>>,
    #[serde(rename = "api_kaizo_d")]
    pub api_kaizo_d: Option<Vec<i64>>,
    #[serde(rename = "api_map_n")]
    pub api_map_n: Option<Vec<i64>>,
    #[serde(rename = "api_map_d")]
    pub api_map_d: Option<Vec<i64>>,
    #[serde(rename = "api_ensyuf_n")]
    pub api_ensyuf_n: Option<Vec<i64>>,
    #[serde(rename = "api_ensyuf_d")]
    pub api_ensyuf_d: Option<Vec<i64>>,
    #[serde(rename = "api_ensyue_n")]
    pub api_ensyue_n: Option<Vec<i64>>,
    #[serde(rename = "api_weda")]
    pub api_weda: Option<Vec<i64>>,
    #[serde(rename = "api_wedb")]
    pub api_wedb: Option<Vec<i64>>,
    #[serde(rename = "api_pa")]
    pub api_pa: Option<Vec<i64>>,
    #[serde(rename = "api_pab")]
    pub api_pab: Option<Vec<i64>>,
    #[serde(rename = "api_sp_flag")]
    pub api_sp_flag: Option<i64>,
    #[serde(rename = "api_wedc")]
    pub api_wedc: Option<Vec<i64>>,
    #[serde(rename = "api_wedd")]
    pub api_wedd: Option<Vec<i64>>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstSlotitemEquiptype {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_show_flg")]
    pub api_show_flg: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstEquipExslotShip {
    #[serde(rename = "api_ship_ids")]
    pub api_ship_ids: Option<HashMap<String, i64>>,
    #[serde(rename = "api_stypes")]
    pub api_stypes: Option<HashMap<String, i64>>,
    #[serde(rename = "api_ctypes")]
    pub api_ctypes: Option<HashMap<String, i64>>,
    #[serde(rename = "api_req_level")]
    pub api_req_level: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstSlotitem {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_sortno")]
    pub api_sortno: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_type")]
    pub api_type: Vec<i64>,
    #[serde(rename = "api_taik")]
    pub api_taik: i64,
    #[serde(rename = "api_souk")]
    pub api_souk: i64,
    #[serde(rename = "api_houg")]
    pub api_houg: i64,
    #[serde(rename = "api_raig")]
    pub api_raig: i64,
    #[serde(rename = "api_soku")]
    pub api_soku: i64,
    #[serde(rename = "api_baku")]
    pub api_baku: i64,
    #[serde(rename = "api_tyku")]
    pub api_tyku: i64,
    #[serde(rename = "api_tais")]
    pub api_tais: i64,
    #[serde(rename = "api_atap")]
    pub api_atap: i64,
    #[serde(rename = "api_houm")]
    pub api_houm: i64,
    #[serde(rename = "api_raim")]
    pub api_raim: i64,
    #[serde(rename = "api_houk")]
    pub api_houk: i64,
    #[serde(rename = "api_raik")]
    pub api_raik: i64,
    #[serde(rename = "api_bakk")]
    pub api_bakk: i64,
    #[serde(rename = "api_saku")]
    pub api_saku: i64,
    #[serde(rename = "api_sakb")]
    pub api_sakb: i64,
    #[serde(rename = "api_luck")]
    pub api_luck: i64,
    #[serde(rename = "api_leng")]
    pub api_leng: i64,
    #[serde(rename = "api_rare")]
    pub api_rare: i64,
    #[serde(rename = "api_broken")]
    pub api_broken: Vec<i64>,
    #[serde(rename = "api_usebull")]
    pub api_usebull: String,
    #[serde(rename = "api_version")]
    pub api_version: Option<i64>,
    #[serde(rename = "api_cost")]
    pub api_cost: Option<i64>,
    #[serde(rename = "api_distance")]
    pub api_distance: Option<i64>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstFurnituregraph {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_no")]
    pub api_no: i64,
    #[serde(rename = "api_filename")]
    pub api_filename: String,
    #[serde(rename = "api_version")]
    pub api_version: String,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstUseitem {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_usetype")]
    pub api_usetype: i64,
    #[serde(rename = "api_category")]
    pub api_category: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_description")]
    pub api_description: Vec<String>,
    #[serde(rename = "api_price")]
    pub api_price: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstPayitem {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_description")]
    pub api_description: String,
    #[serde(rename = "api_shop_description")]
    pub api_shop_description: String,
    #[serde(rename = "api_item")]
    pub api_item: Vec<i64>,
    #[serde(rename = "api_price")]
    pub api_price: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstItemShop {
    #[serde(rename = "api_cabinet_1")]
    pub api_cabinet_1: Vec<i64>,
    #[serde(rename = "api_cabinet_2")]
    pub api_cabinet_2: Vec<i64>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstMaparea {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_type")]
    pub api_type: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstMapinfo {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_maparea_id")]
    pub api_maparea_id: i64,
    #[serde(rename = "api_no")]
    pub api_no: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_level")]
    pub api_level: i64,
    #[serde(rename = "api_opetext")]
    pub api_opetext: String,
    #[serde(rename = "api_infotext")]
    pub api_infotext: String,
    #[serde(rename = "api_item")]
    pub api_item: Vec<i64>,
    #[serde(rename = "api_max_maphp")]
    pub api_max_maphp: Option<i64>,
    #[serde(rename = "api_required_defeat_count")]
    pub api_required_defeat_count: Option<i64>,
    #[serde(rename = "api_sally_flag")]
    pub api_sally_flag: Vec<i64>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstMapbgm {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_maparea_id")]
    pub api_maparea_id: i64,
    #[serde(rename = "api_no")]
    pub api_no: i64,
    #[serde(rename = "api_moving_bgm")]
    pub api_moving_bgm: i64,
    #[serde(rename = "api_map_bgm")]
    pub api_map_bgm: Vec<i64>,
    #[serde(rename = "api_boss_bgm")]
    pub api_boss_bgm: Vec<i64>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstMission {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_disp_no")]
    pub api_disp_no: String,
    #[serde(rename = "api_maparea_id")]
    pub api_maparea_id: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_details")]
    pub api_details: String,
    #[serde(rename = "api_reset_type")]
    pub api_reset_type: i64,
    #[serde(rename = "api_damage_type")]
    pub api_damage_type: i64,
    #[serde(rename = "api_time")]
    pub api_time: i64,
    #[serde(rename = "api_deck_num")]
    pub api_deck_num: i64,
    #[serde(rename = "api_difficulty")]
    pub api_difficulty: i64,
    #[serde(rename = "api_use_fuel")]
    pub api_use_fuel: f64,
    #[serde(rename = "api_use_bull")]
    pub api_use_bull: f64,
    #[serde(rename = "api_win_item1")]
    pub api_win_item1: Vec<i64>,
    #[serde(rename = "api_win_item2")]
    pub api_win_item2: Vec<i64>,
    #[serde(rename = "api_win_mat_level")]
    pub api_win_mat_level: Vec<i64>,
    #[serde(rename = "api_return_flag")]
    pub api_return_flag: i64,
    #[serde(rename = "api_sample_fleet")]
    pub api_sample_fleet: Vec<i64>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstConst {
    #[serde(rename = "api_parallel_quest_max")]
    pub api_parallel_quest_max: ApiParallelQuestMax,
    #[serde(rename = "api_boko_max_ships")]
    pub api_boko_max_ships: ApiBokoMaxShips,
    #[serde(rename = "api_dpflag_quest")]
    pub api_dpflag_quest: ApiDpflagQuest,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiParallelQuestMax {
    #[serde(rename = "api_string_value")]
    pub api_string_value: String,
    #[serde(rename = "api_int_value")]
    pub api_int_value: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiBokoMaxShips {
    #[serde(rename = "api_string_value")]
    pub api_string_value: String,
    #[serde(rename = "api_int_value")]
    pub api_int_value: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiDpflagQuest {
    #[serde(rename = "api_string_value")]
    pub api_string_value: String,
    #[serde(rename = "api_int_value")]
    pub api_int_value: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstShipupgrade {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_current_ship_id")]
    pub api_current_ship_id: i64,
    #[serde(rename = "api_original_ship_id")]
    pub api_original_ship_id: i64,
    #[serde(rename = "api_upgrade_type")]
    pub api_upgrade_type: i64,
    #[serde(rename = "api_upgrade_level")]
    pub api_upgrade_level: i64,
    #[serde(rename = "api_drawing_count")]
    pub api_drawing_count: i64,
    #[serde(rename = "api_catapult_count")]
    pub api_catapult_count: i64,
    #[serde(rename = "api_report_count")]
    pub api_report_count: i64,
    #[serde(rename = "api_aviation_mat_count")]
    pub api_aviation_mat_count: i64,
    #[serde(rename = "api_arms_mat_count")]
    pub api_arms_mat_count: i64,
    #[serde(rename = "api_tech_count")]
    pub api_tech_count: i64,
    #[serde(rename = "api_sortno")]
    pub api_sortno: i64,
    #[serde(rename = "api_boiler_count")]
    pub api_boiler_count: Option<i64>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstBgm {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstEquipShip {
    #[cfg(not(feature = "20250627"))]
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: i64,
    #[cfg(not(feature = "20250627"))]
    #[serde(rename = "api_equip_type")]
    pub api_equip_type: Vec<i64>,
    #[cfg(feature = "20250627")]
    #[serde(rename = "api_equip_type")]
    pub api_equip_type: HashMap<i64, Option<Vec<i64>>>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMstFurniture {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_no")]
    pub api_no: i64,
    #[serde(rename = "api_title")]
    pub api_title: String,
    #[serde(rename = "api_description")]
    pub api_description: String,
    #[serde(rename = "api_rarity")]
    pub api_rarity: i64,
    #[serde(rename = "api_price")]
    pub api_price: i64,
    #[serde(rename = "api_saleflg")]
    pub api_saleflg: i64,
    #[serde(rename = "api_bgm_id")]
    pub api_bgm_id: i64,
    #[serde(rename = "api_version")]
    pub api_version: i64,
    #[serde(rename = "api_outside_id")]
    pub api_outside_id: i64,
    #[serde(rename = "api_active_flag")]
    pub api_active_flag: i64,
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

        let pattern_str = "S@api_start2@getData";
        let log_path = "./src/endpoints/api_start2/get_data@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_start2@getData";
        let log_path = "./src/endpoints/api_start2/get_data@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
