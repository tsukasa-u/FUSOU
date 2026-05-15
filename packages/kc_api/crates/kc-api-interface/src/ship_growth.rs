use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShipGrowthSnapshot {
    pub entries: Vec<ShipGrowthEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotComposition {
    pub slotitem_id: i64,
    pub locked: bool,
    pub level: i64, // ★0–★10 改修値 (0 = no improvement)
    pub alv: i64,   // 熟練度 (0–7)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub lucky_observed: i64,
    pub kaihi_naked: i64,
    pub taisen_naked: i64,
    pub sakuteki_naked: i64,
    pub lucky_naked: i64,
    pub kaihi_max: i64,
    pub taisen_max: i64,
    pub sakuteki_max: i64,
    // Slot composition for synergy calculation
    pub slots: Vec<SlotComposition>,
    pub exslot: Option<SlotComposition>,
}
