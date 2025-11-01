use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::mst_equip_ship::{MstEquipShip, MstEquipShips};
use std::collections::HashMap;

#[cfg(not(feature = "20250627"))]
impl From<Vec<kcapi_main::api_start2::get_data::ApiMstEquipShip>>
    for InterfaceWrapper<MstEquipShips>
{
    fn from(equip_ships: Vec<kcapi_main::api_start2::get_data::ApiMstEquipShip>) -> Self {
        let mut equip_ship_map = HashMap::<i64, MstEquipShip>::with_capacity(equip_ships.len());
        for equip_ship in equip_ships {
            equip_ship_map.insert(
                equip_ship.api_ship_id,
                InterfaceWrapper::<MstEquipShip>::from(equip_ship).unwrap(),
            );
        }
        Self(MstEquipShips {
            mst_equip_ships: equip_ship_map,
        })
    }
}

#[cfg(feature = "20250627")]
impl From<HashMap<i64, kcapi_main::api_start2::get_data::ApiMstEquipShip>>
    for InterfaceWrapper<MstEquipShips>
{
    fn from(equip_ships: HashMap<i64, kcapi_main::api_start2::get_data::ApiMstEquipShip>) -> Self {
        let mut equip_ship_map = HashMap::<i64, MstEquipShip>::with_capacity(equip_ships.len());
        for (ship_id, equip_ship) in equip_ships {
            equip_ship_map.insert(
                ship_id,
                InterfaceWrapper::<MstEquipShip>::from(equip_ship).unwrap(),
            );
        }
        Self(MstEquipShips {
            mst_equip_ships: equip_ship_map,
        })
    }
}

#[cfg(not(feature = "20250627"))]
impl From<kcapi_main::api_start2::get_data::ApiMstEquipShip> for InterfaceWrapper<MstEquipShip> {
    fn from(equip_ship: kcapi_main::api_start2::get_data::ApiMstEquipShip) -> Self {
        Self(MstEquipShip {
            ship_id: equip_ship.api_ship_id,
            equip_type: equip_ship.api_equip_type,
        })
    }
}

#[cfg(feature = "20250627")]
impl From<kcapi_main::api_start2::get_data::ApiMstEquipShip> for InterfaceWrapper<MstEquipShip> {
    fn from(equip_ship: kcapi_main::api_start2::get_data::ApiMstEquipShip) -> Self {
        Self(MstEquipShip {
            equip_type: equip_ship
                .api_equip_type
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect::<HashMap<String, Option<Vec<i64>>>>(),
        })
    }
}
