use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstShipgraph>> for MstShipGraphs {
    fn from(ship_graphs: Vec<kcapi_main::api_start2::get_data::ApiMstShipgraph>) -> Self {
        let mut ship_graph_map = HashMap::<i64, MstShipGraph>::with_capacity(ship_graphs.len());
        // let mut ship_map = HashMap::new();
        for ship_graph in ship_graphs {
            ship_graph_map.insert(ship_graph.api_id, ship_graph.into());
        }
        Self {
            mst_ship_graphs: ship_graph_map,
        }
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstShipgraph> for MstShipGraph {
    fn from(ship_graph: kcapi_main::api_start2::get_data::ApiMstShipgraph) -> Self {
        Self {
            api_id: ship_graph.api_id,
            api_filename: ship_graph.api_filename,
            api_version: ship_graph.api_version,
            api_battle_n: ship_graph.api_battle_n,
            api_battle_d: ship_graph.api_battle_d,
            api_sortno: ship_graph.api_sortno,
            api_boko_n: ship_graph.api_boko_n,
            api_boko_d: ship_graph.api_boko_d,
            api_kaisyu_n: ship_graph.api_kaisyu_n,
            api_kaisyu_d: ship_graph.api_kaisyu_d,
            api_kaizo_n: ship_graph.api_kaizo_n,
            api_kaizo_d: ship_graph.api_kaizo_d,
            api_map_n: ship_graph.api_map_n,
            api_map_d: ship_graph.api_map_d,
            api_ensyuf_n: ship_graph.api_ensyuf_n,
            api_ensyuf_d: ship_graph.api_ensyuf_d,
            api_ensyue_n: ship_graph.api_ensyue_n,
            api_weda: ship_graph.api_weda,
            api_wedb: ship_graph.api_wedb,
            api_pa: ship_graph.api_pa,
            api_pab: ship_graph.api_pab,
            api_sp_flag: ship_graph.api_sp_flag,
            api_wedc: ship_graph.api_wedc,
            api_wedd: ship_graph.api_wedd,
        }
    }
}
