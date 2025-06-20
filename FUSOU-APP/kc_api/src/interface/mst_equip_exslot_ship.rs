use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};

use register_trait::TraitForEncode;

pub(crate) static KCS_MST_EQUIP_EXSLOT_SHIP: Lazy<Mutex<MstEquipExslotShips>> = Lazy::new(|| {
    Mutex::new(MstEquipExslotShips {
        mst_equip_ships: HashMap::new(),
    })
});

use crate::kcapi_main;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MstEquipExslotShips {
    pub mst_equip_ships: HashMap<String, MstEquipExslotShip>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode)]
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

impl From<HashMap<String, kcapi_main::api_start2::get_data::ApiMstEquipExslotShip>>
    for MstEquipExslotShips
{
    fn from(
        equip_ships: HashMap<String, kcapi_main::api_start2::get_data::ApiMstEquipExslotShip>,
    ) -> Self {
        let mut equip_ship_map =
            HashMap::<String, MstEquipExslotShip>::with_capacity(equip_ships.len());
        // let mut ship_map = HashMap::new();
        for (idx, equip_ship) in equip_ships {
            equip_ship_map.insert(idx, equip_ship.into());
        }
        Self {
            mst_equip_ships: equip_ship_map,
        }
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstEquipExslotShip> for MstEquipExslotShip {
    fn from(equip_ship: kcapi_main::api_start2::get_data::ApiMstEquipExslotShip) -> Self {
        Self {
            ship_ids: equip_ship.api_ship_ids,
            stypes: equip_ship.api_stypes,
            ctypes: equip_ship.api_ctypes,
            req_level: equip_ship.api_req_level,
        }
    }
}
