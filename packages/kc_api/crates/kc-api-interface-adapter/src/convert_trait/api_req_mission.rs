use std::sync::atomic::{AtomicI64, Ordering};

use kc_api_dto::endpoints::api_req_mission::*;
use kc_api_interface::deck_port::DeckPorts;
use kc_api_interface::interface::{EmitData, Set};

use crate::TraitForConvert;

static PENDING_START_DECK_ID: AtomicI64 = AtomicI64::new(0);
static PENDING_START_MISSION_ID: AtomicI64 = AtomicI64::new(0);
static PENDING_RETURN_DECK_ID: AtomicI64 = AtomicI64::new(0);
static PENDING_RESULT_DECK_ID: AtomicI64 = AtomicI64::new(0);

impl TraitForConvert for start::Req {
    type Output = EmitData;

    fn convert(&self) -> Option<Vec<EmitData>> {
        PENDING_START_DECK_ID.store(self.api_deck_id, Ordering::Relaxed);
        PENDING_START_MISSION_ID.store(self.api_mission_id, Ordering::Relaxed);
        None
    }
}

impl TraitForConvert for start::Res {
    type Output = EmitData;

    fn convert(&self) -> Option<Vec<EmitData>> {
        let deck_id = PENDING_START_DECK_ID.swap(0, Ordering::Relaxed);
        let mission_id = PENDING_START_MISSION_ID.swap(0, Ordering::Relaxed);
        if self.api_result != 1 || deck_id <= 0 || mission_id <= 0 {
            return None;
        }
        let mut deck_ports = DeckPorts::load();
        if let Some(deck_port) = deck_ports.deck_ports.get_mut(&deck_id) {
            deck_port.mission = vec![1, mission_id, self.api_data.api_complatetime, 0];
            return Some(vec![EmitData::Set(Set::DeckPorts(deck_ports))]);
        }
        None
    }
}

impl TraitForConvert for return_instruction::Req {
    type Output = EmitData;

    fn convert(&self) -> Option<Vec<EmitData>> {
        PENDING_RETURN_DECK_ID.store(self.api_deck_id, Ordering::Relaxed);
        None
    }
}

impl TraitForConvert for return_instruction::Res {
    type Output = EmitData;

    fn convert(&self) -> Option<Vec<EmitData>> {
        let deck_id = PENDING_RETURN_DECK_ID.swap(0, Ordering::Relaxed);
        if self.api_result != 1 || deck_id <= 0 {
            return None;
        }
        let mut deck_ports = DeckPorts::load();
        if let Some(deck_port) = deck_ports.deck_ports.get_mut(&deck_id) {
            deck_port.mission = self.api_data.api_mission.clone();
            return Some(vec![EmitData::Set(Set::DeckPorts(deck_ports))]);
        }
        None
    }
}

impl TraitForConvert for result::Req {
    type Output = EmitData;

    fn convert(&self) -> Option<Vec<EmitData>> {
        PENDING_RESULT_DECK_ID.store(self.api_deck_id, Ordering::Relaxed);
        None
    }
}

impl TraitForConvert for result::Res {
    type Output = EmitData;

    fn convert(&self) -> Option<Vec<EmitData>> {
        let deck_id = PENDING_RESULT_DECK_ID.swap(0, Ordering::Relaxed);
        if self.api_result != 1 || deck_id <= 0 {
            return None;
        }
        let mut deck_ports = DeckPorts::load();
        if let Some(deck_port) = deck_ports.deck_ports.get_mut(&deck_id) {
            deck_port.mission = vec![0, 0, 0, 0];
            return Some(vec![EmitData::Set(Set::DeckPorts(deck_ports))]);
        }
        None
    }
}
