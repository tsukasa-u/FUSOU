use crate::InterfaceWrapper;
use kc_api_dto::main as kcapi_main;
use kc_api_interface::ship::{Ship, Ships, SpEffectItem, SpEffectItems};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_port::port::ApiShip>> for InterfaceWrapper<Ships> {
    fn from(ships: Vec<kcapi_main::api_port::port::ApiShip>) -> Self {
        let mut ship_map = HashMap::<i64, Ship>::with_capacity(ships.len());
        for ship in ships {
            ship_map.insert(ship.api_id, InterfaceWrapper::<Ship>::from(ship).unwrap());
        }
        Self(Ships { ships: ship_map })
    }
}

impl From<kcapi_main::api_port::port::ApiShip> for InterfaceWrapper<Ship> {
    fn from(ship: kcapi_main::api_port::port::ApiShip) -> Self {
        Self(Ship {
            id: ship.api_id,
            ship_id: Some(ship.api_ship_id),
            lv: Some(ship.api_lv),
            exp: Some(ship.api_exp),
            nowhp: Some(ship.api_nowhp),
            maxhp: Some(ship.api_maxhp),
            soku: Some(ship.api_soku),
            leng: Some(ship.api_leng),
            slot: Some(ship.api_slot),
            onslot: Some(ship.api_onslot),
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
            sp_effect_items: ship
                .api_sp_effect_items
                .map(|items| InterfaceWrapper::<SpEffectItems>::from(items).unwrap()),
        })
    }
}

impl From<Vec<kcapi_main::api_port::port::ApiSpEffectItem>> for InterfaceWrapper<SpEffectItems> {
    fn from(items: Vec<kcapi_main::api_port::port::ApiSpEffectItem>) -> Self {
        let mut item_map = HashMap::<i64, SpEffectItem>::with_capacity(items.len());
        for item in items {
            item_map.insert(
                item.api_kind,
                InterfaceWrapper::<SpEffectItem>::from(item).unwrap(),
            );
        }
        Self(SpEffectItems { items: item_map })
    }
}

impl From<kcapi_main::api_port::port::ApiSpEffectItem> for InterfaceWrapper<SpEffectItem> {
    fn from(item: kcapi_main::api_port::port::ApiSpEffectItem) -> Self {
        Self(SpEffectItem {
            kind: item.api_kind,
            raig: item.api_raig,
            souk: item.api_souk,
            houg: item.api_houg,
            kaih: item.api_kaih,
        })
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
//                                 onslot:    None,
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

impl From<kcapi_main::api_req_hokyu::charge::ApiData> for InterfaceWrapper<Ships> {
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
                    onslot: Some(ship.api_onslot),
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

        Self(Ships { ships: ship_map })
    }
}
