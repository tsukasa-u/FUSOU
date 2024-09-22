pub use super::material::Materials;
pub use super::logs::Logs;
pub use super::deck_port::DeckPorts;
pub use super::n_dock::NDocks;
pub use super::ship::Ships;
pub use super::slot_item::SlotItems;
pub use super::mst_ship::MstShips;
pub use super::mst_slot_item::MstSlotItems;

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
    // Ships(Ships),
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
    // AirBase,(AirBase),
    // Battle(Battle),
    MstShips(MstShips),
    MstSlotItems(MstSlotItems),
}