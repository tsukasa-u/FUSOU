use parquet_derive::ParquetRecordWriter;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::env_info::EnvInfoId;
use crate::database::slotitem::OwnSlotItem;
use crate::database::slotitem::OwnSlotItemId;
use crate::database::table::PortTable;

use crate::interface::slot_item::SlotItems;

use register_trait::{TraitForDecode, TraitForEncode};

pub type AirBaseId = Vec<u8>;
pub type PlaneInfoId = Vec<u8>;

#[derive(
    Debug, Clone, Deserialize, Serialize, ParquetRecordWriter, TraitForEncode, TraitForDecode,
)]
pub struct AirBase {
    /// UUID of EnvInfo.
    pub env_uuid: Vec<u8>,
    /// UUID of AirBase.
    pub uuid: Vec<u8>,
    pub action_kind: i64,
    pub distance: i64,
    /// UUID of PlaneInfo. This UUID may be referenced multiple times.
    pub plane_info_uuid: Vec<u8>,
    pub idx: u64,
}

impl AirBase {
    pub fn new_ret_uuid(
        data: crate::interface::air_base::AirBase,
        idx: u64,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Uuid {
        let new_uuid = Uuid::new_v4().to_vec();
        let new_plane_info: Vec<u8> = data
            .plane_info
            .iter()
            .enumerate()
            .filter_map(|(idx, plane_info)| {
                PlaneInfo::new_ret_uuid(plane_info.clone(), idx, table, env_uuid)
            })
            .collect();
        let new_air_base = AirBase {
            env_uuid: env_uuid.as_bytes().to_vec(),
            uuid: new_uuid.as_bytes().to_vec(),
            action_kind: data.action_kind,
            distance: data.distance,
            plane_info_uuid: new_plane_info,
            idx,
        };

        table.airbase.push(new_air_base);

        return new_uuid;
    }
}

#[derive(
    Debug, Clone, Deserialize, Serialize, ParquetRecordWriter, TraitForEncode, TraitForDecode,
)]
pub struct PlaneInfo {
    /// UUID of EnvInfo.
    pub env_uuid: Vec<u8>,
    /// UUID of PlaneInfo.
    pub uuid: Vec<u8>,
    pub cond: Option<i64>,
    pub state: i64,
    pub max_count: Option<i64>,
    pub count: Option<i64>,
    /// UUID of OwnSlotItem.
    pub slotid: Vec<u8>,
    /// Index of PlaneInfo.
    pub idx: u64,
}

impl PlaneInfo {
    pub fn new_ret_uuid(
        data: crate::interface::air_base::PlaneInfo,
        idx: u64,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Uuid> {
        let slot_items = SlotItems::load();
        let slot_item = slot_items.slot_items.get(&data.slotid)?;

        let new_uuid: Uuid = Uuid::new_v4();
        let new_slot_item: Uuid = OwnSlotItem::new_ret_uuid(slot_item.clone(), table, env_uuid);

        let new_plane_info: PlaneInfo = PlaneInfo {
            uuid: new_uuid.as_bytes().to_vec(),
            env_uuid: env_uuid.as_bytes().to_vec(),
            cond: data.cond,
            state: data.state,
            max_count: data.max_count,
            count: data.count,
            slotid: new_slot_item.as_bytes().to_vec(),
            idx,
        };

        table.plane_info.push(new_plane_info);

        return Some(new_uuid);
    }
}
