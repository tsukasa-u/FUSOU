use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::kcapi_main;
// use crate::interface::deck_port::KCS_DECKS;

pub static KCS_SHIPS: Lazy<Mutex<Ships>> = Lazy::new(|| {
    Mutex::new(Ships {
        ships: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "port.ts")]
pub struct Ships {
    pub ships: HashMap<i64, Ship>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "port.ts")]
pub struct Ship {
    pub id: i64,
    pub ship_id: Option<i64>,
    pub lv: Option<i64>, // レベル
    pub exp: Option<Vec<i64>>,
    pub nowhp: Option<i64>,         // 現在HP
    pub maxhp: Option<i64>,         // 最大HP
    pub soku: Option<i64>,          // 速力
    pub leng: Option<i64>,          // 射程
    pub slot: Option<Vec<i64>>,     // 装備
    pub onsolot: Option<Vec<i64>>,  // 艦載機搭載数
    pub slot_ex: Option<i64>,       // 補強増設
    pub fuel: Option<i64>,          // 燃料
    pub bull: Option<i64>,          // 弾薬
    pub slotnum: Option<i64>,       // 装備スロット数
    pub cond: Option<i64>,          // 疲労度
    pub karyoku: Option<Vec<i64>>,  // 火力
    pub raisou: Option<Vec<i64>>,   // 雷装
    pub taiku: Option<Vec<i64>>,    // 対空
    pub soukou: Option<Vec<i64>>,   // 装甲
    pub kaihi: Option<Vec<i64>>,    // 回避
    pub taisen: Option<Vec<i64>>,   // 対潜
    pub sakuteki: Option<Vec<i64>>, // 索敵
    pub lucky: Option<Vec<i64>>,    // 運
    pub sally_area: Option<i64>,
    pub sp_effect_items: Option<SpEffectItems>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "port.ts")]
pub struct SpEffectItems {
    pub items: HashMap<i64, SpEffectItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "port.ts")]
pub struct SpEffectItem {
    pub kind: i64,
    pub raig: Option<i64>,
    pub souk: Option<i64>,
    pub houg: Option<i64>,
    pub kaih: Option<i64>,
}

impl Ships {
    pub fn load() -> Self {
        let ship_map = KCS_SHIPS.lock().unwrap();
        ship_map.clone()
    }

    pub fn restore(&self) {
        let mut ship_map = KCS_SHIPS.lock().unwrap();
        *ship_map = self.clone();
    }

    pub fn add_or(&self) {
        let mut ship_map = KCS_SHIPS.lock().unwrap();
        for (key, ship) in self.ships.iter() {
            match ship_map.ships.get(key) {
                Some(v) => {
                    let ship_or = Ship {
                        id: ship.id,
                        ship_id: ship.ship_id.or(v.ship_id),
                        lv: ship.lv.or(v.lv),
                        exp: ship.exp.clone().or(v.exp.clone()),
                        nowhp: ship.nowhp.or(v.nowhp),
                        maxhp: ship.maxhp.or(v.maxhp),
                        soku: ship.soku.or(v.soku),
                        leng: ship.leng.or(v.leng),
                        slot: ship.slot.clone().or(v.slot.clone()),
                        onsolot: ship.onsolot.clone().or(v.onsolot.clone()),
                        slot_ex: ship.slot_ex.or(v.slot_ex),
                        fuel: ship.fuel.or(v.fuel),
                        bull: ship.bull.or(v.bull),
                        slotnum: ship.slotnum.or(v.slotnum),
                        cond: ship.cond.or(v.cond),
                        karyoku: ship.karyoku.clone().or(v.karyoku.clone()),
                        raisou: ship.raisou.clone().or(v.raisou.clone()),
                        taiku: ship.taiku.clone().or(v.taiku.clone()),
                        soukou: ship.soukou.clone().or(v.soukou.clone()),
                        kaihi: ship.kaihi.clone().or(v.kaihi.clone()),
                        taisen: ship.taisen.clone().or(v.taisen.clone()),
                        sakuteki: ship.sakuteki.clone().or(v.sakuteki.clone()),
                        lucky: ship.lucky.clone().or(v.lucky.clone()),
                        sally_area: ship.sally_area.or(v.sally_area),
                        sp_effect_items: ship.sp_effect_items.clone().or(v.sp_effect_items.clone()),
                    };
                    ship_map.ships.insert(*key, ship_or);
                }
                None => {
                    ship_map.ships.insert(*key, ship.clone());
                }
            }
            // ship_map.ships.insert(*key, value.clone());
        }
    }
}

impl From<Vec<kcapi_main::api_port::port::ApiShip>> for Ships {
    fn from(ships: Vec<kcapi_main::api_port::port::ApiShip>) -> Self {
        let mut ship_map = HashMap::<i64, Ship>::with_capacity(ships.len());
        // let mut ship_map = HashMap::new();
        for ship in ships {
            ship_map.insert(ship.api_id, ship.into());
        }
        Self { ships: ship_map }
    }
}

