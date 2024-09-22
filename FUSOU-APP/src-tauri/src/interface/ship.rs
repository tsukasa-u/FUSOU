use std::collections::HashMap;

use crate::kcapi;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Ships {
    ships: HashMap<i64, Ship>
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Ship {
    pub id:         i64,
    pub ship_id:    i64,
    pub lv:         i64,      // レベル
    pub exp:        Vec<i64>,    
    pub nowhp:      i64,      // 現在HP
    pub maxhp:      i64,      // 最大HP
    pub soku:       i64,      // 速力
    pub leng:       i64,      // 射程
    pub slot:       Vec<i64>,    // 装備
    pub onsolot:    Vec<i64>,    // 艦載機搭載数
    pub slot_ex:    i64,      // 補強増設
    pub fuel:       i64,      // 燃料
    pub bull:       i64,      // 弾薬
    pub slotnum:    i64,      // 装備スロット数
    pub cond:       i64,      // 疲労度
    pub karyoku:    Vec<i64>,      // 火力
    pub raisou:     Vec<i64>,      // 雷装
    pub taiku:      Vec<i64>,      // 対空
    pub soukou:     Vec<i64>,      // 装甲
    pub kaihi:      Vec<i64>,      // 回避
    pub taisen:     Vec<i64>,      // 対潜
    pub sakuteki:   Vec<i64>,      // 索敵
    pub lucky:      Vec<i64>,      // 運
    pub sally_area: Option<i64>,  
}

impl From<Vec<kcapi::api_port::port::ApiShip>> for Ships {
    fn from(ships: Vec<kcapi::api_port::port::ApiShip>) -> Self {
        let mut ship_map = HashMap::<i64, Ship>::with_capacity(ships.len());
        // let mut ship_map = HashMap::new();
        for ship in ships {
            ship_map.insert(ship.api_id, ship.into());
        }
        Self {
            ships: ship_map
        }
    }
}

impl From<kcapi::api_port::port::ApiShip> for Ship {
    fn from(ship: kcapi::api_port::port::ApiShip) -> Self {
        Self {
            id:         ship.api_id,
            ship_id:    ship.api_ship_id,
            lv:         ship.api_lv,
            exp:        ship.api_exp,
            nowhp:      ship.api_nowhp,
            maxhp:      ship.api_maxhp,
            soku:       ship.api_soku,
            leng:       ship.api_leng,
            slot:       ship.api_slot,
            onsolot:    ship.api_onslot,
            slot_ex:    ship.api_slot_ex,
            fuel:       ship.api_fuel,
            bull:       ship.api_bull,
            slotnum:    ship.api_slotnum,
            cond:       ship.api_cond,
            karyoku:    ship.api_karyoku,
            raisou:     ship.api_raisou,
            taiku:      ship.api_taiku,
            soukou:     ship.api_soukou,
            kaihi:      ship.api_kaihi,
            taisen:     ship.api_taisen,
            sakuteki:   ship.api_sakuteki,
            lucky:      ship.api_lucky,
            sally_area: ship.api_sally_area,
        }
    }
}

// impl From<kcapi::api_req_sortie::battle::ApiData> for Ships {
//     fn from(ship: kcapi::api_req_sortie::battle::ApiData) -> Self {
//         Self {
//             id:         ship.api_id,
//             ship_id:    ship.api_ship_id,
//             lv:         ship.api_lv,
//             exp:        ship.api_exp,
//             nowhp:      ship.api_nowhp,
//             maxhp:      ship.api_maxhp,
//             soku:       ship.api_soku,
//             leng:       ship.api_leng,
//             slot:       ship.api_slot,
//             onsolot:    ship.api_onslot,
//             slot_ex:    ship.api_slot_ex,
//             fuel:       ship.api_fuel,
//             bull:       ship.api_bull,
//             slotnum:    ship.api_slotnum,
//             cond:       ship.api_cond,
//             karyoku:    ship.api_karyoku,
//             raisou:     ship.api_raisou,
//             taiku:      ship.api_taiku,
//             soukou:     ship.api_soukou,
//             kaihi:      ship.api_kaihi,
//             taisen:     ship.api_taisen,
//             sakuteki:   ship.api_sakuteki,
//             lucky:      ship.api_lucky,
//             sally_area: ship.api_sally_area,
//         }
//     }
// }