use kc_api_interface::interface::{EmitData, Identifier, Set};
use kc_api_interface::mst_equip_exslot::MstEquipExslots;
use kc_api_interface::mst_equip_exslot_ship::MstEquipExslotShips;
#[cfg(feature = "20250627")]
use kc_api_interface::mst_equip_limit_exslot::MstEquipLimitExslots;
use kc_api_interface::mst_equip_ship::MstEquipShips;
use kc_api_interface::mst_maparea::MstMapAreas;
use kc_api_interface::mst_mapinfo::MstMapInfos;
use kc_api_interface::mst_ship::MstShips;
use kc_api_interface::mst_ship_graph::MstShipGraphs;
use kc_api_interface::mst_ship_upgrade::MstShipUpgrades;
use kc_api_interface::mst_slot_item::MstSlotItems;
use kc_api_interface::mst_slot_item_equip_type::MstSlotItemEquipTypes;
use kc_api_interface::mst_stype::MstStypes;
use kc_api_interface::mst_use_item::MstUseItems;

use kc_api_dto::main::api_start2::*;

use register_trait::TraitForConvert;

impl TraitForConvert for get_data::Res {
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
