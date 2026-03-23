use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_EQUIP_SHIP: Lazy<Mutex<MstEquipShips>> = Lazy::new(|| {
    Mutex::new(MstEquipShips {
        mst_equip_ships: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipShips {
    pub mst_equip_ships: HashMap<i32, MstEquipShip>,
}

#[cfg(not(feature = "20250627"))]
#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipShip {
    pub ship_id: i32,
    pub equip_type: Vec<i32>,
}

#[cfg(feature = "20250627")]
#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipShip {
    pub equip_type: HashMap<String, Option<Vec<i32>>>,
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
