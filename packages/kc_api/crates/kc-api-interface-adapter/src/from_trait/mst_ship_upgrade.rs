use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::mst_ship_upgrade::{MstShipUpgrade, MstShipUpgrades};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstShipupgrade>>
    for InterfaceWrapper<MstShipUpgrades>
{
    fn from(ship_upgrades: Vec<kcapi_main::api_start2::get_data::ApiMstShipupgrade>) -> Self {
        let mut ship_upgrade_map =
            HashMap::<i32, MstShipUpgrade>::with_capacity(ship_upgrades.len());
        for ship_upgrade in ship_upgrades {
            ship_upgrade_map.insert(
                ship_upgrade.api_id as i32,
                InterfaceWrapper::<MstShipUpgrade>::from(ship_upgrade).unwrap(),
            );
        }
        Self(MstShipUpgrades {
            mst_ship_upgrades: ship_upgrade_map,
        })
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstShipupgrade>
    for InterfaceWrapper<MstShipUpgrade>
{
    fn from(ship_upgrade: kcapi_main::api_start2::get_data::ApiMstShipupgrade) -> Self {
        Self(MstShipUpgrade {
            api_id: ship_upgrade.api_id as i32,
            api_current_ship_id: ship_upgrade.api_current_ship_id as i32,
            api_original_ship_id: ship_upgrade.api_original_ship_id as i32,
            api_upgrade_type: ship_upgrade.api_upgrade_type as i32,
            api_upgrade_level: ship_upgrade.api_upgrade_level as i32,
            api_drawing_count: ship_upgrade.api_drawing_count as i32,
            api_catapult_count: ship_upgrade.api_catapult_count as i32,
            api_report_count: ship_upgrade.api_report_count as i32,
            api_aviation_mat_count: ship_upgrade.api_aviation_mat_count as i32,
            api_arms_mat_count: ship_upgrade.api_arms_mat_count as i32,
            api_tech_count: ship_upgrade.api_tech_count as i32,
            api_sortno: ship_upgrade.api_sortno as i32,
            api_boiler_count: ship_upgrade.api_boiler_count.map(|value| value as i32),
        })
    }
}
