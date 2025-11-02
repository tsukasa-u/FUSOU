use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_SHIP_UPGRADE: Lazy<Mutex<MstShipUpgrades>> = Lazy::new(|| {
    Mutex::new(MstShipUpgrades {
        mst_ship_upgrades: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstShipUpgrades {
    pub mst_ship_upgrades: HashMap<i64, MstShipUpgrade>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstShipUpgrade {
    pub api_id: i64,
    pub api_current_ship_id: i64,
    pub api_original_ship_id: i64,
    pub api_upgrade_type: i64,
    pub api_upgrade_level: i64,
    pub api_drawing_count: i64,
    pub api_catapult_count: i64,
    pub api_report_count: i64,
    pub api_aviation_mat_count: i64,
    pub api_arms_mat_count: i64,
    pub api_tech_count: i64,
    pub api_sortno: i64,
    pub api_boiler_count: Option<i64>,
}

impl MstShipUpgrades {
    pub fn load() -> Self {
        let ship_upgrade_map = KCS_MST_SHIP_UPGRADE.lock().unwrap();
        ship_upgrade_map.clone()
    }

    pub fn restore(&self) {
        let mut ship_upgrade_map = KCS_MST_SHIP_UPGRADE.lock().unwrap();
        *ship_upgrade_map = self.clone();
    }
}
