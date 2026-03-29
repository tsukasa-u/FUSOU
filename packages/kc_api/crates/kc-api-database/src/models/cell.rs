use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::battle::Battle;
use crate::models::battle::BattleId;
use crate::models::env_info::EnvInfoId;
use crate::dedup::DedupCache;
use crate::table::PortTable;

#[cfg(feature = "schema_v0_5")]
use crate::models::deck::OwnDeckId;
#[cfg(feature = "schema_v0_5")]
use crate::models::deck::OwnDeck;

use register_trait::{FieldSizeChecker, TraitForDecode, TraitForEncode};

pub type CellsId = Uuid;

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct Cells {
    pub env_uuid: EnvInfoId,
    pub uuid: CellsId,
    pub maparea_id: i32,
    pub mapinfo_no: i32,
    pub cell_index: Vec<i32>,
    pub battle_index: Vec<i32>,
    pub battles: BattleId,
    #[cfg(feature = "schema_v0_5")]
    pub event_map_max_maphp: Option<i32>,
    #[cfg(feature = "schema_v0_5")]
    pub event_map_now_maphp: Option<i32>,
    #[cfg(feature = "schema_v0_5")]
    pub event_map_dmg: Option<i32>,
    #[cfg(feature = "schema_v0_5")]
    pub event_map_gauge_type: Option<i32>,
    #[cfg(feature = "schema_v0_5")]
    pub event_map_gauge_num: Option<i32>,
    #[cfg(feature = "schema_v0_5")]
    pub event_map_state: Option<i32>,
    #[cfg(feature = "schema_v0_5")]
    pub event_map_selected_rank: Option<i32>,
    #[cfg(feature = "schema_v0_5")]
    pub happening_counts: Option<Vec<Option<i32>>>,
    #[cfg(feature = "schema_v0_5")]
    pub happening_mst_ids: Option<Vec<Option<i32>>>,
    #[cfg(feature = "schema_v0_5")]
    pub happening_dentans: Option<Vec<Option<i32>>>,
    #[cfg(feature = "schema_v0_5")]
    pub itemget_ids: Option<Vec<Vec<i32>>>,
    #[cfg(feature = "schema_v0_5")]
    pub itemget_counts: Option<Vec<Vec<i32>>>,
    #[cfg(feature = "schema_v0_5")]
    pub f_deck_before_id: Option<OwnDeckId>,
    #[cfg(feature = "schema_v0_5")]
    pub f_deck_after_id: Option<OwnDeckId>,
}

