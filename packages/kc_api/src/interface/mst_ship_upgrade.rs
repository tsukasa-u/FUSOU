use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::TraitForEncode;

pub(crate) static KCS_MST_SHIP_UPGRADE: Lazy<Mutex<MstShipUpgrades>> = Lazy::new(|| {
    Mutex::new(MstShipUpgrades {
        mst_ship_upgrades: HashMap::new(),
    })
});

use crate::kcapi_main;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstShipUpgrades {
    pub mst_ship_upgrades: HashMap<i64, MstShipUpgrade>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS)]
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

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstShipupgrade>> for MstShipUpgrades {
    fn from(ship_upgrades: Vec<kcapi_main::api_start2::get_data::ApiMstShipupgrade>) -> Self {
        let mut ship_upgrade_map =
            HashMap::<i64, MstShipUpgrade>::with_capacity(ship_upgrades.len());
        // let mut ship_map = HashMap::new();
        for ship_upgrade in ship_upgrades {
            ship_upgrade_map.insert(ship_upgrade.api_id, ship_upgrade.into());
        }
        Self {
            mst_ship_upgrades: ship_upgrade_map,
        }
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstShipupgrade> for MstShipUpgrade {
    fn from(ship_upgrade: kcapi_main::api_start2::get_data::ApiMstShipupgrade) -> Self {
        Self {
            api_id: ship_upgrade.api_id,
            api_current_ship_id: ship_upgrade.api_current_ship_id,
            api_original_ship_id: ship_upgrade.api_original_ship_id,
            api_upgrade_type: ship_upgrade.api_upgrade_type,
            api_upgrade_level: ship_upgrade.api_upgrade_level,
            api_drawing_count: ship_upgrade.api_drawing_count,
            api_catapult_count: ship_upgrade.api_catapult_count,
            api_report_count: ship_upgrade.api_report_count,
            api_aviation_mat_count: ship_upgrade.api_aviation_mat_count,
            api_arms_mat_count: ship_upgrade.api_arms_mat_count,
            api_tech_count: ship_upgrade.api_tech_count,
            api_sortno: ship_upgrade.api_sortno,
            api_boiler_count: ship_upgrade.api_boiler_count,
        }
    }
}
