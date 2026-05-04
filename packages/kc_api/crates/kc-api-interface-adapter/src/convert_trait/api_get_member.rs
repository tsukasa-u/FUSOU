use kc_api_interface::air_base::AirBases;
use kc_api_interface::deck_port::DeckPorts;
use kc_api_interface::interface::{EmitData, Identifier, Set};
use kc_api_interface::quest::Quests;
use kc_api_interface::ship_growth::{ShipGrowthEntry, ShipGrowthSnapshot, SlotComposition};
use kc_api_interface::slot_item::SlotItems;
use kc_api_interface::soku_speed_observed::{
    SokuSpeedObservedEntry, SokuSpeedObservedSnapshot,
    SlotComposition as SokuSpeedSlotComposition,
};

use kc_api_dto::endpoints::api_get_member::*;
use kc_api_interface::use_items::UseItems;

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

fn build_slot_composition_vec(slot_ids: &[i64], slot_items: &SlotItems) -> Vec<SlotComposition> {
    slot_ids
        .iter()
        .filter_map(|&slot_id| build_slot_composition(slot_id, slot_items))
        .collect()
}

fn build_soku_speed_slot(slot_id: i64, slot_items: &SlotItems) -> Option<SokuSpeedSlotComposition> {
    if slot_id <= 0 {
        return None;
    }
    slot_items.slot_items.get(&slot_id).map(|si| SokuSpeedSlotComposition {
        slotitem_id: si.slotitem_id,
        locked: si.locked != 0,
        level: si.level,
        alv: si.alv.unwrap_or(0),
    })
}

fn build_soku_speed_slot_vec(slot_ids: &[i64], slot_items: &SlotItems) -> Vec<SokuSpeedSlotComposition> {
    slot_ids
        .iter()
        .filter_map(|&slot_id| build_soku_speed_slot(slot_id, slot_items))
        .collect()
}

register_trait!(
    Req,
    (
        basic,
        chart_additional_info,
        deck,
        furniture,
        kdock,
        material,
        mapinfo,
        mission,
        ndock,
        payitem,
        picture_book,
        practice,
        preset_deck,
        preset_slot,
        record,
        require_info,
        ship_deck,
        ship2,
        ship3,
        slot_item,
        sortie_conditions,
        unsetslot,
        useitem
    )
);

register_trait!(
    Res,
    (
        basic,
        deck,
        furniture,
        kdock,
        material,
        mission,
        ndock,
        payitem,
        picture_book,
        practice,
        preset_deck,
        preset_slot,
        record,
        ship_deck,
        sortie_conditions,
        unsetslot,
        useitem
    )
);

impl TraitForConvert for mapinfo::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let air_bases =
            InterfaceWrapper::<AirBases>::from(self.api_data.api_air_base.clone()).unwrap();

        Some(vec![EmitData::Set(Set::AirBases(air_bases))])
    }
}

impl TraitForConvert for require_info::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let slot_item =
            InterfaceWrapper::<SlotItems>::from(self.api_data.api_slot_item.clone()).unwrap();
        let use_item =
            InterfaceWrapper::<UseItems>::from(self.api_data.api_useitem.clone()).unwrap();

        Some(vec![
            EmitData::Set(Set::SlotItems(slot_item)),
            EmitData::Set(Set::UseItems(use_item)),
            EmitData::Identifier(Identifier::RequireInfo(())),
        ])
    }
}

impl TraitForConvert for chart_additional_info::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let mut deck_ports = DeckPorts::load();
        for (idx, deck_param) in self.api_data.api_deck_param.iter().enumerate() {
            let deck_id = (idx as i64) + 1;
            if let Some(deck_port) = deck_ports.deck_ports.get_mut(&deck_id) {
                deck_port.chart_seiku_value = Some(deck_param.api_seiku_value);
                deck_port.chart_tp_value = Some(deck_param.api_tp_value);
            }
        }

        Some(vec![EmitData::Set(Set::DeckPorts(deck_ports))])
    }
}

impl TraitForConvert for slot_item::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let slot_item = InterfaceWrapper::<SlotItems>::from(self.api_data.clone()).unwrap();

        Some(vec![EmitData::Set(Set::SlotItems(slot_item))])
    }
}

impl TraitForConvert for questlist::Res {
    type Output = EmitData;

    fn convert(&self) -> Option<Vec<EmitData>> {
        let quests = InterfaceWrapper::<Quests>::from(self.clone()).unwrap();
        Some(vec![EmitData::Set(Set::Quests(quests))])
    }
}

impl TraitForConvert for questlist::Req {
    type Output = EmitData;

