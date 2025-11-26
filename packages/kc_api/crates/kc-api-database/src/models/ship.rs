use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::env_info::EnvInfoId;
use crate::models::slotitem::EnemySlotItem;
use crate::models::slotitem::EnemySlotItemId;
use crate::models::slotitem::FriendSlotItem;
use crate::models::slotitem::FriendSlotItemId;
use crate::models::slotitem::OwnSlotItem;
use crate::models::slotitem::OwnSlotItemId;
use crate::table::PortTable;

use kc_api_interface::ship::Ships;
use kc_api_interface::slot_item::SlotItems;

use register_trait::{FieldSizeChecker, TraitForDecode, TraitForEncode};

pub type OwnShipId = Uuid;
pub type EnemyShipId = Uuid;
pub type FriendShipId = Uuid;

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct OwnShip {
    pub env_uuid: EnvInfoId,
    pub uuid: OwnShipId,
    pub index: i32,
    pub ship_id: Option<i32>,
    pub lv: Option<i32>,                // レベル
    pub nowhp: Option<i32>,             // 現在HP
    pub maxhp: Option<i32>,             // 最大HP
    pub soku: Option<i32>,              // 速力
    pub leng: Option<i32>,              // 射程
    pub slot: Option<OwnSlotItemId>,    // 装備
    pub onsolot: Option<Vec<i32>>,      // 艦載機搭載数
    pub slot_ex: Option<OwnSlotItemId>, // 補強増設
    pub fuel: Option<i32>,              // 燃料
    pub bull: Option<i32>,              // 弾薬
    pub cond: Option<i32>,              // 疲労度
    pub karyoku: Option<Vec<i32>>,      // 火力
    pub raisou: Option<Vec<i32>>,       // 雷装
    pub taiku: Option<Vec<i32>>,        // 対空
    pub soukou: Option<Vec<i32>>,       // 装甲
    pub kaihi: Option<Vec<i32>>,        // 回避
    pub taisen: Option<Vec<i32>>,       // 対潜
    pub sakuteki: Option<Vec<i32>>,     // 索敵
    pub lucky: Option<Vec<i32>>,        // 運
    pub sally_area: Option<i32>,
    pub sp_effect_items: Option<Vec<i32>>,
}

impl OwnShip {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: i64,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let ships = Ships::load();
        let ship = match ships.ships.get(&data) {
            Some(ship) => ship,
            None => {
                if data == -1 {
                    tracing::debug!("OwnShip::new: empty slot for id {}", data);
                } else {
                    tracing::warn!("OwnShip::new: ship not found for id {}", data);
                }
                return None;
            }
        };

        let slot_item = SlotItems::load();
        let new_slot = Uuid::new_v7(ts);
        let new_slot_result = ship.slot.clone().map(|slot| {
            slot.iter()
                .enumerate()
                .map(|(slot_index, slot_id)| {
                    let slot_item = match slot_item.slot_items.get(slot_id) {
                        Some(item) => item,
                        None => {
                            if *slot_id <= 0 {
                                tracing::debug!("OwnShip::new: empty slot_item for id {}", slot_id);
                            } else {
                                tracing::warn!("OwnShip::new: slot_item not found for id {}", slot_id);
                            }
                            return None;
                        }
                    };
                    OwnSlotItem::new_ret_option(
                        ts,
                        new_slot,
                        slot_item.clone(),
                        table,
                        env_uuid,
                        slot_index,
                    )
                })
                .collect::<Vec<_>>()
        });
        let new_slot_wrap = match new_slot_result {
            Some(v) if v.iter().any(|x| x.is_some()) => Some(new_slot),
            _ => None,
        };

        let new_ex_slot = Uuid::new_v7(ts);
        let new_ex_slot_result = ship.slot_ex.map(|slot_ex_id| {
            let slot_item = match slot_item.slot_items.get(&slot_ex_id) {
                Some(item) => item,
                None => {
                    if slot_ex_id <= 0 {
                        tracing::debug!("OwnShip::new: empty slot_item for ex id {}", slot_ex_id);
                    } else {
                        tracing::warn!("OwnShip::new: slot_item not found for ex id {}", slot_ex_id);
                    }
                    return None;
                }
            };
            OwnSlotItem::new_ret_option(ts, new_ex_slot, slot_item.clone(), table, env_uuid, 0)
        });
        let new_ex_slot_wrap = match new_ex_slot_result {
            Some(v) if v.is_some() => Some(new_ex_slot),
            _ => None,
        };

