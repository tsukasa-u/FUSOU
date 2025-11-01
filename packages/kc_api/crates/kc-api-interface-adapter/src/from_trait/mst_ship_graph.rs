use crate::InterfaceWrapper;
use kc_api_dto::main as kcapi_main;
use kc_api_interface::mst_ship_graph::{MstShipGraph, MstShipGraphs};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstShipgraph>>
    for InterfaceWrapper<MstShipGraphs>
{
    fn from(ship_graphs: Vec<kcapi_main::api_start2::get_data::ApiMstShipgraph>) -> Self {
        let mut ship_graph_map = HashMap::<i64, MstShipGraph>::with_capacity(ship_graphs.len());
        for ship_graph in ship_graphs {
            ship_graph_map.insert(
                ship_graph.api_id,
                InterfaceWrapper::<MstShipGraph>::from(ship_graph).unwrap(),
            );
        }
        Self(MstShipGraphs {
            mst_ship_graphs: ship_graph_map,
        })
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstShipgraph> for InterfaceWrapper<MstShipGraph> {
    fn from(ship_graph: kcapi_main::api_start2::get_data::ApiMstShipgraph) -> Self {
        Self(MstShipGraph {
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
        })
    }
}
