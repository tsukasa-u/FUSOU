use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::env_info::EnvInfoId;
use crate::database::slotitem::OwnSlotItem;
use crate::database::slotitem::OwnSlotItemId;
use crate::database::table::PortTable;

use crate::interface::slot_item::SlotItems;

use register_trait::{FieldSizeChecker, TraitForDecode, TraitForEncode};

pub type AirBaseId = Uuid;
pub type PlaneInfoId = Uuid;

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
pub struct AirBase {
    pub env_uuid: EnvInfoId,
    pub uuid: AirBaseId,
    pub action_kind: i64,
    pub distance: i64,
    pub plane_info: Option<PlaneInfoId>,
}

impl AirBase {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::air_base::AirBase,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_plane_info = Uuid::new_v7(ts);
        let result = data
            .plane_info
            .iter()
            .enumerate()
            .map(|(plane_info_index, plane_info)| {
                PlaneInfo::new(
                    ts,
                    new_plane_info,
                    plane_info.clone(),
                    table,
                    env_uuid,
                    plane_info_index,
                )
            })
            .collect::<Vec<_>>();
        let new_plane_info_wrap = match result.iter().all(|x| x.is_some()) {
            true => Some(new_plane_info),
            false => None,
        };

        let new_air_base = AirBase {
            env_uuid,
            uuid,
            action_kind: data.action_kind,
            distance: data.distance,
            plane_info: new_plane_info_wrap,
        };

        table.airbase.push(new_air_base);

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
pub struct PlaneInfo {
    pub env_uuid: EnvInfoId,
    pub uuid: PlaneInfoId,
    pub index: i64,
    pub cond: Option<i64>,
    pub state: i64,
    pub max_count: Option<i64>,
    pub count: Option<i64>,
    pub slotid: Option<OwnSlotItemId>,
}

impl PlaneInfo {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::air_base::PlaneInfo,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let slot_items = SlotItems::load();
        let slot_item = match slot_items.slot_items.get(&data.slotid) {
            Some(item) => item,
            None => {
                tracing::warn!("PlaneInfo::new: slot_item not found for id {}", data.slotid);
                return None;
            }
        };

        let new_slot_item = Uuid::new_v7(ts);
        let result = OwnSlotItem::new(ts, new_slot_item, slot_item.clone(), table, env_uuid, 0);
        let new_slot_item_wrap = match result {
            Some(()) => Some(new_slot_item),
            None => None,
        };

        let new_plane_info: PlaneInfo = PlaneInfo {
            uuid,
            index: index as i64,
            env_uuid,
            cond: data.cond,
            state: data.state,
            max_count: data.max_count,
            count: data.count,
            slotid: new_slot_item_wrap,
        };

        table.plane_info.push(new_plane_info);

        Some(())
    }
}
