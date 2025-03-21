use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
pub(crate) static KCS_MST_STYPES: LazyLock<Mutex<MstStypes>> = LazyLock::new(|| {
    Mutex::new(MstStypes {
        mst_stypes: HashMap::new(),
    })
});

use crate::kcapi;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MstStypes {
    mst_stypes: HashMap<i64, MstStype>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MstStype {
    pub id: i64,
    pub sortno: i64,
    pub name: String,
    pub equip_type: HashMap<String, i64>,
}

impl MstStypes {
    pub fn load() -> Self {
        let stype_map = KCS_MST_STYPES.lock().unwrap();
        stype_map.clone()
    }

    pub fn restore(&self) {
        let mut stype_map = KCS_MST_STYPES.lock().unwrap();
        *stype_map = self.clone();
    }
}

impl From<Vec<kcapi::api_start2::get_data::ApiMstStype>> for MstStypes {
    fn from(stypes: Vec<kcapi::api_start2::get_data::ApiMstStype>) -> Self {
        let mut stype_map = HashMap::<i64, MstStype>::with_capacity(stypes.len());
        // let mut ship_map = HashMap::new();
        for stype in stypes {
            stype_map.insert(stype.api_id, stype.into());
        }
        Self {
            mst_stypes: stype_map,
        }
    }
}

impl From<kcapi::api_start2::get_data::ApiMstStype> for MstStype {
    fn from(stype: kcapi::api_start2::get_data::ApiMstStype) -> Self {
        Self {
            id: stype.api_id,
            sortno: stype.api_sortno,
            name: stype.api_name,
            equip_type: stype.api_equip_type,
        }
    }
}
