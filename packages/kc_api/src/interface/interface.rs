use super::air_base::AirBases;
use super::battle::Battle;
use super::cells::{Cell, Cells};
use super::deck_port::DeckPorts;
use super::logs::Logs;
use super::material::Materials;
use super::mst_equip_exslot::MstEquipExslots;
use super::mst_equip_exslot_ship::MstEquipExslotShips;
use super::mst_equip_limit_exslot::MstEquipLimitExslots;
use super::mst_equip_ship::MstEquipShips;
use super::mst_maparea::MstMapAreas;
use super::mst_mapinfo::MstMapInfos;
use super::mst_ship::MstShips;
use super::mst_ship_graph::MstShipGraphs;
use super::mst_ship_upgrade::MstShipUpgrades;
use super::mst_slot_item::MstSlotItems;
use super::mst_slot_item_equip_type::MstSlotItemEquipTypes;
use super::mst_stype::MstStypes;
use super::mst_use_item::MstUseItems;
use super::n_dock::NDocks;
use super::ship::Ships;
use super::slot_item::SlotItems;

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
}
