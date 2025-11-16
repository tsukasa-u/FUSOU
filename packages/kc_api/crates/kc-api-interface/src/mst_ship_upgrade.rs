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
    pub mst_ship_upgrades: HashMap<i32, MstShipUpgrade>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstShipUpgrade {
    pub api_id: i32,
    pub api_current_ship_id: i32,
    pub api_original_ship_id: i32,
    pub api_upgrade_type: i32,
    pub api_upgrade_level: i32,
    pub api_drawing_count: i32,
    pub api_catapult_count: i32,
    pub api_report_count: i32,
    pub api_aviation_mat_count: i32,
    pub api_arms_mat_count: i32,
    pub api_tech_count: i32,
    pub api_sortno: i32,
    pub api_boiler_count: Option<i32>,
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
