use super::battle::Battle;
pub use super::material::Materials;
pub use super::logs::Logs;
pub use super::deck_port::DeckPorts;
pub use super::mst_equip_exslot_ship::MstEquipExslotShips;
pub use super::mst_equip_ship::MstEquipShips;
pub use super::mst_stype::MstStypes;
pub use crate::interface::mst_use_item::MstUseItems;
pub use super::n_dock::NDocks;
pub use super::ship::Ships;
pub use super::slot_item::SlotItems;
pub use super::mst_ship::MstShips;
pub use super::mst_slot_item::MstSlotItems;
pub use super::battle::Battles;
pub use super::cells::{Cells, Cell};
pub use super::air_base::AirBases;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum EmitData {
    Add(Add),
    Set(Set),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum Add {
    // Materials(Materials),
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
    MstStypes(MstStypes),
    MstUseItems(MstUseItems),
    Dammy(()),
}