    fn convert(&self) -> Option<Vec<EmitData>> {
        kc_api_interface::quest::Quests::set_current_page(self.api_tab_id);
        None
    }
}

impl TraitForConvert for ship2::Res {
    type Output = EmitData;

    fn convert(&self) -> Option<Vec<EmitData>> {
        let slot_items = SlotItems::load();
        let entries = self
            .api_data
            .iter()
            .filter_map(|s| {
                let kaihi_observed = s.api_kaihi.first().copied().unwrap_or(0);
                let taisen_observed = s.api_taisen.first().copied().unwrap_or(0);
                let sakuteki_observed = s.api_sakuteki.first().copied().unwrap_or(0);

                Some(ShipGrowthEntry {
                    master_id: s.api_ship_id,
                    lv: s.api_lv,
                    exp_current: s.api_exp.first().copied().unwrap_or(0),
                    exp_to_next: s.api_exp.get(1).copied(),
                    kyouka: s.api_kyouka.clone(),
                    sp_effect_items_json: serde_json::to_string(&s.api_sp_effect_items).ok(),
                    kaihi_observed,
                    taisen_observed,
                    sakuteki_observed,
                    // Do not normalize on client: server-side normalization handles game-update drift.
                    kaihi_naked: kaihi_observed,
                    taisen_naked: taisen_observed,
                    sakuteki_naked: sakuteki_observed,
                    kaihi_max: s.api_kaihi.get(1).copied().unwrap_or(0),
                    taisen_max: s.api_taisen.get(1).copied().unwrap_or(0),
                    sakuteki_max: s.api_sakuteki.get(1).copied().unwrap_or(0),
                    slots: build_slot_composition_vec(&s.api_slot, &slot_items),
                    exslot: build_slot_composition(s.api_slot_ex, &slot_items),
                })
            })
            .collect::<Vec<_>>();

        let soku_speed_entries = self
            .api_data
            .iter()
            .map(|s| SokuSpeedObservedEntry {
                master_id: s.api_ship_id,
                lv: s.api_lv,
                soku_observed: s.api_soku,
                slots: build_soku_speed_slot_vec(&s.api_slot, &slot_items),
                exslot: build_soku_speed_slot(s.api_slot_ex, &slot_items),
            })
            .collect::<Vec<_>>();

        Some(vec![
            EmitData::Set(Set::ShipGrowthSnapshot(ShipGrowthSnapshot { entries })),
            EmitData::Set(Set::SokuSpeedObservedSnapshot(SokuSpeedObservedSnapshot {
                entries: soku_speed_entries,
            })),
        ])
    }
}

impl TraitForConvert for ship3::Res {
    type Output = EmitData;

    fn convert(&self) -> Option<Vec<EmitData>> {
        let slot_items = SlotItems::load();
        let entries = self
            .api_data
            .api_ship_data
            .iter()
            .filter_map(|s| {
                let kaihi_observed = s.api_kaihi.first().copied().unwrap_or(0);
                let taisen_observed = s.api_taisen.first().copied().unwrap_or(0);
                let sakuteki_observed = s.api_sakuteki.first().copied().unwrap_or(0);

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
                    // Do not normalize on client: server-side normalization handles game-update drift.
                    kaihi_naked: kaihi_observed,
                    taisen_naked: taisen_observed,
                    sakuteki_naked: sakuteki_observed,
                    kaihi_max: s.api_kaihi.get(1).copied().unwrap_or(0),
                    taisen_max: s.api_taisen.get(1).copied().unwrap_or(0),
                    sakuteki_max: s.api_sakuteki.get(1).copied().unwrap_or(0),
                    slots: build_slot_composition_vec(&s.api_slot, &slot_items),
                    exslot: build_slot_composition(s.api_slot_ex, &slot_items),
                })
            })
            .collect::<Vec<_>>();

        let soku_speed_entries_3 = self
            .api_data
            .api_ship_data
            .iter()
            .map(|s| SokuSpeedObservedEntry {
                master_id: s.api_ship_id,
                lv: s.api_lv,
                soku_observed: s.api_soku,
                slots: build_soku_speed_slot_vec(&s.api_slot, &slot_items),
                exslot: build_soku_speed_slot(s.api_slot_ex, &slot_items),
            })
            .collect::<Vec<_>>();

        Some(vec![
            EmitData::Set(Set::ShipGrowthSnapshot(ShipGrowthSnapshot { entries })),
            EmitData::Set(Set::SokuSpeedObservedSnapshot(SokuSpeedObservedSnapshot {
                entries: soku_speed_entries_3,
            })),
        ])
    }
}
