#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_start2@get_data.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_start2/get_data)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;
use std::collections::HashMap;

use register_trait::{add_field, register_struct};

use register_trait::{NumberSizeChecker, TraitForConvert, TraitForRoot, TraitForTest};

use crate::interface::interface::{EmitData, Identifier, Set};
use crate::interface::mst_equip_exslot::MstEquipExslots;
use crate::interface::mst_equip_exslot_ship::MstEquipExslotShips;
#[cfg(feature = "20250627")]
use crate::interface::mst_equip_limit_exslot::MstEquipLimitExslots;
use crate::interface::mst_equip_ship::MstEquipShips;
use crate::interface::mst_maparea::MstMapAreas;
use crate::interface::mst_mapinfo::MstMapInfos;
use crate::interface::mst_ship::MstShips;
use crate::interface::mst_ship_graph::MstShipGraphs;
use crate::interface::mst_ship_upgrade::MstShipUpgrades;
use crate::interface::mst_slot_item::MstSlotItems;
use crate::interface::mst_slot_item_equip_type::MstSlotItemEquipTypes;
use crate::interface::mst_stype::MstStypes;
use crate::interface::mst_use_item::MstUseItems;

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
#[register_struct(name = "api_start2/getData")]
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
    pub api_mst_ship: Vec<ApiMstShip>,
    pub api_mst_shipgraph: Vec<ApiMstShipgraph>,
    pub api_mst_slotitem_equiptype: Vec<ApiMstSlotitemEquiptype>,
    pub api_mst_equip_exslot: Vec<i64>,
    pub api_mst_equip_exslot_ship: HashMap<String, ApiMstEquipExslotShip>,
    pub api_mst_stype: Vec<ApiMstStype>,
    pub api_mst_slotitem: Vec<ApiMstSlotitem>,
    pub api_mst_furnituregraph: Vec<ApiMstFurnituregraph>,
    pub api_mst_useitem: Vec<ApiMstUseitem>,
    pub api_mst_payitem: Vec<ApiMstPayitem>,
    pub api_mst_item_shop: ApiMstItemShop,
    pub api_mst_maparea: Vec<ApiMstMaparea>,
    pub api_mst_mapinfo: Vec<ApiMstMapinfo>,
    pub api_mst_mapbgm: Vec<ApiMstMapbgm>,
    pub api_mst_mission: Vec<ApiMstMission>,
    pub api_mst_const: ApiMstConst,
    pub api_mst_shipupgrade: Vec<ApiMstShipupgrade>,
    pub api_mst_bgm: Vec<ApiMstBgm>,
    #[cfg(not(feature = "20250627"))]
    pub api_mst_equip_ship: Vec<ApiMstEquipShip>,
    #[cfg(feature = "20250627")]
    pub api_mst_equip_ship: HashMap<i64, ApiMstEquipShip>,
    // 20250627
    pub api_mst_equip_limit_exslot: Option<HashMap<i64, Vec<i64>>>,
    pub api_mst_furniture: Vec<ApiMstFurniture>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstStype {
    pub api_id: i64,
    pub api_sortno: i64,
    pub api_name: String,
    pub api_scnt: i64,
    pub api_kcnt: i64,
    pub api_equip_type: HashMap<String, i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstShip {
    pub api_id: i64,
    pub api_sortno: Option<i64>,
    pub api_sort_id: i64,
    pub api_name: String,
    pub api_yomi: String,
    pub api_stype: i64,
    pub api_ctype: i64,
    pub api_afterlv: Option<i64>,
    pub api_aftershipid: Option<String>,
    pub api_taik: Option<Vec<i64>>,
    pub api_souk: Option<Vec<i64>>,
    pub api_houg: Option<Vec<i64>>,
    pub api_raig: Option<Vec<i64>>,
    pub api_tyku: Option<Vec<i64>>,
    pub api_luck: Option<Vec<i64>>,
    pub api_soku: i64,
    pub api_leng: Option<i64>,
    pub api_slot_num: i64,
    pub api_maxeq: Option<Vec<i64>>,
    pub api_buildtime: Option<i64>,
    pub api_broken: Option<Vec<i64>>,
    pub api_powup: Option<Vec<i64>>,
    pub api_backs: Option<i64>,
    pub api_getmes: Option<String>,
    pub api_afterfuel: Option<i64>,
    pub api_afterbull: Option<i64>,
    pub api_fuel_max: Option<i64>,
    pub api_bull_max: Option<i64>,
    pub api_voicef: Option<i64>,
    pub api_tais: Option<Vec<i64>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstShipgraph {
    pub api_id: i64,
    pub api_filename: String,
    pub api_version: Vec<String>,
    pub api_battle_n: Option<Vec<i64>>,
    pub api_battle_d: Option<Vec<i64>>,
    pub api_sortno: Option<i64>,
    pub api_boko_n: Option<Vec<i64>>,
    pub api_boko_d: Option<Vec<i64>>,
    pub api_kaisyu_n: Option<Vec<i64>>,
    pub api_kaisyu_d: Option<Vec<i64>>,
    pub api_kaizo_n: Option<Vec<i64>>,
    pub api_kaizo_d: Option<Vec<i64>>,
    pub api_map_n: Option<Vec<i64>>,
    pub api_map_d: Option<Vec<i64>>,
    pub api_ensyuf_n: Option<Vec<i64>>,
    pub api_ensyuf_d: Option<Vec<i64>>,
    pub api_ensyue_n: Option<Vec<i64>>,
    pub api_weda: Option<Vec<i64>>,
    pub api_wedb: Option<Vec<i64>>,
    pub api_pa: Option<Vec<i64>>,
    pub api_pab: Option<Vec<i64>>,
    pub api_sp_flag: Option<i64>,
    pub api_wedc: Option<Vec<i64>>,
    pub api_wedd: Option<Vec<i64>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstSlotitemEquiptype {
    pub api_id: i64,
    pub api_name: String,
    pub api_show_flg: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstEquipExslotShip {
    pub api_ship_ids: Option<HashMap<String, i64>>,
    pub api_stypes: Option<HashMap<String, i64>>,
    pub api_ctypes: Option<HashMap<String, i64>>,
    pub api_req_level: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstSlotitem {
    pub api_id: i64,
    pub api_sortno: i64,
    pub api_name: String,
    pub api_type: Vec<i64>,
    pub api_taik: i64,
    pub api_souk: i64,
    pub api_houg: i64,
    pub api_raig: i64,
    pub api_soku: i64,
    pub api_baku: i64,
    pub api_tyku: i64,
    pub api_tais: i64,
    pub api_atap: i64,
    pub api_houm: i64,
    pub api_raim: i64,
    pub api_houk: i64,
    pub api_raik: i64,
    pub api_bakk: i64,
    pub api_saku: i64,
    pub api_sakb: i64,
    pub api_luck: i64,
    pub api_leng: i64,
    pub api_rare: i64,
    pub api_broken: Vec<i64>,
    pub api_usebull: String,
    pub api_version: Option<i64>,
    pub api_cost: Option<i64>,
    pub api_distance: Option<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstFurnituregraph {
    pub api_id: i64,
    pub api_type: i64,
    pub api_no: i64,
    pub api_filename: String,
    pub api_version: String,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstUseitem {
    pub api_id: i64,
    pub api_usetype: i64,
    pub api_category: i64,
    pub api_name: String,
    pub api_description: Vec<String>,
    pub api_price: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstPayitem {
    pub api_id: i64,
    pub api_type: i64,
    pub api_name: String,
    pub api_description: String,
    pub api_shop_description: String,
    pub api_item: Vec<i64>,
    pub api_price: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstItemShop {
    pub api_cabinet_1: Vec<i64>,
    pub api_cabinet_2: Vec<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstMaparea {
    pub api_id: i64,
    pub api_name: String,
    pub api_type: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstMapinfo {
    pub api_id: i64,
    pub api_maparea_id: i64,
    pub api_no: i64,
    pub api_name: String,
    pub api_level: i64,
    pub api_opetext: String,
    pub api_infotext: String,
    pub api_item: Vec<i64>,
    pub api_max_maphp: Option<i64>,
    pub api_required_defeat_count: Option<i64>,
    pub api_sally_flag: Vec<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstMapbgm {
    pub api_id: i64,
    pub api_maparea_id: i64,
    pub api_no: i64,
    pub api_moving_bgm: i64,
    pub api_map_bgm: Vec<i64>,
    pub api_boss_bgm: Vec<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstMission {
    pub api_id: i64,
    pub api_disp_no: String,
    pub api_maparea_id: i64,
    pub api_name: String,
    pub api_details: String,
    pub api_reset_type: i64,
    pub api_damage_type: i64,
    pub api_time: i64,
    pub api_deck_num: i64,
    pub api_difficulty: i64,
    pub api_use_fuel: f64,
    pub api_use_bull: f64,
    pub api_win_item1: Vec<i64>,
    pub api_win_item2: Vec<i64>,
    pub api_win_mat_level: Vec<i64>,
    pub api_return_flag: i64,
    pub api_sample_fleet: Vec<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstConst {
    pub api_parallel_quest_max: ApiParallelQuestMax,
    pub api_boko_max_ships: ApiBokoMaxShips,
    pub api_dpflag_quest: ApiDpflagQuest,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiParallelQuestMax {
    pub api_string_value: String,
    pub api_int_value: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiBokoMaxShips {
    pub api_string_value: String,
    pub api_int_value: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiDpflagQuest {
    pub api_string_value: String,
    pub api_int_value: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstShipupgrade {
    pub api_id: i64,
    pub api_current_ship_id: i64,
    pub api_original_ship_id: i64,
    pub api_upgrade_type: i64,
    pub api_upgrade_level: i64,
    pub api_drawing_count: i64,
    pub api_catapult_count: i64,
    pub api_report_count: i64,
    pub api_aviation_mat_count: i64,
    pub api_arms_mat_count: i64,
    pub api_tech_count: i64,
    pub api_sortno: i64,
    pub api_boiler_count: Option<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstBgm {
    pub api_id: i64,
    pub api_name: String,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstEquipShip {
    #[cfg(not(feature = "20250627"))]
    pub api_ship_id: i64,
    #[cfg(not(feature = "20250627"))]
    pub api_equip_type: Vec<i64>,
    #[cfg(feature = "20250627")]
    pub api_equip_type: HashMap<i64, Option<Vec<i64>>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMstFurniture {
    pub api_id: i64,
    pub api_type: i64,
    pub api_no: i64,
    pub api_title: String,
    pub api_description: String,
    pub api_rarity: i64,
    pub api_price: i64,
    pub api_saleflg: i64,
    pub api_bgm_id: i64,
    pub api_version: i64,
    pub api_outside_id: i64,
    pub api_active_flag: i64,
}

impl TraitForConvert for Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        // need to add other fields
        let mst_ships: MstShips = self.api_data.api_mst_ship.clone().into();

        let mst_slot_items: MstSlotItems = self.api_data.api_mst_slotitem.clone().into();

        let mst_equip_exslot_ship: MstEquipExslotShips =
            self.api_data.api_mst_equip_exslot_ship.clone().into();

        let mst_slot_item_equip_type: MstSlotItemEquipTypes =
            self.api_data.api_mst_slotitem_equiptype.clone().into();

        let mst_equip_ship: MstEquipShips = self.api_data.api_mst_equip_ship.clone().into();

        #[cfg(feature = "20250627")]
        let mst_equip_limit_exslot: MstEquipLimitExslots = self.api_data.clone().into();

        let mst_equip_exslot: MstEquipExslots = self.api_data.clone().into();

        let mst_stype: MstStypes = self.api_data.api_mst_stype.clone().into();

        let mst_use_item: MstUseItems = self.api_data.api_mst_useitem.clone().into();

        let mst_ship_graphs: MstShipGraphs = self.api_data.api_mst_shipgraph.clone().into();
        let mst_map_areas: MstMapAreas = self.api_data.api_mst_maparea.clone().into();
        let mst_map_infos: MstMapInfos = self.api_data.api_mst_mapinfo.clone().into();
        let mst_ship_upgrades: MstShipUpgrades = self.api_data.api_mst_shipupgrade.clone().into();

        Some(vec![
            EmitData::Set(Set::MstShips(mst_ships)),
            EmitData::Set(Set::MstSlotItems(mst_slot_items)),
            EmitData::Set(Set::MstEquipExslotShips(mst_equip_exslot_ship)),
            EmitData::Set(Set::MstSlotItemEquipTypes(mst_slot_item_equip_type)),
            EmitData::Set(Set::MstEquipShips(mst_equip_ship)),
            EmitData::Set(Set::MstEquipLimitExslots(mst_equip_limit_exslot)),
            EmitData::Set(Set::MstEquipExslots(mst_equip_exslot)),
            EmitData::Set(Set::MstStypes(mst_stype)),
            EmitData::Set(Set::MstUseItems(mst_use_item)),
            EmitData::Set(Set::MstShipGraphs(mst_ship_graphs)),
            EmitData::Set(Set::MstMapAreas(mst_map_areas)),
            EmitData::Set(Set::MstMapInfos(mst_map_infos)),
            EmitData::Set(Set::MstShipUpgrades(mst_ship_upgrades)),
            EmitData::Identifier(Identifier::GetData(())),
        ])
    }
}

#[cfg(test)]
mod tests {
    use dotenvy::dotenv;
    use register_trait::{simple_root_check_number_size, simple_root_test};

    use super::*;
    #[test]
    fn test_deserialize() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = "S@api_start2@getData";
        let log_path = "./src/kcapi_main/api_start2/get_data@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_start2@getData";
        let log_path = "./src/kcapi_main/api_start2/get_data@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }

    #[test]
    fn test_possible_values() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = "S@api_start2@getData";
        let log_path = "./src/kcapi_main/api_start2/get_data@check_number@S.log";
        simple_root_check_number_size::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
