use kc_api_interface::deck_port::DeckPort as InterfaceDeckPort;
use kc_api_interface::ship::Ship as InterfaceShip;
use kc_api_interface::ship::SpEffectItem as InterfaceSpEffectItem;
use kc_api_interface::use_items::UseItem as InterfaceUseItem;
use kc_api_interface::slot_item::SlotItem as InterfaceSlotItem;
use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub struct FleetSnapshot {
    #[serde(rename = "s3s")]
    pub ships: Option<Vec<Ship>>,
    #[serde(rename = "u7s")]
    pub use_items: Option<Vec<UseItem>>,
    #[serde(rename = "s8s")]
    pub slot_items: Option<Vec<SlotItem>>,
    #[serde(rename = "d8k")]
    pub deck_ports: Option<Vec<DeckPortSnapshot>>,
    #[serde(rename = "c11g")]
    pub combined_flag: Option<i64>,
}

impl FleetSnapshot {
    pub fn new(
        ships: Vec<InterfaceShip>,
        use_items: Vec<InterfaceUseItem>,
        slot_items: Vec<InterfaceSlotItem>,
        deck_ports: Vec<InterfaceDeckPort>,
        combined_flag: Option<i64>,
    ) -> Self {
        let mut ships: Vec<Ship> = ships.into_iter().map(Ship::from).collect();
        ships.sort_by_key(|ship| ship.id);

        let mut use_items: Vec<UseItem> = use_items.into_iter().map(UseItem::from).collect();
        use_items.sort_by_key(|item| item.id);

        let mut slot_items: Vec<SlotItem> = slot_items.into_iter().map(SlotItem::from).collect();
        slot_items.sort_by_key(|item| item.id);

        let mut deck_ports: Vec<DeckPortSnapshot> =
            deck_ports.into_iter().map(DeckPortSnapshot::from).collect();
        deck_ports.sort_by_key(|deck| deck.id);

        FleetSnapshot {
            ships: Some(ships),
            use_items: Some(use_items),
            slot_items: Some(slot_items),
            deck_ports: Some(deck_ports),
            combined_flag,
        }
    }
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub struct Ship {
    #[serde(rename = "i0d")]
    pub id: i64,
    // #[serde(rename = "s4o")]
    // pub sortno: i64,
    #[serde(rename = "s5d")]
    pub ship_id: i64,
    #[serde(rename = "l0v")]
    pub lv: i64,
    #[serde(rename = "e1p")]
    pub exp: i64,
    #[serde(rename = "s2u")]
    pub soku: i64,
    #[serde(rename = "l2g")]
    pub leng: i64,
    #[serde(rename = "s2t")]
    pub slot: Vec<i64>,
    #[serde(rename = "o4t")]
    pub onslot: Vec<i64>,
    #[serde(rename = "s5x")]
    pub slot_ex: i64,
    // #[serde(rename = "k4a")]
    // pub kyouka: i64,
    #[serde(rename = "s5m")]
    pub slotnum: i64,
    #[serde(rename = "c2d")]
    pub cond: i64,
    #[serde(rename = "k5u")]
    pub karyoku: i64,
    #[serde(rename = "r4u")]
    pub raisou: i64,
    #[serde(rename = "t3u")]
    pub taiku: i64,
    #[serde(rename = "s4u")]
    pub soukou: i64,
    #[serde(rename = "k3i")]
    pub kaihi: i64,
    #[serde(rename = "t4n")]
    pub taisen: i64,
    #[serde(rename = "s6i")]
    pub sakuteki: i64,
    #[serde(rename = "l3y")]
    pub lucky: i64,
    // #[serde(rename = "l4d")]
    // pub locked: i64,
    // #[serde(rename = "l10p")]
    // pub locked_equip: i64,
    #[serde(rename = "s8a")]
    pub sally_area: Option<i64>,
    #[serde(rename = "s13s")]
    pub sp_effect_items: Option<Vec<SpEffectItem>>,
}

impl From<InterfaceShip> for Ship {
    fn from(ship: InterfaceShip) -> Self {
        Ship {
            id: ship.id,
            // sortno: ship.sortno,
            ship_id: ship.ship_id.unwrap_or(0),
            lv: ship.lv.unwrap_or(0),
            exp: ship.exp.as_ref().and_then(|x| x.first()).copied().unwrap_or(0),
            soku: ship.soku.unwrap_or(0),
            leng: ship.leng.unwrap_or(0),
            slot: ship.slot.unwrap_or_default(),
            onslot: ship.onslot.unwrap_or_default(),
            slot_ex: ship.slot_ex.unwrap_or(0),
            // kyouka: ship.kyouka.unwrap_or(0),
            slotnum: ship.slotnum.unwrap_or(0),
            cond: ship.cond.unwrap_or(0),
            karyoku: ship.karyoku.as_ref().and_then(|x| x.first()).copied().unwrap_or(0),
            raisou: ship.raisou.as_ref().and_then(|x| x.first()).copied().unwrap_or(0),
            taiku: ship.taiku.as_ref().and_then(|x| x.first()).copied().unwrap_or(0),
            soukou: ship.soukou.as_ref().and_then(|x| x.first()).copied().unwrap_or(0),
            kaihi: ship.kaihi.as_ref().and_then(|x| x.first()).copied().unwrap_or(0),
            taisen: ship.taisen.as_ref().and_then(|x| x.first()).copied().unwrap_or(0),
            sakuteki: ship.sakuteki.as_ref().and_then(|x| x.first()).copied().unwrap_or(0),
            lucky: ship.lucky.as_ref().and_then(|x| x.first()).copied().unwrap_or(0),
            // locked: ship.locked,
            // locked_equip: ship.locked_equip,
            sally_area: ship.sally_area,
            sp_effect_items: ship.sp_effect_items.map(|items| {
                let mut sp_items: Vec<SpEffectItem> = items
                    .items
                    .into_iter()
                    .map(|(_, item)| SpEffectItem::from(item))
                    .collect();
                sp_items.sort_by_key(|item| (item.kind, item.raig, item.souk, item.houg, item.kaih));
                sp_items
            }),
        }
    }
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub struct SpEffectItem {
    #[serde(rename = "k2d")]
    pub kind: i64,
    #[serde(rename = "r2g")]
    pub raig: Option<i64>,
    #[serde(rename = "s2k")]
    pub souk: Option<i64>,
    #[serde(rename = "h2g")]
    pub houg: Option<i64>,
    #[serde(rename = "k2h")]
    pub kaih: Option<i64>,
}

impl From<InterfaceSpEffectItem> for SpEffectItem {
    fn from(item: InterfaceSpEffectItem) -> Self {
        SpEffectItem {
            kind: item.kind,
            raig: item.raig,
            souk: item.souk,
            houg: item.houg,
            kaih: item.kaih,
        }
    }
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub struct UseItem {
    #[serde(rename = "i0d")]
    pub id: i64,
    #[serde(rename = "c3t")]
    pub count: i64,
}

impl From<InterfaceUseItem> for UseItem {
    fn from(use_item: InterfaceUseItem) -> Self {
        UseItem {
            id: use_item.id,
            count: use_item.count,
        }
    }
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub struct SlotItem {
    #[serde(rename = "i0d")]
    pub id: i64,
    #[serde(rename = "s9d")]
    pub slotitem_id: i64,
    // #[serde(rename = "l4d")]
    // pub locked: i64,
    #[serde(rename = "l3l")]
    pub level: i64,
    #[serde(rename = "a1v")]
    pub alv: Option<i64>,
}

impl From<InterfaceSlotItem> for SlotItem {
    fn from(slot_item: InterfaceSlotItem) -> Self {
        SlotItem {
            id: slot_item.id,
            slotitem_id: slot_item.slotitem_id,
            // locked: slot_item.locked,
            level: slot_item.level,
            alv: slot_item.alv,
        }
    }
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub struct DeckPortSnapshot {
    #[serde(rename = "i0d")]
    pub id: i64,
    #[serde(rename = "n2e")]
    pub name: String,
    #[serde(rename = "s3s")]
    pub ships: Vec<i64>,
}

impl From<InterfaceDeckPort> for DeckPortSnapshot {
    fn from(dp: InterfaceDeckPort) -> Self {
        DeckPortSnapshot {
            id: dp.id,
            name: dp.name,
            ships: dp.ship.unwrap_or_default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fleet_snapshot_roundtrips_compact_field_names() {
        let snapshot = FleetSnapshot {
            ships: Some(vec![Ship {
                id: 42,
                ship_id: 1,
                lv: 99,
                exp: 1_000_000,
                soku: 10,
                leng: 2,
                slot: vec![101, -1],
                onslot: vec![4, 0],
                slot_ex: 0,
                slotnum: 3,
                cond: 49,
                karyoku: 75,
                raisou: 89,
                taiku: 70,
                soukou: 65,
                kaihi: 88,
                taisen: 60,
                sakuteki: 45,
                lucky: 20,
                sally_area: Some(1),
                sp_effect_items: Some(vec![SpEffectItem {
                    kind: 2,
                    raig: Some(3),
                    souk: None,
                    houg: Some(1),
                    kaih: None,
                }]),
            }]),
            use_items: Some(vec![UseItem { id: 68, count: 12 }]),
            slot_items: Some(vec![SlotItem {
                id: 101,
                slotitem_id: 9,
                level: 10,
                alv: Some(7),
            }]),
            deck_ports: Some(vec![DeckPortSnapshot {
                id: 1,
                name: "First".to_string(),
                ships: vec![42],
            }]),
            combined_flag: Some(0),
        };

        let json = serde_json::to_string(&snapshot).expect("serialize snapshot");
        assert!(json.contains("\"s3s\""));
        assert!(json.contains("\"i0d\":42"));

        let decoded: FleetSnapshot = serde_json::from_str(&json).expect("deserialize snapshot");
        assert_eq!(decoded, snapshot);
    }

    #[test]
    fn fleet_snapshot_new_sorts_entities_deterministically() {
        let make_ship = |id| InterfaceShip {
            id,
            ship_id: Some(1),
            lv: Some(1),
            exp: None,
            nowhp: None,
            maxhp: None,
            soku: None,
            leng: None,
            slot: None,
            onslot: None,
            slot_ex: None,
            fuel: None,
            bull: None,
            slotnum: None,
            cond: None,
            cond_state: None,
            karyoku: None,
            raisou: None,
            taiku: None,
            soukou: None,
            kaihi: None,
            taisen: None,
            sakuteki: None,
            lucky: None,
            sally_area: None,
            sortie_tag_id: None,
            sp_effect_items: None,
        };
        let make_use_item = |id| InterfaceUseItem {
            id,
            count: id * 10,
        };
        let make_slot_item = |id| InterfaceSlotItem {
            id,
            slotitem_id: 1,
            locked: 0,
            level: 0,
            alv: None,
        };
        let make_deck = |id| InterfaceDeckPort {
            id,
            name: format!("Deck {id}"),
            mission: vec![],
            ship: Some(vec![id]),
            chart_seiku_value: None,
            chart_tp_value: None,
        };

        let a = FleetSnapshot::new(
            vec![make_ship(20), make_ship(5)],
            vec![make_use_item(9), make_use_item(2)],
            vec![make_slot_item(300), make_slot_item(100)],
            vec![make_deck(4), make_deck(1)],
            Some(0),
        );
        let b = FleetSnapshot::new(
            vec![make_ship(5), make_ship(20)],
            vec![make_use_item(2), make_use_item(9)],
            vec![make_slot_item(100), make_slot_item(300)],
            vec![make_deck(1), make_deck(4)],
            Some(0),
        );

        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }
}