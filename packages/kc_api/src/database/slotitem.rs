use parquet_derive::ParquetRecordWriter;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::env_info::EnvInfoId;
use crate::database::table::PortTable;

use register_trait::{TraitForDecode, TraitForEncode};

pub type OwnSlotItemId = Uuid;
pub type EnemySlotItemId = Uuid;
pub type FriendSlotItemId = Uuid;

#[derive(
    Debug, Clone, Deserialize, Serialize, ParquetRecordWriter, TraitForEncode, TraitForDecode,
)]
pub struct OwnSlotItem {
    /// UUID of EnvInfo.
    pub env_uuid: Vec<u8>,
    /// UUID of OwnSlotItem.
    pub uuid: Vec<u8>,
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
            env_uuid: env_uuid.as_bytes().to_vec(),
            uuid: new_uuid.as_bytes().to_vec(),
            mst_slotitem_id: data.slotitem_id,
            level: data.level,
            alv: data.alv,
        };

        table.own_slotitem.push(new_data);

        return new_uuid;
    }
}

#[derive(
    Debug, Clone, Deserialize, Serialize, ParquetRecordWriter, TraitForEncode, TraitForDecode,
)]
pub struct EnemySlotItem {
    /// UUID of EnvInfo.
    pub env_uuid: Vec<u8>,
    /// UUID of EnemySlotItem.
    pub uuid: Vec<u8>,
    pub mst_slotitem_id: i64,
}

impl EnemySlotItem {
    pub fn new_ret_uuid(data: i64, table: &mut PortTable, env_uuid: EnvInfoId) -> Uuid {
        let new_uuid = Uuid::new_v4();
        let new_data: EnemySlotItem = EnemySlotItem {
            env_uuid: env_uuid.as_bytes().to_vec(),
            uuid: new_uuid.as_bytes().to_vec(),
            mst_slotitem_id: data,
        };

        table.enemy_slotitem.push(new_data);

        return new_uuid;
    }
}

#[derive(
    Debug, Clone, Deserialize, Serialize, ParquetRecordWriter, TraitForEncode, TraitForDecode,
)]
pub struct FriendSlotItem {
    /// UUID of EnvInfo.
    pub env_uuid: Vec<u8>,
    /// UUID of FriendSlotItem.
    pub uuid: Vec<u8>,
    pub mst_slotitem_id: i64,
}

impl FriendSlotItem {
    pub fn new_ret_uuid(data: i64, table: &mut PortTable, env_uuid: EnvInfoId) -> Uuid {
        let new_uuid = Uuid::new_v4();
        let new_data: FriendSlotItem = FriendSlotItem {
            env_uuid: env_uuid.as_bytes().to_vec(),
            uuid: new_uuid.as_bytes().to_vec(),
            mst_slotitem_id: data,
        };

        table.friend_slotitem.push(new_data);

        return new_uuid;
    }
}
