use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};

use kc_api_interface::ship_growth as interface;

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
pub struct ShipGrowthSnapshot {
    pub entries: Vec<ShipGrowthEntry>,
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
pub struct ShipGrowthSlot {
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
pub struct ShipGrowthEntry {
    pub master_id: i64,
    pub lv: i64,
    pub exp_current: i64,
    pub exp_to_next: Option<i64>,
    pub kyouka: Vec<i64>,
    pub sp_effect_items_json: Option<String>,
    pub kaihi_observed: i64,
    pub taisen_observed: i64,
    pub sakuteki_observed: i64,
    pub kaihi_naked: i64,
    pub taisen_naked: i64,
    pub sakuteki_naked: i64,
    pub kaihi_max: i64,
    pub taisen_max: i64,
    pub sakuteki_max: i64,
    pub slots: Vec<ShipGrowthSlot>,
    pub exslot: Option<ShipGrowthSlot>,
}

impl From<interface::SlotComposition> for ShipGrowthSlot {
    fn from(value: interface::SlotComposition) -> Self {
        Self {
            slotitem_id: value.slotitem_id,
            locked: value.locked,
            level: value.level,
            alv: value.alv,
        }
    }
}

impl From<interface::ShipGrowthEntry> for ShipGrowthEntry {
    fn from(value: interface::ShipGrowthEntry) -> Self {
        Self {
            master_id: value.master_id,
            lv: value.lv,
            exp_current: value.exp_current,
            exp_to_next: value.exp_to_next,
            kyouka: value.kyouka,
            sp_effect_items_json: value.sp_effect_items_json,
            kaihi_observed: value.kaihi_observed,
            taisen_observed: value.taisen_observed,
            sakuteki_observed: value.sakuteki_observed,
            kaihi_naked: value.kaihi_naked,
            taisen_naked: value.taisen_naked,
            sakuteki_naked: value.sakuteki_naked,
            kaihi_max: value.kaihi_max,
            taisen_max: value.taisen_max,
            sakuteki_max: value.sakuteki_max,
            slots: value.slots.into_iter().map(ShipGrowthSlot::from).collect(),
            exslot: value.exslot.map(ShipGrowthSlot::from),
        }
    }
}

impl From<interface::ShipGrowthSnapshot> for ShipGrowthSnapshot {
    fn from(value: interface::ShipGrowthSnapshot) -> Self {
        Self {
            entries: value
                .entries
                .into_iter()
                .map(ShipGrowthEntry::from)
                .collect(),
        }
    }
}
