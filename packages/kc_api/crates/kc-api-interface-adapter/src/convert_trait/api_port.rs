use kc_api_interface::deck_port::{Basic, DeckPorts};
use kc_api_interface::interface::{EmitData, Identifier, Set};
use kc_api_interface::logs::Logs;
use kc_api_interface::material::Materials;
use kc_api_interface::mst_ship::MstShips;
use kc_api_interface::n_dock::NDocks;
use kc_api_interface::ship::Ships;
use kc_api_interface::ship_growth::{ShipGrowthEntry, ShipGrowthSnapshot, SlotComposition};
use kc_api_interface::slot_item::SlotItems;
use kc_api_interface::soku_speed_observed::{
    SlotComposition as SokuSpeedSlotComposition, SokuSpeedObservedEntry, SokuSpeedObservedSnapshot,
};

use kc_api_dto::endpoints::api_port::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

fn build_slot_composition(slot_id: i64, slot_items: &SlotItems) -> Option<SlotComposition> {
    if slot_id <= 0 {
        return None;
    }
    slot_items
        .slot_items
        .get(&slot_id)
        .map(|si| SlotComposition {
            slotitem_id: si.slotitem_id,
            locked: si.locked != 0,
            level: si.level,
            alv: si.alv.unwrap_or(0),
        })
}

fn build_soku_speed_slot(slot_id: i64, slot_items: &SlotItems) -> Option<SokuSpeedSlotComposition> {
    if slot_id <= 0 {
        return None;
    }
    slot_items
        .slot_items
        .get(&slot_id)
        .map(|si| SokuSpeedSlotComposition {
            slotitem_id: si.slotitem_id,
            locked: si.locked != 0,
            level: si.level,
            alv: si.alv.unwrap_or(0),
        })
}

fn build_soku_speed_slot_vec(
    slot_ids: &[i64],
    slot_items: &SlotItems,
) -> Vec<SokuSpeedSlotComposition> {
    slot_ids
        .iter()
        .filter_map(|&slot_id| build_soku_speed_slot(slot_id, slot_items))
        .collect()
}

/// Returns false if any non-empty slot ID (> 0) is absent from the SlotItems cache.
/// Emitting an observation with a partial slot list would create misleading synergy data.
fn all_slots_resolvable(slot_ids: &[i64], slot_items: &SlotItems) -> bool {
    slot_ids
        .iter()
        .all(|&id| id <= 0 || slot_items.slot_items.contains_key(&id))
}

fn exslot_resolvable(slot_id: i64, slot_items: &SlotItems) -> bool {
    slot_id <= 0 || slot_items.slot_items.contains_key(&slot_id)
}

fn build_slot_composition_vec(slot_ids: &[i64], slot_items: &SlotItems) -> Vec<SlotComposition> {
    slot_ids
        .iter()
        .filter_map(|&slot_id| build_slot_composition(slot_id, slot_items))
        .collect()
}

register_trait!(Req, (air_corps_cond_recovery_with_timer, port));
register_trait!(Res, (air_corps_cond_recovery_with_timer));

