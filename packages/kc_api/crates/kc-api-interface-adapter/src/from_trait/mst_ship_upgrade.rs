use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

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