        let new_data: OwnShip = OwnShip {
            env_uuid,
            uuid,
            index: index as i32,
            ship_id: ship.ship_id.map(|value| value as i32),
            lv: ship.lv.map(|value| value as i32),
            nowhp: ship.nowhp.map(|value| value as i32),
            maxhp: ship.maxhp.map(|value| value as i32),
            soku: ship.soku.map(|value| value as i32),
            leng: ship.leng.map(|value| value as i32),
            slot: new_slot_wrap,
            onsolot: ship
                .onslot
                .clone()
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            slot_ex: new_ex_slot_wrap,
            fuel: ship.fuel.map(|value| value as i32),
            bull: ship.bull.map(|value| value as i32),
            cond: ship.cond.map(|value| value as i32),
            karyoku: ship
                .karyoku
                .clone()
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            raisou: ship
                .raisou
                .clone()
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            taiku: ship
                .taiku
                .clone()
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            soukou: ship
                .soukou
                .clone()
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            kaihi: ship
                .kaihi
                .clone()
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            taisen: ship
                .taisen
                .clone()
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            sakuteki: ship
                .sakuteki
                .clone()
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            lucky: ship
                .lucky
                .clone()
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            sally_area: ship.sally_area.map(|value| value as i32),
            sp_effect_items: ship
                .sp_effect_items
                .clone()
                .map(|item| item.items.keys().map(|&key| key as i32).collect()),
        };
        table.own_ship.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct EnemyShip {
    pub env_uuid: EnvInfoId,
    pub uuid: EnemyShipId,
    pub index: i32,
    pub mst_ship_id: i32,
    pub lv: Option<i32>,               // レベル
    pub nowhp: Option<i32>,            // 現在HP
    pub maxhp: Option<i32>,            // 最大HP
    pub slot: Option<EnemySlotItemId>, // 装備
    pub karyoku: Option<i32>,          // 火力
    pub raisou: Option<i32>,           // 雷装
    pub taiku: Option<i32>,            // 対空
    pub soukou: Option<i32>,           // 装甲
}

pub type EnemyShipProps = (
    Option<i32>,      // レベル
    Option<i32>,      // 現在HP
    Option<i32>,      // 最大HP
    Option<Vec<i32>>, // 装備
    Option<Vec<i32>>, // 火力 雷装 対空 装甲
    i32,              // mst_id
);
impl EnemyShip {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: EnemyShipProps,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let (lv, nowhp, maxhp, slot_values, param_values, mst_ship_id) = data;

        let new_slot: Uuid = Uuid::new_v7(ts);
        let result = slot_values.clone().map(|slot| {
            slot.iter()
                .enumerate()
                .map(|(slot_id_index, slot_id)| {
                    EnemySlotItem::new_ret_option(
                        ts,
                        new_slot,
                        *slot_id,
                        table,
                        env_uuid,
                        slot_id_index,
                    )
                })
                .collect::<Vec<_>>()
        });
        let new_slot_wrap = match result {
            Some(v) if v.iter().any(|x| x.is_some()) => Some(new_slot),
            _ => None,
        };

        let new_data: EnemyShip = EnemyShip {
            env_uuid,
            uuid,
            index: index as i32,
            lv,
            nowhp,
            maxhp,
            slot: new_slot_wrap,
            karyoku: param_values.clone().map(|x| x[0]),
            raisou: param_values.clone().map(|x| x[1]),
            taiku: param_values.clone().map(|x| x[2]),
            soukou: param_values.clone().map(|x| x[3]),
            mst_ship_id,
        };
        table.enemy_ship.push(new_data);

        Some(())
    }
}

pub type FriendShipProps = (
    Option<i32>,      // レベル
    Option<i32>,      // 現在HP
    Option<i32>,      // 最大HP
    Option<Vec<i32>>, // 装備
    Option<i32>,      // 補強増設
    Option<Vec<i32>>, // 火力 雷装 対空 装甲
    i32,              // mst_id
);
#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct FriendShip {
    pub env_uuid: EnvInfoId,
    pub uuid: FriendShipId,
    pub index: i32,
    pub mst_ship_id: i32,
    pub lv: Option<i32>,                // レベル
    pub nowhp: Option<i32>,             // 現在HP
    pub maxhp: Option<i32>,             // 最大HP
    pub slot: Option<FriendSlotItemId>, // 装備
    pub slotnum: Option<i32>,           // 装備スロット数
    pub karyoku: Option<i32>,           // 火力
    pub raisou: Option<i32>,            // 雷装
    pub taiku: Option<i32>,             // 対空
    pub soukou: Option<i32>,            // 装甲
}

impl FriendShip {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: FriendShipProps,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let new_slot = Uuid::new_v7(ts);
        let (lv, nowhp, maxhp, slot_values, slotnum, param_values, mst_ship_id) = data;

        let result = slot_values.clone().map(|slot| {
            slot.iter()
                .enumerate()
                .map(|(slot_id_index, slot_id)| {
                    FriendSlotItem::new_ret_option(
                        ts,
                        new_slot,
                        *slot_id,
                        table,
                        env_uuid,
                        slot_id_index,
                    )
                })
                .collect::<Vec<_>>()
        });
        let new_slot_wrap = match result {
            Some(v) if v.iter().any(|x| x.is_some()) => Some(new_slot),
            _ => None,
        };

        let new_data: FriendShip = FriendShip {
            env_uuid,
            uuid,
            index: index as i32,
            lv,
            nowhp,
            maxhp,
            slot: new_slot_wrap,
            slotnum,
            karyoku: param_values.clone().map(|x| x[0]),
            raisou: param_values.clone().map(|x| x[1]),
            taiku: param_values.clone().map(|x| x[2]),
            soukou: param_values.clone().map(|x| x[3]),
            mst_ship_id,
        };
        table.friend_ship.push(new_data);

        Some(())
    }
}
