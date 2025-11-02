use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_EQUIP_EXSLOT_SHIP: Lazy<Mutex<MstEquipExslotShips>> = Lazy::new(|| {
    Mutex::new(MstEquipExslotShips {
        mst_equip_ships: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipExslotShips {
    pub mst_equip_ships: HashMap<String, MstEquipExslotShip>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipExslotShip {
    pub ship_ids: Option<HashMap<String, i64>>,
    pub stypes: Option<HashMap<String, i64>>,
    pub ctypes: Option<HashMap<String, i64>>,
    pub req_level: i64,
}

impl MstEquipExslotShips {
    pub fn load() -> Self {
        let equip_ship_map = KCS_MST_EQUIP_EXSLOT_SHIP.lock().unwrap();
        equip_ship_map.clone()
    }

    pub fn restore(&self) {
        let mut equip_ship_map = KCS_MST_EQUIP_EXSLOT_SHIP.lock().unwrap();
        *equip_ship_map = self.clone();
    }
}