impl Cells {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::cells::Cells,
        table: &mut PortTable,
        dedup: &mut DedupCache,
        env_uuid: EnvInfoId,
    ) {
        let new_battle = Uuid::new_v7(ts);
        data.battles
            .values()
            .enumerate()
            .for_each(|(battle_index, battle)| {
                Battle::new_ret_option(
                    ts,
                    new_battle,
                    battle.clone(),
                    table,
                    dedup,
                    env_uuid,
                    battle_index,
                )
            });
        
        #[cfg(feature = "schema_v0_5")]
        let deck_id = data.clone().battles.values().find_map(|battle| battle.deck_id);
        #[cfg(feature = "schema_v0_5")]
        let new_f_deck_before_id = {
            let uuid = Uuid::new_v7(ts);
            let cashe = true;
            deck_id
                .and_then(|deck_id| OwnDeck::new_ret_option(ts, uuid, deck_id, table, env_uuid, cashe))
                .map(|_| uuid)
        };
        #[cfg(feature = "schema_v0_5")]
        let new_f_deck_after_id = {
            let uuid = Uuid::new_v7(ts);
            let cashe = false;
            deck_id
                .and_then(|deck_id| OwnDeck::new_ret_option(ts, uuid, deck_id, table, env_uuid, cashe))
                .map(|_| uuid)
        };

        #[cfg(feature = "schema_v0_5")]
        let mut happening_counts = Vec::with_capacity(data.cell_index.len());
        #[cfg(feature = "schema_v0_5")]
        let mut happening_mst_ids = Vec::with_capacity(data.cell_index.len());
        #[cfg(feature = "schema_v0_5")]
        let mut happening_dentans = Vec::with_capacity(data.cell_index.len());
        #[cfg(feature = "schema_v0_5")]
        let mut itemget_ids = Vec::with_capacity(data.cell_index.len());
        #[cfg(feature = "schema_v0_5")]
        let mut itemget_counts = Vec::with_capacity(data.cell_index.len());

        #[cfg(feature = "schema_v0_5")]
        let mut has_happening = false;
        #[cfg(feature = "schema_v0_5")]
        let mut has_itemget = false;

        #[cfg(feature = "schema_v0_5")]
        for cell_no in &data.cell_index {
            let cell = data.cells.get(cell_no);

            if let Some(happening) = cell.and_then(|c| c.happening.as_ref()) {
                has_happening = true;
                happening_counts.push(Some(happening.count as i32));
                happening_mst_ids.push(Some(happening.mst_id as i32));
                happening_dentans.push(Some(happening.dentan as i32));
            } else {
                happening_counts.push(None);
                happening_mst_ids.push(None);
                happening_dentans.push(None);
            }

            if let Some(items) = cell.and_then(|c| c.itemget.as_ref()) {
                if !items.is_empty() {
                    has_itemget = true;
                }
                itemget_ids.push(items.iter().map(|x| x.id as i32).collect());
                itemget_counts.push(items.iter().map(|x| x.getcount as i32).collect());
            } else {
                itemget_ids.push(Vec::new());
                itemget_counts.push(Vec::new());
            }
        }

        #[cfg(feature = "schema_v0_5")]
        let event_map_max_maphp = data.event_map.as_ref().map(|x| x.max_maphp as i32);
        #[cfg(feature = "schema_v0_5")]
        let event_map_now_maphp = data.event_map.as_ref().map(|x| x.now_maphp as i32);
        #[cfg(feature = "schema_v0_5")]
        let event_map_dmg = data.event_map.as_ref().map(|x| x.dmg as i32);
        #[cfg(feature = "schema_v0_5")]
        let event_map_gauge_type = data
            .event_map
            .as_ref()
            .and_then(|x| x.gauge_type)
            .map(|x| x as i32);
        #[cfg(feature = "schema_v0_5")]
        let event_map_gauge_num = data
            .event_map
            .as_ref()
            .and_then(|x| x.gauge_num)
            .map(|x| x as i32);
        #[cfg(feature = "schema_v0_5")]
        let event_map_state = data
            .event_map
            .as_ref()
            .and_then(|x| x.state)
            .map(|x| x as i32);
        #[cfg(feature = "schema_v0_5")]
        let event_map_selected_rank = data
            .event_map
            .as_ref()
            .and_then(|x| x.selected_rank)
            .map(|x| x as i32);


        let new_data = Cells {
            env_uuid,
            uuid,
            maparea_id: data.maparea_id as i32,
            mapinfo_no: data.mapinfo_no as i32,
            cell_index: data
                .cell_index
                .iter()
                .map(|&index| index as i32)
                .collect(),
            battle_index: data
                .battles
                .keys()
                .map(|&battle_idx| battle_idx as i32)
                .collect(),
            battles: new_battle,
            #[cfg(feature = "schema_v0_5")]
            event_map_max_maphp,
            #[cfg(feature = "schema_v0_5")]
            event_map_now_maphp,
            #[cfg(feature = "schema_v0_5")]
            event_map_dmg,
            #[cfg(feature = "schema_v0_5")]
            event_map_gauge_type,
            #[cfg(feature = "schema_v0_5")]
            event_map_gauge_num,
            #[cfg(feature = "schema_v0_5")]
            event_map_state,
            #[cfg(feature = "schema_v0_5")]
            event_map_selected_rank,
            #[cfg(feature = "schema_v0_5")]
            happening_counts: has_happening.then_some(happening_counts),
            #[cfg(feature = "schema_v0_5")]
            happening_mst_ids: has_happening.then_some(happening_mst_ids),
            #[cfg(feature = "schema_v0_5")]
            happening_dentans: has_happening.then_some(happening_dentans),
            #[cfg(feature = "schema_v0_5")]
            itemget_ids: has_itemget.then_some(itemget_ids),
            #[cfg(feature = "schema_v0_5")]
            itemget_counts: has_itemget.then_some(itemget_counts),
            #[cfg(feature = "schema_v0_5")]
            f_deck_before_id: new_f_deck_before_id,
            #[cfg(feature = "schema_v0_5")]
            f_deck_after_id: new_f_deck_after_id,
        };

        table.cells.push(new_data);
    }
}
