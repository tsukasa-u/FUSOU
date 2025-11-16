use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::env_info::EnvInfoId;
use crate::models::slotitem::OwnSlotItem;
use crate::models::slotitem::OwnSlotItemId;
use crate::table::PortTable;

use kc_api_interface::slot_item::SlotItems;

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
    pub action_kind: i32,
    pub distance: i32,
    pub plane_info: Option<PlaneInfoId>,
}

impl AirBase {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::air_base::AirBase,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_plane_info = Uuid::new_v7(ts);
        let result = data
            .plane_info
            .iter()
            .enumerate()
            .map(|(plane_info_index, plane_info)| {
                PlaneInfo::new_ret_option(
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
            action_kind: data.action_kind as i32,
            distance: data.distance as i32,
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
    pub index: i32,
    pub cond: Option<i32>,
    pub state: i32,
    pub max_count: Option<i32>,
    pub count: Option<i32>,
    pub slotid: Option<OwnSlotItemId>,
}

impl PlaneInfo {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::air_base::PlaneInfo,
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
        let new_slot_item_wrap =
            OwnSlotItem::new_ret_option(ts, new_slot_item, slot_item.clone(), table, env_uuid, 0)
                .map(|()| new_slot_item);

        let new_plane_info: PlaneInfo = PlaneInfo {
            uuid,
            index: index as i32,
            env_uuid,
            cond: data.cond.map(|value| value as i32),
            state: data.state as i32,
            max_count: data.max_count.map(|value| value as i32),
            count: data.count.map(|value| value as i32),
            slotid: new_slot_item_wrap,
        };

        table.plane_info.push(new_plane_info);

        Some(())
    }
}
