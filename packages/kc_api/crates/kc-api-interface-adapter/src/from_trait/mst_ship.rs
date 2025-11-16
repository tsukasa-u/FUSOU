use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::mst_ship::{MstShip, MstShips};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstShip>> for InterfaceWrapper<MstShips> {
    fn from(ships: Vec<kcapi_main::api_start2::get_data::ApiMstShip>) -> Self {
        let mut ship_map = HashMap::<i32, MstShip>::with_capacity(ships.len());
        for ship in ships {
            ship_map.insert(ship.api_id as i32, InterfaceWrapper::<MstShip>::from(ship).unwrap());
        }
        Self(MstShips {
            mst_ships: ship_map,
        })
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstShip> for InterfaceWrapper<MstShip> {
    fn from(ship: kcapi_main::api_start2::get_data::ApiMstShip) -> Self {
        Self(MstShip {
            id: ship.api_id as i32,
            sortno: ship.api_sortno.map(|value| value as i32),
            sort_id: ship.api_sort_id as i32,
            name: ship.api_name,
            yomi: ship.api_yomi,
            stype: ship.api_stype as i32,
            ctype: ship.api_ctype as i32,
            afterlv: ship.api_afterlv.map(|value| value as i32),
            aftershipid: ship.api_aftershipid,
            taik: ship
                .api_taik
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            souk: ship
                .api_souk
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            houg: ship
                .api_houg
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            raig: ship
                .api_raig
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            tyku: ship
                .api_tyku
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            luck: ship
                .api_luck
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            soku: ship.api_soku as i32,
            leng: ship.api_leng.map(|value| value as i32),
            slot_num: ship.api_slot_num as i32,
            maxeq: ship
                .api_maxeq
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            buildtime: ship.api_buildtime.map(|value| value as i32),
            broken: ship
                .api_broken
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            powup: ship
                .api_powup
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
            backs: ship.api_backs.map(|value| value as i32),
            getmes: ship.api_getmes,
            afterfuel: ship.api_afterfuel.map(|value| value as i32),
            afterbull: ship.api_afterbull.map(|value| value as i32),
            fuel_max: ship.api_fuel_max.map(|value| value as i32),
            bull_max: ship.api_bull_max.map(|value| value as i32),
            voicef: ship.api_voicef.map(|value| value as i32),
            tais: ship
                .api_tais
                .map(|values| values.into_iter().map(|value| value as i32).collect()),
        })
    }
}
