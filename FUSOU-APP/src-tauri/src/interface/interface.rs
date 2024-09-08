use super::material::Materials;
use super::logs::Logs;
use super::deck_port::DeckPorts;
use super::n_dock::NDocks;
use super::ship::Ships;

#[derive(Debug)]
pub enum EmitData {
    Materials(Materials),
    DeckPorts(DeckPorts),
    // Mission(Mission),
    NDocks(NDocks),
    Ships(Ships),
    Logs(Logs),
    // AirBase(AirBase),
    // Battle(Battle),
}