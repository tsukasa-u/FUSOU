use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

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
    pub onslot: Option<Vec<i64>>,   // 艦載機搭載数
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
                        onslot: ship.onslot.clone().or(v.onslot.clone()),
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
