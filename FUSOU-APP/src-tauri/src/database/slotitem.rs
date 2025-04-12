use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::table::Table;

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct OwnSlotItem {
    pub uuid: Uuid,
    pub mst_slotitem_id: i64,
    pub level: i64,
    pub alv: Option<i64>,
}

impl OwnSlotItem {
    pub fn new_ret_uuid(data: crate::interface::slot_item::SlotItem, table: &mut Table) -> Uuid {
        let new_uuid: Uuid = Uuid::new_v4();

        let new_data: OwnSlotItem = OwnSlotItem {
            uuid: new_uuid,
            mst_slotitem_id: data.slotitem_id,
            level: data.level,
            alv: data.alv,
        };

        table.own_slotitem.push(new_data);

        return new_uuid;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct EnemySlotItem {
    pub uuid: Uuid,
    pub mst_slotitem_id: i64,
}

impl EnemySlotItem {
    pub fn new_ret_uuid(data: i64, table: &mut Table) -> Uuid {
        let new_uuid = Uuid::new_v4();
        let new_data: EnemySlotItem = EnemySlotItem {
            uuid: new_uuid,
            mst_slotitem_id: data,
        };

        table.enemy_slotitem.push(new_data);

        return new_uuid;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct FriendSlotItem {
    pub id: Uuid,
    pub mst_slotitem_id: i64,
}

impl FriendSlotItem {
    pub fn new_ret_uuid(data: i64, table: &mut Table) -> Uuid {
        let new_uuid = Uuid::new_v4();
        let new_data: FriendSlotItem = FriendSlotItem {
            id: new_uuid,
            mst_slotitem_id: data,
        };

        table.friend_slotitem.push(new_data);

        return new_uuid;
    }
}
