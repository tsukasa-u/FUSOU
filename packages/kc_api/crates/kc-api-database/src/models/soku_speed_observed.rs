use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};

use kc_api_interface::soku_speed_observed as interface;

use register_trait::{FieldSizeChecker, TraitForDecode, TraitForEncode};

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
pub struct SokuSpeedObservedSnapshot {
    pub entries: Vec<SokuSpeedObservedEntry>,
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
pub struct SokuSpeedObservedSlot {
    pub slotitem_id: i64,
    pub locked: bool,
    pub level: i64,
    pub alv: i64,
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
pub struct SokuSpeedObservedEntry {
    pub master_id: i64,
    pub lv: i64,
    pub soku_observed: i64,
    pub slots: Vec<SokuSpeedObservedSlot>,
    pub exslot: Option<SokuSpeedObservedSlot>,
}

impl From<interface::SlotComposition> for SokuSpeedObservedSlot {
    fn from(value: interface::SlotComposition) -> Self {
        Self {
            slotitem_id: value.slotitem_id,
            locked: value.locked,
            level: value.level,
            alv: value.alv,
        }
    }
}

impl From<interface::SokuSpeedObservedEntry> for SokuSpeedObservedEntry {
    fn from(value: interface::SokuSpeedObservedEntry) -> Self {
        Self {
            master_id: value.master_id,
            lv: value.lv,
            soku_observed: value.soku_observed,
            slots: value
                .slots
                .into_iter()
                .map(SokuSpeedObservedSlot::from)
                .collect(),
            exslot: value.exslot.map(SokuSpeedObservedSlot::from),
        }
    }
}

impl From<interface::SokuSpeedObservedSnapshot> for SokuSpeedObservedSnapshot {
    fn from(value: interface::SokuSpeedObservedSnapshot) -> Self {
        Self {
            entries: value
                .entries
                .into_iter()
                .map(SokuSpeedObservedEntry::from)
                .collect(),
        }
    }
}
