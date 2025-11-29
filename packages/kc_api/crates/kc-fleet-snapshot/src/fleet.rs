use kc_api_interface::ship::Ship as InterfaceShip;
use kc_api_interface::ship::SpEffectItem as InterfaceSpEffectItem;
use kc_api_interface::use_items::UseItem as InterfaceUseItem;
use kc_api_interface::slot_item::SlotItem as InterfaceSlotItem;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct FleetSnapshot{
    #[serde(rename(serialize = "s3s"))]
    pub ships: Option<Vec<Ship>>,
    #[serde(rename(serialize = "u7s"))]
    pub use_items: Option<Vec<UseItem>>,
    #[serde(rename(serialize = "s8s"))]
    pub slot_items: Option<Vec<SlotItem>>,
}

impl FleetSnapshot {
    pub fn new(ships: Vec<InterfaceShip>, use_items: Vec<InterfaceUseItem>, slot_items: Vec<InterfaceSlotItem>) -> Self {
        FleetSnapshot {
            ships: Some(ships.into_iter().map(Ship::from).collect()),
            use_items: Some(use_items.into_iter().map(UseItem::from).collect()),
            slot_items: Some(slot_items.into_iter().map(SlotItem::from).collect()),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct Ship {
    #[serde(rename(serialize = "i0d"))]
    pub id: i64,
    // #[serde(rename(serialize = "s4o"))]
    // pub sortno: i64,
    #[serde(rename(serialize = "s5d"))]
    pub ship_id: i64,
    #[serde(rename(serialize = "l0v"))]
    pub lv: i64,
    #[serde(rename(serialize = "e1p"))]
    pub exp: i64,
    #[serde(rename(serialize = "s2u"))]
    pub soku: i64,
    #[serde(rename(serialize = "l2g"))]
    pub leng: i64,
    #[serde(rename(serialize = "s2t"))]
    pub slot: Vec<i64>,
    #[serde(rename(serialize = "o4t"))]
    pub onslot: Vec<i64>,
    #[serde(rename(serialize = "s5x"))]
    pub slot_ex: i64,
    // #[serde(rename(serialize = "k4a"))]
    // pub kyouka: i64,
    #[serde(rename(serialize = "s5m"))]
    pub slotnum: i64,
    #[serde(rename(serialize = "c2d"))]
    pub cond: i64,
    #[serde(rename(serialize = "k5u"))]
    pub karyoku: i64,
    #[serde(rename(serialize = "r4u"))]
    pub raisou: i64,
    #[serde(rename(serialize = "t3u"))]
    pub taiku: i64,
    #[serde(rename(serialize = "s4u"))]
    pub soukou: i64,
    #[serde(rename(serialize = "k3i"))]
    pub kaihi: i64,
    #[serde(rename(serialize = "t4n"))]
    pub taisen: i64,
    #[serde(rename(serialize = "s6i"))]
    pub sakuteki: i64,
    #[serde(rename(serialize = "l3y"))]
    pub lucky: i64,
    // #[serde(rename(serialize = "l4d"))]
    // pub locked: i64,
    // #[serde(rename(serialize = "l10p"))]
    // pub locked_equip: i64,
    #[serde(rename(serialize = "s8a"))]
    pub sally_area: Option<i64>,
    #[serde(rename(serialize = "s13s"))]
    pub sp_effect_items: Option<Vec<SpEffectItem>>,
}

impl From<InterfaceShip> for Ship {
    fn from(ship: InterfaceShip) -> Self {
        Ship {
            id: ship.id,
            // sortno: ship.sortno,
            ship_id: ship.ship_id.unwrap_or(0),
            lv: ship.lv.unwrap_or(0),
            exp: ship.exp.as_ref().and_then(|x| x.get(0)).copied().unwrap_or(0),
            soku: ship.soku.unwrap_or(0),
            leng: ship.leng.unwrap_or(0),
            slot: ship.slot.unwrap_or_default(),
            onslot: ship.onslot.unwrap_or_default(),
            slot_ex: ship.slot_ex.unwrap_or(0),
            // kyouka: ship.kyouka.unwrap_or(0),
            slotnum: ship.slotnum.unwrap_or(0),
            cond: ship.cond.unwrap_or(0),
            karyoku: ship.karyoku.as_ref().and_then(|x| x.get(0)).copied().unwrap_or(0),
            raisou: ship.raisou.as_ref().and_then(|x| x.get(0)).copied().unwrap_or(0),
            taiku: ship.taiku.as_ref().and_then(|x| x.get(0)).copied().unwrap_or(0),
            soukou: ship.soukou.as_ref().and_then(|x| x.get(0)).copied().unwrap_or(0),
            kaihi: ship.kaihi.as_ref().and_then(|x| x.get(0)).copied().unwrap_or(0),
            taisen: ship.taisen.as_ref().and_then(|x| x.get(0)).copied().unwrap_or(0),
            sakuteki: ship.sakuteki.as_ref().and_then(|x| x.get(0)).copied().unwrap_or(0),
            lucky: ship.lucky.as_ref().and_then(|x| x.get(0)).copied().unwrap_or(0),
            // locked: ship.locked,
            // locked_equip: ship.locked_equip,
            sally_area: ship.sally_area,
            sp_effect_items: ship.sp_effect_items.map(|items| {
                items
                    .items
                    .into_iter()
                    .map(|(_, item)| SpEffectItem::from(item))
                    .collect()
            }),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct SpEffectItem {
    #[serde(rename(serialize = "k2d"))]
    pub kind: i64,
    #[serde(rename(serialize = "r2g"))]
    pub raig: Option<i64>,
    #[serde(rename(serialize = "s2k"))]
    pub souk: Option<i64>,
    #[serde(rename(serialize = "h2g"))]
    pub houg: Option<i64>,
    #[serde(rename(serialize = "k2h"))]
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

#[derive(Serialize, Deserialize)]
pub struct UseItem {
    #[serde(rename(serialize = "i0d"))]
    pub id: i64,
    #[serde(rename(serialize = "c3t"))]
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

#[derive(Serialize, Deserialize)]
pub struct SlotItem {
    #[serde(rename(serialize = "i0d"))]
    pub id: i64,
    #[serde(rename(serialize = "s9d"))]
    pub slotitem_id: i64,
    // #[serde(rename(serialize = "l4d"))]
    // pub locked: i64,
    #[serde(rename(serialize = "l3l"))]
    pub level: i64,
    #[serde(rename(serialize = "a1v"))]
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