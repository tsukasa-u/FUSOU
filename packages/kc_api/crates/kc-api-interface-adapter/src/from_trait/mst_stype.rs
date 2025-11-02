use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::mst_stype::{MstStype, MstStypes};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstStype>> for InterfaceWrapper<MstStypes> {
    fn from(stypes: Vec<kcapi_main::api_start2::get_data::ApiMstStype>) -> Self {
        let mut stype_map = HashMap::<i64, MstStype>::with_capacity(stypes.len());
        for stype in stypes {
            stype_map.insert(
                stype.api_id,
                InterfaceWrapper::<MstStype>::from(stype).unwrap(),
            );
        }
        Self(MstStypes {
            mst_stypes: stype_map,
        })
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstStype> for InterfaceWrapper<MstStype> {
    fn from(stype: kcapi_main::api_start2::get_data::ApiMstStype) -> Self {
        Self(MstStype {
            id: stype.api_id,
            sortno: stype.api_sortno,
            name: stype.api_name,
            equip_type: stype.api_equip_type,
        })
    }
}