impl TraitForConvert for port::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let materials =
            InterfaceWrapper::<Materials>::from(self.api_data.api_material.clone()).unwrap();
        let ships = InterfaceWrapper::<Ships>::from(self.api_data.api_ship.clone()).unwrap();
        let ndocks = InterfaceWrapper::<NDocks>::from(self.api_data.api_ndock.clone()).unwrap();
        let logs = InterfaceWrapper::<Logs>::from(self.api_data.api_log.clone()).unwrap();
        // let deck_ports = InterfaceWrapper::<DeckPorts>::from(self.api_data.api_deck_port.clone()).unwrap();
        let deck_ports = InterfaceWrapper::<DeckPorts>::from(self.api_data.clone()).unwrap();

        let basic = InterfaceWrapper::<Basic>::from(self.api_data.api_basic.clone()).unwrap();

        let slot_items = SlotItems::load();
        let growth_entries = self
            .api_data
            .api_ship
            .iter()
            .filter_map(|s| {
                let kaihi_observed = s.api_kaihi.first().copied().unwrap_or(0);
                let taisen_observed = s.api_taisen.first().copied().unwrap_or(0);
                let sakuteki_observed = s.api_sakuteki.first().copied().unwrap_or(0);
                let lucky_observed = s.api_lucky.first().copied().unwrap_or(0);

                Some(ShipGrowthEntry {
                    master_id: s.api_ship_id,
                    lv: s.api_lv,
                    exp_current: s.api_exp.first().copied().unwrap_or(0),
                    exp_to_next: s.api_exp.get(1).copied(),
                    kyouka: s.api_kyouka.clone(),
                    sp_effect_items_json: s
                        .api_sp_effect_items
                        .as_ref()
                        .and_then(|items| serde_json::to_string(items).ok()),
                    kaihi_observed,
                    taisen_observed,
                    sakuteki_observed,
                    lucky_observed,
                    // Do not normalize on client: server-side normalization handles game-update drift.
                    kaihi_naked: kaihi_observed,
                    taisen_naked: taisen_observed,
                    sakuteki_naked: sakuteki_observed,
                    lucky_naked: lucky_observed,
                    kaihi_max: s.api_kaihi.get(1).copied().unwrap_or(0),
                    taisen_max: s.api_taisen.get(1).copied().unwrap_or(0),
                    sakuteki_max: s.api_sakuteki.get(1).copied().unwrap_or(0),
                    slots: build_slot_composition_vec(&s.api_slot, &slot_items),
                    exslot: build_slot_composition(s.api_slot_ex, &slot_items),
                })
            })
            .collect::<Vec<_>>();

        let growth_snapshot = ShipGrowthSnapshot {
            entries: growth_entries,
        };

        let mst_ships = MstShips::load();
        let soku_speed_entries = self
            .api_data
            .api_ship
            .iter()
            .filter_map(|s| {
                // Skip entries with invalid game speed values (only 5/10/15/20 are valid).
                if !matches!(s.api_soku, 5 | 10 | 15 | 20) {
                    return None;
                }
                let master_soku = mst_ships
                    .mst_ships
                    .get(&(s.api_ship_id as i32))
                    .map(|m| m.soku);
                // Skip entries where master speed is unknown (MstShips not yet loaded),
                // where master speed is an invalid value (not a recognised game speed),
                // or where observed speed is not strictly greater than master speed
                // (covers both no-synergy and the impossible speed-decrease case).
                if master_soku
                    .is_none_or(|ms| !matches!(ms, 5 | 10 | 15 | 20) || ms >= s.api_soku as i32)
                {
                    return None;
                }
                // Skip entries where any equipped slot is absent from the SlotItems cache.
                // A partial slot list would create misleading synergy observations.
                if !all_slots_resolvable(&s.api_slot, &slot_items)
                    || !exslot_resolvable(s.api_slot_ex, &slot_items)
                {
                    return None;
                }
                Some(SokuSpeedObservedEntry {
                    master_id: s.api_ship_id,
                    lv: s.api_lv,
                    soku_observed: s.api_soku,
                    slots: build_soku_speed_slot_vec(&s.api_slot, &slot_items),
                    exslot: build_soku_speed_slot(s.api_slot_ex, &slot_items),
                })
            })
            .collect::<Vec<_>>();

        let mut emit_data = vec![
            EmitData::Set(Set::Basic(basic)),
            EmitData::Set(Set::Materials(materials)),
            EmitData::Set(Set::Ships(ships)),
            EmitData::Set(Set::ShipGrowthSnapshot(growth_snapshot)),
        ];
        if !soku_speed_entries.is_empty() {
            emit_data.push(EmitData::Set(Set::SokuSpeedObservedSnapshot(
                SokuSpeedObservedSnapshot {
                    entries: soku_speed_entries,
                },
            )));
        }
        emit_data.extend([
            EmitData::Set(Set::NDocks(ndocks)),
            EmitData::Set(Set::Logs(logs)),
            EmitData::Set(Set::DeckPorts(deck_ports)),
            EmitData::Identifier(Identifier::Port(())),
        ]);
        Some(emit_data)
    }
}