impl From<kcapi_main::api_port::port::ApiShip> for Ship {
    fn from(ship: kcapi_main::api_port::port::ApiShip) -> Self {
        Self {
            id: ship.api_id,
            ship_id: Some(ship.api_ship_id),
            lv: Some(ship.api_lv),
            exp: Some(ship.api_exp),
            nowhp: Some(ship.api_nowhp),
            maxhp: Some(ship.api_maxhp),
            soku: Some(ship.api_soku),
            leng: Some(ship.api_leng),
            slot: Some(ship.api_slot),
            onsolot: Some(ship.api_onslot),
            slot_ex: Some(ship.api_slot_ex),
            fuel: Some(ship.api_fuel),
            bull: Some(ship.api_bull),
            slotnum: Some(ship.api_slotnum),
            cond: Some(ship.api_cond),
            karyoku: Some(ship.api_karyoku),
            raisou: Some(ship.api_raisou),
            taiku: Some(ship.api_taiku),
            soukou: Some(ship.api_soukou),
            kaihi: Some(ship.api_kaihi),
            taisen: Some(ship.api_taisen),
            sakuteki: Some(ship.api_sakuteki),
            lucky: Some(ship.api_lucky),
            sally_area: ship.api_sally_area,
            sp_effect_items: ship.api_sp_effect_items.map(|items| items.into()),
        }
    }
}

impl From<Vec<kcapi_main::api_port::port::ApiSpEffectItem>> for SpEffectItems {
    fn from(items: Vec<kcapi_main::api_port::port::ApiSpEffectItem>) -> Self {
        let mut item_map = HashMap::<i64, SpEffectItem>::with_capacity(items.len());
        for item in items {
            item_map.insert(item.api_kind, item.into());
        }
        Self { items: item_map }
    }
}

impl From<kcapi_main::api_port::port::ApiSpEffectItem> for SpEffectItem {
    fn from(item: kcapi_main::api_port::port::ApiSpEffectItem) -> Self {
        Self {
            kind: item.api_kind,
            raig: item.api_raig,
            souk: item.api_souk,
            houg: item.api_houg,
            kaih: item.api_kaih,
        }
    }
}

// impl From<kcapi_main::api_req_sortie::battle::ApiData> for Ships {
//     fn from(battle_data: kcapi_main::api_req_sortie::battle::ApiData) -> Self {
//         let mut ship_map = HashMap::<i64, Ship>::with_capacity(7);

//         let deck_id = battle_data.api_deck_id.clone();

//         let deck_ports_wrap = KCS_DECKS.lock();
//         if deck_ports_wrap.is_err() {
//             return Ships {
//                 ships: ship_map
//             };
//         }

//         let deck_ports = deck_ports_wrap.unwrap();

//         if let Some(deck) = (*deck_ports).deck_ports.get(&deck_id).clone() {
//             if let Some(ship_ids) = &deck.ship {
//                 for (idx, id) in ship_ids.iter().enumerate() {
//                     if *id > 0 {
//                         ship_map.insert(
//                             id.clone(),
//                             Ship {
//                                 id:         id.clone(),
//                                 ship_id:    None,
//                                 lv:         None,
//                                 exp:        None,
//                                 nowhp:      battle_data.api_f_nowhps[idx],
//                                 maxhp:      battle_data.api_f_maxhps[idx],
//                                 soku:       None,
//                                 leng:       None,
//                                 slot:       None,
//                                 onsolot:    None,
//                                 slot_ex:    None,
//                                 fuel:       None,
//                                 bull:       None,
//                                 slotnum:    None,
//                                 cond:       None,
//                                 karyoku:    None,
//                                 raisou:     None,
//                                 taiku:      None,
//                                 soukou:     None,
//                                 kaihi:      None,
//                                 taisen:     None,
//                                 sakuteki:   None,
//                                 lucky:      None,
//                                 sally_area: None,
//                                 sp_effect_items: None,
//                             }
//                         );
//                     }
//                 }
//             }
//         }

//         Ships {
//             ships: ship_map
//         }
//     }
// }

impl From<kcapi_main::api_req_hokyu::charge::ApiData> for Ships {
    fn from(charge_data: kcapi_main::api_req_hokyu::charge::ApiData) -> Self {
        let mut ship_map = HashMap::<i64, Ship>::with_capacity(charge_data.api_ship.clone().len());

        for ship in charge_data.api_ship {
            ship_map.insert(
                ship.api_id,
                Ship {
                    id: ship.api_id,
                    ship_id: None,
                    lv: None,
                    exp: None,
                    nowhp: None,
                    maxhp: None,
                    soku: None,
                    leng: None,
                    slot: None,
                    onsolot: Some(ship.api_onslot),
                    slot_ex: None,
                    fuel: Some(ship.api_fuel),
                    bull: Some(ship.api_bull),
                    slotnum: None,
                    cond: None,
                    karyoku: None,
                    raisou: None,
                    taiku: None,
                    soukou: None,
                    kaihi: None,
                    taisen: None,
                    sakuteki: None,
                    lucky: None,
                    sally_area: None,
                    sp_effect_items: None,
                },
            );
        }

        Ships { ships: ship_map }
    }
}
