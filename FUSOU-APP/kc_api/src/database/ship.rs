use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::env_info::EnvInfoId;
use crate::database::slotitem::EnemySlotItem;
use crate::database::slotitem::EnemySlotItemId;
use crate::database::slotitem::FriendSlotItem;
use crate::database::slotitem::FriendSlotItemId;
use crate::database::slotitem::OwnSlotItem;
use crate::database::slotitem::OwnSlotItemId;
use crate::database::table::PortTable;
use crate::database::table::DATABASE_TABLE_VERSION;

use crate::interface::ship::Ships;
use crate::interface::slot_item::SlotItems;

use register_trait::TraitForEncode;

pub type OwnShipId = Uuid;
pub type EnemyShipId = Uuid;
pub type FriendShipId = Uuid;

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct OwnShip {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: OwnShipId,
    pub ship_id: Option<i64>,
    pub lv: Option<i64>,                          // レベル
    pub nowhp: Option<i64>,                       // 現在HP
    pub maxhp: Option<i64>,                       // 最大HP
    pub soku: Option<i64>,                        // 速力
    pub leng: Option<i64>,                        // 射程
    pub slot: Option<Vec<Option<OwnSlotItemId>>>, // 装備
    pub onsolot: Option<Vec<i64>>,                // 艦載機搭載数
    pub slot_ex: Option<i64>,                     // 補強増設
    pub fuel: Option<i64>,                        // 燃料
    pub bull: Option<i64>,                        // 弾薬
    pub cond: Option<i64>,                        // 疲労度
    pub karyoku: Option<Vec<i64>>,                // 火力
    pub raisou: Option<Vec<i64>>,                 // 雷装
    pub taiku: Option<Vec<i64>>,                  // 対空
    pub soukou: Option<Vec<i64>>,                 // 装甲
    pub kaihi: Option<Vec<i64>>,                  // 回避
    pub taisen: Option<Vec<i64>>,                 // 対潜
    pub sakuteki: Option<Vec<i64>>,               // 索敵
    pub lucky: Option<Vec<i64>>,                  // 運
    pub sally_area: Option<i64>,
    pub sp_effect_items: Option<Vec<i64>>,
}

