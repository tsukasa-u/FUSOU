use crate::InterfaceWrapper;
use kc_api_dto::main as kcapi_main;
use kc_api_interface::slot_item::{SlotItem, SlotItems};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_get_member::require_info::ApiSlotItem>>
    for InterfaceWrapper<SlotItems>
{
    fn from(slot_items: Vec<kcapi_main::api_get_member::require_info::ApiSlotItem>) -> Self {
        let mut slot_item_map = HashMap::<i64, SlotItem>::with_capacity(slot_items.len());
        for slot_item in slot_items {
            slot_item_map.insert(
                slot_item.api_id,
                InterfaceWrapper::<SlotItem>::from(slot_item).unwrap(),
            );
        }
        Self(SlotItems {
            slot_items: slot_item_map,
        })
    }
}

impl From<kcapi_main::api_get_member::require_info::ApiSlotItem> for InterfaceWrapper<SlotItem> {
    fn from(slot_item: kcapi_main::api_get_member::require_info::ApiSlotItem) -> Self {
        Self(SlotItem {
            id: slot_item.api_id,
            slotitem_id: slot_item.api_slotitem_id,
            locked: slot_item.api_locked,
            level: slot_item.api_level,
            alv: slot_item.api_alv,
        })
    }
}

impl From<kcapi_main::api_get_member::slot_item::ApiData> for InterfaceWrapper<SlotItem> {
    fn from(slot_item: kcapi_main::api_get_member::slot_item::ApiData) -> Self {
        Self(SlotItem {
            id: slot_item.api_id,
            slotitem_id: slot_item.api_slotitem_id,
            locked: slot_item.api_locked,
            level: slot_item.api_level,
            alv: slot_item.api_alv,
        })
    }
}

impl From<Vec<kcapi_main::api_get_member::slot_item::ApiData>> for InterfaceWrapper<SlotItems> {
    fn from(slot_items: Vec<kcapi_main::api_get_member::slot_item::ApiData>) -> Self {
        let mut slot_item_map = HashMap::<i64, SlotItem>::with_capacity(slot_items.len());
        for slot_item in slot_items {
            slot_item_map.insert(
                slot_item.api_id,
                InterfaceWrapper::<SlotItem>::from(slot_item).unwrap(),
            );
        }
        Self(SlotItems {
            slot_items: slot_item_map,
        })
    }
}

// impl From<kcapi_main::api_req_sortie::battle::ApiData> for Ships {
//     fn from(ship: kcapi_main::api_req_sortie::battle::ApiData) -> Self {
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
