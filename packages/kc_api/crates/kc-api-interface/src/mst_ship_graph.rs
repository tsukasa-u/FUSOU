use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_SHIP_GRAPH: Lazy<Mutex<MstShipGraphs>> = Lazy::new(|| {
    Mutex::new(MstShipGraphs {
        mst_ship_graphs: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstShipGraphs {
    pub mst_ship_graphs: HashMap<i32, MstShipGraph>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstShipGraph {
    pub api_id: i32,
    pub api_filename: String,
    pub api_version: Vec<String>,
    pub api_battle_n: Option<Vec<i32>>,
    pub api_battle_d: Option<Vec<i32>>,
    pub api_sortno: Option<i32>,
    pub api_boko_n: Option<Vec<i32>>,
    pub api_boko_d: Option<Vec<i32>>,
    pub api_kaisyu_n: Option<Vec<i32>>,
    pub api_kaisyu_d: Option<Vec<i32>>,
    pub api_kaizo_n: Option<Vec<i32>>,
    pub api_kaizo_d: Option<Vec<i32>>,
    pub api_map_n: Option<Vec<i32>>,
    pub api_map_d: Option<Vec<i32>>,
    pub api_ensyuf_n: Option<Vec<i32>>,
    pub api_ensyuf_d: Option<Vec<i32>>,
    pub api_ensyue_n: Option<Vec<i32>>,
    pub api_weda: Option<Vec<i32>>,
    pub api_wedb: Option<Vec<i32>>,
    pub api_pa: Option<Vec<i32>>,
    pub api_pab: Option<Vec<i32>>,
    pub api_sp_flag: Option<i32>,
    pub api_wedc: Option<Vec<i32>>,
    pub api_wedd: Option<Vec<i32>>,
}

impl MstShipGraphs {
    pub fn load() -> Self {
        let ship_graph_map = KCS_MST_SHIP_GRAPH.lock().unwrap();
        ship_graph_map.clone()
    }

    pub fn restore(&self) {
        let mut ship_graph_map = KCS_MST_SHIP_GRAPH.lock().unwrap();
        *ship_graph_map = self.clone();
    }
}
