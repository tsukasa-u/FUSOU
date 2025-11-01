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

use kc_api_dto::endpoints::api_start2::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

register_trait!(Req, (get_data, get_option_setting));
register_trait!(Res, (get_option_setting));

impl TraitForConvert for get_data::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        // need to add other fields
        let mst_ships =
            InterfaceWrapper::<MstShips>::from(self.api_data.api_mst_ship.clone()).unwrap();
        let mst_slot_items =
            InterfaceWrapper::<MstSlotItems>::from(self.api_data.api_mst_slotitem.clone()).unwrap();
        let mst_equip_exslot_ship = InterfaceWrapper::<MstEquipExslotShips>::from(
            self.api_data.api_mst_equip_exslot_ship.clone(),
        )
        .unwrap();
        let mst_slot_item_equip_type = InterfaceWrapper::<MstSlotItemEquipTypes>::from(
            self.api_data.api_mst_slotitem_equiptype.clone(),
        )
        .unwrap();
        let mst_equip_ship =
            InterfaceWrapper::<MstEquipShips>::from(self.api_data.api_mst_equip_ship.clone())
                .unwrap();

        #[cfg(feature = "20250627")]
        let mst_equip_limit_exslot =
            InterfaceWrapper::<MstEquipLimitExslots>::from(self.api_data.clone()).unwrap();

        let mst_equip_exslot =
            InterfaceWrapper::<MstEquipExslots>::from(self.api_data.clone()).unwrap();
        let mst_stype =
            InterfaceWrapper::<MstStypes>::from(self.api_data.api_mst_stype.clone()).unwrap();
        let mst_use_item =
            InterfaceWrapper::<MstUseItems>::from(self.api_data.api_mst_useitem.clone()).unwrap();
        let mst_ship_graphs =
            InterfaceWrapper::<MstShipGraphs>::from(self.api_data.api_mst_shipgraph.clone())
                .unwrap();
        let mst_map_areas =
            InterfaceWrapper::<MstMapAreas>::from(self.api_data.api_mst_maparea.clone()).unwrap();
        let mst_map_infos =
            InterfaceWrapper::<MstMapInfos>::from(self.api_data.api_mst_mapinfo.clone()).unwrap();
        let mst_ship_upgrades =
            InterfaceWrapper::<MstShipUpgrades>::from(self.api_data.api_mst_shipupgrade.clone())
                .unwrap();

        let mut events = vec![
            EmitData::Set(Set::MstShips(mst_ships)),
            EmitData::Set(Set::MstSlotItems(mst_slot_items)),
            EmitData::Set(Set::MstEquipExslotShips(mst_equip_exslot_ship)),
            EmitData::Set(Set::MstSlotItemEquipTypes(mst_slot_item_equip_type)),
            EmitData::Set(Set::MstEquipShips(mst_equip_ship)),
        ];

        #[cfg(feature = "20250627")]
        events.push(EmitData::Set(Set::MstEquipLimitExslots(
            mst_equip_limit_exslot,
        )));

        events.extend(vec![
            EmitData::Set(Set::MstEquipExslots(mst_equip_exslot)),
            EmitData::Set(Set::MstStypes(mst_stype)),
            EmitData::Set(Set::MstUseItems(mst_use_item)),
            EmitData::Set(Set::MstShipGraphs(mst_ship_graphs)),
            EmitData::Set(Set::MstMapAreas(mst_map_areas)),
            EmitData::Set(Set::MstMapInfos(mst_map_infos)),
            EmitData::Set(Set::MstShipUpgrades(mst_ship_upgrades)),
            EmitData::Identifier(Identifier::GetData(())),
        ]);

        Some(events)
    }
}
