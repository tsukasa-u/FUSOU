use crate::use_items::UseItems;
use crate::air_base::AirBases;
use crate::battle::Battle;
use crate::cells::{Cell, Cells};
use crate::deck_port::DeckPorts;
use crate::logs::Logs;
use crate::material::Materials;
use crate::mst_equip_exslot::MstEquipExslots;
use crate::mst_equip_exslot_ship::MstEquipExslotShips;
use crate::mst_equip_limit_exslot::MstEquipLimitExslots;
use crate::mst_equip_ship::MstEquipShips;
use crate::mst_maparea::MstMapAreas;
use crate::mst_mapinfo::MstMapInfos;
use crate::mst_ship::MstShips;
use crate::mst_ship_graph::MstShipGraphs;
use crate::mst_ship_upgrade::MstShipUpgrades;
use crate::mst_slot_item::MstSlotItems;
use crate::mst_slot_item_equip_type::MstSlotItemEquipTypes;
use crate::mst_stype::MstStypes;
use crate::mst_use_item::MstUseItems;
use crate::n_dock::NDocks;
use crate::ship::Ships;
use crate::slot_item::SlotItems;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EmitData {
    Add(Add),
    Set(Set),
    Identifier(Identifier),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Add {
    Materials(Materials),
    // DeckPorts(DeckPorts),
    // Mission,
    // NDocks(NDocks),
    Ships(Ships),
    Battle(Battle),
    Cell(Cell),
    // Logs(Logs),
    // AirBase,(AirBase),
    // Battle(Battle),
    // MstShips(MstShips),
    Dammy(()),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Set {
    Materials(Materials),
    UseItems(UseItems),
    DeckPorts(DeckPorts),
    // Mission,
    NDocks(NDocks),
    Ships(Ships),
    SlotItems(SlotItems),
    Logs(Logs),
    AirBases(AirBases),
    Cells(Cells),
    MstShips(MstShips),
    MstSlotItems(MstSlotItems),
    MstEquipExslotShips(MstEquipExslotShips),
    MstEquipExslots(MstEquipExslots),
    MstEquipLimitExslots(MstEquipLimitExslots),
    MstEquipShips(MstEquipShips),
    MstSlotItemEquipTypes(MstSlotItemEquipTypes),
    MstStypes(MstStypes),
    MstUseItems(MstUseItems),
    MstMapInfos(MstMapInfos),
    MstMapAreas(MstMapAreas),
    MstShipGraphs(MstShipGraphs),
    MstShipUpgrades(MstShipUpgrades),
    Dammy(()),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Identifier {
    Port(()),
    GetData(()),
    RequireInfo(()),
    MapStart(()),
}
