use crate::InterfaceWrapper;
use kc_api_dto::main as kcapi_main;
use kc_api_interface::mst_equip_exslot_ship::{MstEquipExslotShip, MstEquipExslotShips};
use std::collections::HashMap;

impl From<HashMap<String, kcapi_main::api_start2::get_data::ApiMstEquipExslotShip>>
    for InterfaceWrapper<MstEquipExslotShips>
{
    fn from(
        equip_ships: HashMap<String, kcapi_main::api_start2::get_data::ApiMstEquipExslotShip>,
    ) -> Self {
        let mut equip_ship_map =
            HashMap::<String, MstEquipExslotShip>::with_capacity(equip_ships.len());
        for (idx, equip_ship) in equip_ships {
            equip_ship_map.insert(
                idx,
                InterfaceWrapper::<MstEquipExslotShip>::from(equip_ship).unwrap(),
            );
        }
        Self(MstEquipExslotShips {
            mst_equip_ships: equip_ship_map,
        })
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstEquipExslotShip>
    for InterfaceWrapper<MstEquipExslotShip>
{
    fn from(equip_ship: kcapi_main::api_start2::get_data::ApiMstEquipExslotShip) -> Self {
        Self(MstEquipExslotShip {
            ship_ids: equip_ship.api_ship_ids,
            stypes: equip_ship.api_stypes,
            ctypes: equip_ship.api_ctypes,
            req_level: equip_ship.api_req_level,
        })
    }
}
