use serde::{Deserialize, Serialize};

/// Snapshot of observed ship speed (soku) for current slot compositions.
/// Range (leng) is intentionally not collected because it is derivable from
/// static equipment effect data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SokuSpeedObservedSnapshot {
    pub entries: Vec<SokuSpeedObservedEntry>,
}

/// One observation from live gameplay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SokuSpeedObservedEntry {
    pub master_id: i64,
    pub lv: i64,
    pub soku_observed: i64,
    pub slots: Vec<SlotComposition>,
    pub exslot: Option<SlotComposition>,
}

/// Equipment composition for one slot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotComposition {
    pub slotitem_id: i64,
    pub locked: bool,
    pub level: i64,
    pub alv: i64,
}
