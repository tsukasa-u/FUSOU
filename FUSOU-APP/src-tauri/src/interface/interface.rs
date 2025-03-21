use super::air_base::AirBases;
use super::battle::Battle;
use super::battle::Battles;
use super::cells::{Cell, Cells};
use super::deck_port::DeckPorts;
use super::logs::Logs;
use super::material::Materials;
use super::mst_equip_exslot_ship::MstEquipExslotShips;
use super::mst_equip_ship::MstEquipShips;
use super::mst_ship::MstShips;
use super::mst_slot_item::MstSlotItems;
use super::mst_slot_item_equip_type::MstSlotItemEquipTypes;
use super::mst_stype::MstStypes;
use super::mst_use_item::MstUseItems;
use super::n_dock::NDocks;
use super::ship::Ships;
use super::slot_item::SlotItems;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum EmitData {
    Add(Add),
    Set(Set),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum Set {
    Materials(Materials),
    DeckPorts(DeckPorts),
    // Mission,
    NDocks(NDocks),
    Ships(Ships),
    SlotItems(SlotItems),
    Logs(Logs),
    AirBases(AirBases),
    Battles(Battles),
    Cells(Cells),
    MstShips(MstShips),
    MstSlotItems(MstSlotItems),
    MstEquipExslotShips(MstEquipExslotShips),
    MstEquipShips(MstEquipShips),
    MstSlotItemEquipTypes(MstSlotItemEquipTypes),
    MstStypes(MstStypes),
    MstUseItems(MstUseItems),
    Dammy(()),
}
