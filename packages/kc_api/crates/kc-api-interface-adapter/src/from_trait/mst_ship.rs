use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

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
