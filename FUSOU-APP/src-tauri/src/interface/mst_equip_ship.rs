use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};

use register_trait::TraitForEncode;

pub(crate) static KCS_MST_EQUIP_SHIP: Lazy<Mutex<MstEquipShips>> = Lazy::new(|| {
    Mutex::new(MstEquipShips {
        mst_equip_ships: HashMap::new(),
    })
});

use crate::kcapi;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MstEquipShips {
    pub mst_equip_ships: HashMap<i64, MstEquipShip>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode)]
pub struct MstEquipShip {
    pub ship_id: i64,
    pub equip_type: Vec<i64>,
}

impl MstEquipShips {
    pub fn load() -> Self {
        let equip_ship_map = KCS_MST_EQUIP_SHIP.lock().unwrap();
        equip_ship_map.clone()
    }

    pub fn restore(&self) {
        let mut equip_ship_map = KCS_MST_EQUIP_SHIP.lock().unwrap();
        *equip_ship_map = self.clone();
    }
}

impl From<Vec<kcapi::api_start2::get_data::ApiMstEquipShip>> for MstEquipShips {
    fn from(equip_ships: Vec<kcapi::api_start2::get_data::ApiMstEquipShip>) -> Self {
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

impl From<kcapi::api_start2::get_data::ApiMstEquipShip> for MstEquipShip {
    fn from(equip_ship: kcapi::api_start2::get_data::ApiMstEquipShip) -> Self {
        Self {
            ship_id: equip_ship.api_ship_id,
            equip_type: equip_ship.api_equip_type,
        }
    }
}
