use std::collections::HashMap;

use crate::kcapi;

use std::sync::{LazyLock, Mutex};

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
pub static KCS_AIR_BASE: LazyLock<Mutex<AirBases>> = LazyLock::new(|| {
    Mutex::new(AirBases {
        bases: HashMap::new(),
    })
});

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AirBases {
    pub bases: HashMap<i64, AirBase>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AirBase {
    pub rid: i64,
    pub action_kind: i64,
    pub area_id: i64,
    pub name: String,
    pub distance: i64,
    pub plane_info: Vec<PlaneInfo>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaneInfo {
    pub cond: Option<i64>,
    pub state: i64,
    pub max_count: Option<i64>,
    pub count: Option<i64>,
    pub slotid: i64,
    pub squadron_id: i64,
}

impl AirBases {
    pub fn load() -> Self {
        let bases = KCS_AIR_BASE.lock().unwrap();
        bases.clone()
    }

    pub fn restore(&self) {
        let mut bases = KCS_AIR_BASE.lock().unwrap();
        *bases = self.clone();
    }
}

impl From<Vec<kcapi::api_get_member::mapinfo::ApiAirBase>> for AirBases {
    fn from(bases: Vec<kcapi::api_get_member::mapinfo::ApiAirBase>) -> Self {
        let mut base_list = HashMap::new();
        for base in bases {
            base_list.insert((base.api_area_id << 16) | base.api_rid, base.into());
        }
        Self { bases: base_list }
    }
}

impl From<kcapi::api_get_member::mapinfo::ApiAirBase> for AirBase {
    fn from(base: kcapi::api_get_member::mapinfo::ApiAirBase) -> Self {
        Self {
            rid: base.api_rid,
            action_kind: base.api_action_kind,
            area_id: base.api_area_id,
            name: base.api_name,
            distance: base.api_distance.api_base + base.api_distance.api_bonus,
            plane_info: base
                .api_plane_info
                .into_iter()
                .map(|info| info.into())
                .collect(),
        }
    }
}

impl From<kcapi::api_get_member::mapinfo::ApiPlaneInfo> for PlaneInfo {
    fn from(info: kcapi::api_get_member::mapinfo::ApiPlaneInfo) -> Self {
        Self {
            cond: info.api_cond,
            state: info.api_state,
            max_count: info.api_max_count,
            count: info.api_count,
            slotid: info.api_slotid,
            squadron_id: info.api_squadron_id,
        }
    }
}
