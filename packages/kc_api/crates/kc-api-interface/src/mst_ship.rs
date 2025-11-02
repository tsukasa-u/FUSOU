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
    pub mst_ships: HashMap<i64, MstShip>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstShip {
    pub id: i64,
    pub sortno: Option<i64>,
    pub sort_id: i64,
    pub name: String,
    pub yomi: String,
    pub stype: i64,
    pub ctype: i64,
    pub afterlv: Option<i64>,
    pub aftershipid: Option<String>,
    pub taik: Option<Vec<i64>>,
    pub souk: Option<Vec<i64>>,
    pub houg: Option<Vec<i64>>,
    pub raig: Option<Vec<i64>>,
    pub tyku: Option<Vec<i64>>,
    pub luck: Option<Vec<i64>>,
    pub soku: i64,
    pub leng: Option<i64>,
    pub slot_num: i64,
    pub maxeq: Option<Vec<i64>>,
    pub buildtime: Option<i64>,
    pub broken: Option<Vec<i64>>,
    pub powup: Option<Vec<i64>>,
    pub backs: Option<i64>,
    pub getmes: Option<String>,
    pub afterfuel: Option<i64>,
    pub afterbull: Option<i64>,
    pub fuel_max: Option<i64>,
    pub bull_max: Option<i64>,
    pub voicef: Option<i64>,
    pub tais: Option<Vec<i64>>,
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
