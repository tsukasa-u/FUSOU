use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::env_info::EnvInfoId;
use crate::table::PortTable;

use register_trait::{FieldSizeChecker, TraitForDecode, TraitForEncode};

pub type OwnSlotItemId = Uuid;
pub type EnemySlotItemId = Uuid;
pub type FriendSlotItemId = Uuid;

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
pub struct OwnSlotItem {
    pub env_uuid: EnvInfoId,
    pub uuid: OwnSlotItemId,
    pub index: i32,
    pub mst_slotitem_id: i32,
    pub level: i32,
    pub alv: Option<i32>,
}

impl OwnSlotItem {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::slot_item::SlotItem,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let new_data: OwnSlotItem = OwnSlotItem {
            env_uuid,
            uuid,
            index: index as i32,
            mst_slotitem_id: data.slotitem_id as i32,
            level: data.level as i32,
            alv: data.alv.map(|value| value as i32),
        };

        table.own_slotitem.push(new_data);

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
pub struct EnemySlotItem {
    pub env_uuid: EnvInfoId,
    pub uuid: EnemySlotItemId,
    pub index: i32,
    pub mst_slotitem_id: i32,
}

impl EnemySlotItem {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: i32,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let new_data: EnemySlotItem = EnemySlotItem {
            env_uuid,
            uuid,
            mst_slotitem_id: data,
            index: index as i32,
        };

        table.enemy_slotitem.push(new_data);

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
pub struct FriendSlotItem {
    pub env_uuid: EnvInfoId,
    pub uuid: FriendSlotItemId,
    pub index: i32,
    pub mst_slotitem_id: i32,
}

impl FriendSlotItem {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: i32,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let new_data: FriendSlotItem = FriendSlotItem {
            env_uuid,
            uuid,
            mst_slotitem_id: data,
            index: index as i32,
        };

        table.friend_slotitem.push(new_data);

        Some(())
    }
}
