use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
pub(crate) static KCS_MST_SHIPS: Lazy<Mutex<MstShips>> = Lazy::new(|| {
    Mutex::new(MstShips {
        mst_ships: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstShips {
    pub mst_ships: HashMap<i32, MstShip>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstShip {
    pub id: i32,
    pub sortno: Option<i32>,
    pub sort_id: i32,
    pub name: String,
    pub yomi: String,
    pub stype: i32,
    pub ctype: i32,
    pub afterlv: Option<i32>,
    pub aftershipid: Option<String>,
    pub taik: Option<Vec<i32>>,
    pub souk: Option<Vec<i32>>,
    pub houg: Option<Vec<i32>>,
    pub raig: Option<Vec<i32>>,
    pub tyku: Option<Vec<i32>>,
    pub luck: Option<Vec<i32>>,
    pub soku: i32,
    pub leng: Option<i32>,
    pub slot_num: i32,
    pub maxeq: Option<Vec<i32>>,
    pub buildtime: Option<i32>,
    pub broken: Option<Vec<i32>>,
    pub powup: Option<Vec<i32>>,
    pub backs: Option<i32>,
    pub getmes: Option<String>,
    pub afterfuel: Option<i32>,
    pub afterbull: Option<i32>,
    pub fuel_max: Option<i32>,
    pub bull_max: Option<i32>,
    pub voicef: Option<i32>,
    pub tais: Option<Vec<i32>>,
}

impl MstShips {
    pub fn load() -> Self {
        let ship_map = KCS_MST_SHIPS.lock().unwrap();
        ship_map.clone()
    }

    pub fn restore(&self) {
        let mut ship_map = KCS_MST_SHIPS.lock().unwrap();
        *ship_map = self.clone();
    }
}
