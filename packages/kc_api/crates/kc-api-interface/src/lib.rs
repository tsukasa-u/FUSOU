use crate::{
    mst_equip_exslot::MstEquipExslot, mst_equip_exslot_ship::MstEquipExslotShip,
    mst_equip_limit_exslot::MstEquipLimitExslot, mst_equip_ship::MstEquipShip,
    mst_maparea::MstMapArea, mst_mapinfo::MstMapInfo, mst_ship::MstShip,
    mst_ship_graph::MstShipGraph, mst_ship_upgrade::MstShipUpgrade, mst_slot_item::MstSlotItem,
    mst_slot_item_equip_type::MstSlotItemEquipType, mst_stype::MstStype, mst_use_item::MstUseItem,
};

pub mod air_base;
pub mod battle;
pub mod cells;
pub mod deck_port;
pub mod logs;
pub mod material;
pub mod mission;
pub mod mst_equip_exslot;
pub mod mst_equip_exslot_ship;
pub mod mst_equip_limit_exslot;
pub mod mst_equip_ship;
pub mod mst_ship;
pub mod mst_slot_item;
pub mod mst_slot_item_equip_type;
pub mod mst_stype;
pub mod mst_use_item;
pub mod n_dock;
pub mod ship;
pub mod slot_item;

pub mod mst_maparea;
pub mod mst_mapinfo;
pub mod mst_ship_graph;
pub mod mst_ship_upgrade;

#[allow(clippy::module_inception)]
pub mod interface;

impl MstShip {
    pub fn get_table_name() -> String {
        "mst_ships".to_string()
    }
}
impl MstSlotItem {
    pub fn get_table_name() -> String {
        "mst_slot_items".to_string()
    }
}
impl MstSlotItemEquipType {
    pub fn get_table_name() -> String {
        "mst_slotitem_equip_types".to_string()
    }
}
impl MstStype {
    pub fn get_table_name() -> String {
        "mst_stypes".to_string()
    }
}
impl MstUseItem {
    pub fn get_table_name() -> String {
        "mst_use_items".to_string()
    }
}
impl MstMapArea {
    pub fn get_table_name() -> String {
        "mst_map_areas".to_string()
    }
}
impl MstMapInfo {
    pub fn get_table_name() -> String {
        "mst_map_infos".to_string()
    }
}
impl MstShipGraph {
    pub fn get_table_name() -> String {
        "mst_ship_graphs".to_string()
    }
}
impl MstShipUpgrade {
    pub fn get_table_name() -> String {
        "mst_ship_upgrades".to_string()
    }
}
impl MstEquipExslotShip {
    pub fn get_table_name() -> String {
        "mst_equip_exslot_ships".to_string()
    }
}
impl MstEquipExslot {
    pub fn get_table_name() -> String {
        "mst_equip_exslot".to_string()
    }
}
impl MstEquipLimitExslot {
    pub fn get_table_name() -> String {
        "mst_equip_limit_exslot".to_string()
    }
}
impl MstEquipShip {
    pub fn get_table_name() -> String {
        "mst_equip_ships".to_string()
    }
}
