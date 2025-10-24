use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{TraitForEncode, FieldSizeChecker};

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
pub(crate) static KCS_MST_SHIPS: Lazy<Mutex<MstShips>> = Lazy::new(|| {
    Mutex::new(MstShips {
        mst_ships: HashMap::new(),
    })
});

use crate::kcapi_main;

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

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstShip>> for MstShips {
    fn from(ships: Vec<kcapi_main::api_start2::get_data::ApiMstShip>) -> Self {
        let mut ship_map = HashMap::<i64, MstShip>::with_capacity(ships.len());
        // let mut ship_map = HashMap::new();
        for ship in ships {
            ship_map.insert(ship.api_id, ship.into());
        }
        Self {
            mst_ships: ship_map,
        }
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstShip> for MstShip {
    fn from(ship: kcapi_main::api_start2::get_data::ApiMstShip) -> Self {
        Self {
            id: ship.api_id,
            sortno: ship.api_sortno,
            sort_id: ship.api_sort_id,
            name: ship.api_name,
            yomi: ship.api_yomi,
            stype: ship.api_stype,
            ctype: ship.api_ctype,
            afterlv: ship.api_afterlv,
            aftershipid: ship.api_aftershipid,
            taik: ship.api_taik,
            souk: ship.api_souk,
            houg: ship.api_houg,
            raig: ship.api_raig,
            tyku: ship.api_tyku,
            luck: ship.api_luck,
            soku: ship.api_soku,
            leng: ship.api_leng,
            slot_num: ship.api_slot_num,
            maxeq: ship.api_maxeq,
            buildtime: ship.api_buildtime,
            broken: ship.api_broken,
            powup: ship.api_powup,
            backs: ship.api_backs,
            getmes: ship.api_getmes,
            afterfuel: ship.api_afterfuel,
            afterbull: ship.api_afterbull,
            fuel_max: ship.api_fuel_max,
            bull_max: ship.api_bull_max,
            voicef: ship.api_voicef,
            tais: ship.api_tais,
        }
    }
}
