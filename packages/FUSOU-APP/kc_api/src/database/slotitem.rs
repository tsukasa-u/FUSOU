use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::env_info::EnvInfoId;
use crate::database::table::PortTable;
use crate::database::table::DATABASE_TABLE_VERSION;

use register_trait::TraitForEncode;

pub type OwnSlotItemId = Uuid;
pub type EnemySlotItemId = Uuid;
pub type FriendSlotItemId = Uuid;

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct OwnSlotItem {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: OwnSlotItemId,
    pub mst_slotitem_id: i64,
    pub level: i64,
    pub alv: Option<i64>,
}

impl OwnSlotItem {
    pub fn new_ret_uuid(
        data: crate::interface::slot_item::SlotItem,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Uuid {
        let new_uuid: Uuid = Uuid::new_v4();

        let new_data: OwnSlotItem = OwnSlotItem {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
            mst_slotitem_id: data.slotitem_id,
            level: data.level,
            alv: data.alv,
        };

        table.own_slotitem.push(new_data);

        return new_uuid;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct EnemySlotItem {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: EnemySlotItemId,
    pub mst_slotitem_id: i64,
}

impl EnemySlotItem {
    pub fn new_ret_uuid(data: i64, table: &mut PortTable, env_uuid: EnvInfoId) -> Uuid {
        let new_uuid = Uuid::new_v4();
        let new_data: EnemySlotItem = EnemySlotItem {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
            mst_slotitem_id: data,
        };

        table.enemy_slotitem.push(new_data);

        return new_uuid;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct FriendSlotItem {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: FriendSlotItemId,
    pub mst_slotitem_id: i64,
}

impl FriendSlotItem {
    pub fn new_ret_uuid(data: i64, table: &mut PortTable, env_uuid: EnvInfoId) -> Uuid {
        let new_uuid = Uuid::new_v4();
        let new_data: FriendSlotItem = FriendSlotItem {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
            mst_slotitem_id: data,
        };

        table.friend_slotitem.push(new_data);

        return new_uuid;
    }
}
