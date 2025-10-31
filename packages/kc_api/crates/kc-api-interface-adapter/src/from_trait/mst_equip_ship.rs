use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

#[cfg(not(feature = "20250627"))]
impl From<Vec<kcapi_main::api_start2::get_data::ApiMstEquipShip>> for MstEquipShips {
    fn from(equip_ships: Vec<kcapi_main::api_start2::get_data::ApiMstEquipShip>) -> Self {
        let mut equip_ship_map = HashMap::<i64, MstEquipShip>::with_capacity(equip_ships.len());
        // let mut ship_map = HashMap::new();
        for equip_ship in equip_ships {
            equip_ship_map.insert(equip_ship.api_ship_id, equip_ship.into());
        }
        Self {
            mst_equip_ships: equip_ship_map,
        }
    }
}

#[cfg(feature = "20250627")]
impl From<HashMap<i64, kcapi_main::api_start2::get_data::ApiMstEquipShip>> for MstEquipShips {
    fn from(equip_ships: HashMap<i64, kcapi_main::api_start2::get_data::ApiMstEquipShip>) -> Self {
        let mut equip_ship_map = HashMap::<i64, MstEquipShip>::with_capacity(equip_ships.len());
        // let mut ship_map = HashMap::new();
        for (ship_id, equip_ship) in equip_ships {
            equip_ship_map.insert(ship_id, equip_ship.into());
        }
        Self {
            mst_equip_ships: equip_ship_map,
        }
    }
}

#[cfg(not(feature = "20250627"))]
impl From<kcapi_main::api_start2::get_data::ApiMstEquipShip> for MstEquipShip {
    fn from(equip_ship: kcapi_main::api_start2::get_data::ApiMstEquipShip) -> Self {
        Self {
            ship_id: equip_ship.api_ship_id,
            equip_type: equip_ship.api_equip_type,
        }
    }
}

#[cfg(feature = "20250627")]
impl From<kcapi_main::api_start2::get_data::ApiMstEquipShip> for MstEquipShip {
    fn from(equip_ship: kcapi_main::api_start2::get_data::ApiMstEquipShip) -> Self {
        Self {
            equip_type: equip_ship
                .api_equip_type
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect::<HashMap<String, Option<Vec<i64>>>>(),
        }
    }
}