impl OwnShip {
    pub fn new_ret_uuid(data: i64, table: &mut PortTable, env_uuid: EnvInfoId) -> Option<Uuid> {
        let new_uuid: Uuid = Uuid::new_v4();

        let ships = Ships::load();
        let ship = ships.ships.get(&data)?;

        let slot_item = SlotItems::load();
        let new_slot = ship.slot.clone().map(|slot| {
            slot.iter()
                .map(|slot_id| {
                    let slot_item = slot_item.slot_items.get(slot_id)?;
                    return Some(OwnSlotItem::new_ret_uuid(
                        slot_item.clone(),
                        table,
                        env_uuid,
                    ));
                })
                .collect()
        });

        let new_data: OwnShip = OwnShip {
            version: DATABASE_TABLE_VERSION.to_string(),
            env_uuid,
            uuid: new_uuid,
            ship_id: ship.ship_id,
            lv: ship.lv,
            nowhp: ship.nowhp,
            maxhp: ship.maxhp,
            soku: ship.soku,
            leng: ship.leng,
            slot: new_slot,
            onsolot: ship.onsolot.clone(),
            slot_ex: ship.slot_ex,
            fuel: ship.fuel,
            bull: ship.bull,
            cond: ship.cond,
            karyoku: ship.karyoku.clone(),
            raisou: ship.raisou.clone(),
            taiku: ship.taiku.clone(),
            soukou: ship.soukou.clone(),
            kaihi: ship.kaihi.clone(),
            taisen: ship.taisen.clone(),
            sakuteki: ship.sakuteki.clone(),
            lucky: ship.lucky.clone(),
            sally_area: ship.sally_area,
            sp_effect_items: ship
                .sp_effect_items
                .clone()
                .map(|item| item.items.keys().copied().collect()),
        };
        table.own_ship.push(new_data);

        return Some(new_uuid);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct EnemyShip {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: EnemyShipId,
    pub mst_ship_id: Option<i64>,
    pub lv: Option<i64>,                    // レベル
    pub nowhp: Option<i64>,                 // 現在HP
    pub maxhp: Option<i64>,                 // 最大HP
    pub slot: Option<Vec<EnemySlotItemId>>, // 装備
    pub karyoku: Option<i64>,               // 火力
    pub raisou: Option<i64>,                // 雷装
    pub taiku: Option<i64>,                 // 対空
    pub soukou: Option<i64>,                // 装甲
}

pub type EnemyShipProps = (
    Option<i64>,      // レベル
    Option<i64>,      // 現在HP
    Option<i64>,      // 最大HP
    Option<Vec<i64>>, // 装備
    Option<Vec<i64>>, // 火力 雷装 対空 装甲
    Option<i64>,      // mst_id
);
impl EnemyShip {
    pub fn new_ret_uuid(data: EnemyShipProps, table: &mut PortTable, env_uuid: EnvInfoId) -> Uuid {
        let new_uuid: Uuid = Uuid::new_v4();

        let new_slot = data.3.clone().map(|slot| {
            slot.iter()
                .map(|slot_id| EnemySlotItem::new_ret_uuid(*slot_id, table, env_uuid))
                .collect()
        });

        let new_data: EnemyShip = EnemyShip {
            version: DATABASE_TABLE_VERSION.to_string(),
            env_uuid,
            uuid: new_uuid,
            lv: data.0,
            nowhp: data.1,
            maxhp: data.2,
            slot: new_slot,
            karyoku: data.4.clone().map(|x| x[0]),
            raisou: data.4.clone().map(|x| x[1]),
            taiku: data.4.clone().map(|x| x[2]),
            soukou: data.4.clone().map(|x| x[3]),
            mst_ship_id: data.5,
        };
        table.enemy_ship.push(new_data);

        return new_uuid;
    }
}

pub type FriendShipProps = (
    Option<i64>,      // レベル
    Option<i64>,      // 現在HP
    Option<i64>,      // 最大HP
    Option<Vec<i64>>, // 装備
    Option<i64>,      // 補強増設
    Option<Vec<i64>>, // 火力 雷装 対空 装甲
    Option<i64>,      // mst_id
);
#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct FriendShip {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: FriendShipId,
    pub mst_ship_id: Option<i64>,
    pub lv: Option<i64>,                     // レベル
    pub nowhp: Option<i64>,                  // 現在HP
    pub maxhp: Option<i64>,                  // 最大HP
    pub slot: Option<Vec<FriendSlotItemId>>, // 装備
    pub slotnum: Option<i64>,                // 装備スロット数
    pub karyoku: Option<i64>,                // 火力
    pub raisou: Option<i64>,                 // 雷装
    pub taiku: Option<i64>,                  // 対空
    pub soukou: Option<i64>,                 // 装甲
}

impl FriendShip {
    pub fn new_ret_uuid(data: FriendShipProps, table: &mut PortTable, env_uuid: EnvInfoId) -> Uuid {
        let new_uuid: Uuid = Uuid::new_v4();

        let new_slot = data.3.clone().map(|slot| {
            slot.iter()
                .map(|slot_id| FriendSlotItem::new_ret_uuid(*slot_id, table, env_uuid))
                .collect()
        });

        let new_data: FriendShip = FriendShip {
            version: DATABASE_TABLE_VERSION.to_string(),
            env_uuid,
            uuid: new_uuid,
            lv: data.0,
            nowhp: data.1,
            maxhp: data.2,
            slot: new_slot,
            slotnum: data.4,
            karyoku: data.5.clone().map(|x| x[0]),
            raisou: data.5.clone().map(|x| x[1]),
            taiku: data.5.clone().map(|x| x[2]),
            soukou: data.5.clone().map(|x| x[3]),
            mst_ship_id: data.6,
        };
        table.friend_ship.push(new_data);

        return new_uuid;
    }
}
