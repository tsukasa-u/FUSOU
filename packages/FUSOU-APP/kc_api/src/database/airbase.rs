use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::env_info::EnvInfoId;
use crate::database::slotitem::OwnSlotItem;
use crate::database::slotitem::OwnSlotItemId;
use crate::database::table::PortTable;
use crate::database::table::DATABASE_TABLE_VERSION;

use crate::interface::slot_item::SlotItems;

use register_trait::TraitForEncode;

pub type AirBaseId = Uuid;
pub type PlaneInfoId = Uuid;

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct AirBase {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: AirBaseId,
    pub action_kind: i64,
    pub distance: i64,
    pub plane_info: Vec<PlaneInfoId>,
}

impl AirBase {
    pub fn new_ret_uuid(
        data: crate::interface::air_base::AirBase,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Uuid {
        let new_uuid = Uuid::new_v4();
        let new_plane_info = data
            .plane_info
            .iter()
            .filter_map(|plane_info| PlaneInfo::new_ret_uuid(plane_info.clone(), table, env_uuid))
            .collect();
        let new_air_base = AirBase {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
            action_kind: data.action_kind,
            distance: data.distance,
            plane_info: new_plane_info,
        };

        table.airbase.push(new_air_base);

        return new_uuid;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct PlaneInfo {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: PlaneInfoId,
    pub cond: Option<i64>,
    pub state: i64,
    pub max_count: Option<i64>,
    pub count: Option<i64>,
    pub slotid: OwnSlotItemId,
}

impl PlaneInfo {
    pub fn new_ret_uuid(
        data: crate::interface::air_base::PlaneInfo,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Uuid> {
        let slot_items = SlotItems::load();
        let slot_item = slot_items.slot_items.get(&data.slotid)?;

        let new_uuid: Uuid = Uuid::new_v4();
        let new_slot_item = OwnSlotItem::new_ret_uuid(slot_item.clone(), table, env_uuid);

        let new_plane_info: PlaneInfo = PlaneInfo {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            uuid: new_uuid,
            env_uuid,
            cond: data.cond,
            state: data.state,
            max_count: data.max_count,
            count: data.count,
            slotid: new_slot_item,
        };

        table.plane_info.push(new_plane_info);

        return Some(new_uuid);
    }
}
