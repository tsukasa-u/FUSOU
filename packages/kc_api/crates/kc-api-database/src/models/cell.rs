use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[cfg(schema_since = "0.6.0")]
use crate::models::airbase::AirBase;
#[cfg(schema_since = "0.6.0")]
use crate::models::airbase::AirBaseId;
use crate::models::battle::Battle;
use crate::models::battle::BattleId;
#[cfg(schema_since = "0.5.1")]
use crate::models::battle::DestructionBattle;
#[cfg(schema_since = "0.5.1")]
use crate::models::battle::DestructionBattleId;
use crate::models::env_info::EnvInfoId;
use crate::dedup::DedupCache;
use crate::table::PortTable;
#[cfg(schema_since = "0.6.0")]
use kc_api_interface::air_base::AirBases;

#[cfg(schema_since = "0.5.0")]
use crate::models::deck::OwnDeckId;
#[cfg(schema_since = "0.5.0")]
use crate::models::deck::OwnDeck;

use register_trait::{FieldSizeChecker, TraitForDecode, TraitForEncode};

pub type CellsId = Uuid;

#[cfg(schema_since = "0.6.0")]
fn resolve_airbase_uuid_from_base_no(
    ts: uuid::Timestamp,
    table: &mut PortTable,
    dedup: &mut DedupCache,
    env_uuid: EnvInfoId,
    base_no: i64,
) -> Option<AirBaseId> {
    let air_bases = AirBases::load();
    let air_base = air_bases.bases.get(&base_no.to_string())?.clone();
    dedup.new_ret_uuid("airbase", base_no, ts, |new_uuid| {
        AirBase::new_ret_option(ts, new_uuid, air_base, table, env_uuid, Some(base_no))
    })
}

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
    #[cfg(schema_since = "0.6.0")]
    pub airbase_id: Option<AirBaseId>,
    #[cfg(schema_since = "0.5.0")]
    pub event_map_max_maphp: Option<i32>,
    #[cfg(schema_since = "0.5.0")]
    pub event_map_now_maphp: Option<i32>,
    #[cfg(schema_since = "0.5.0")]
    pub event_map_dmg: Option<i32>,
    #[cfg(schema_since = "0.5.0")]
    pub event_map_gauge_type: Option<i32>,
    #[cfg(schema_since = "0.5.0")]
    pub event_map_gauge_num: Option<i32>,
    #[cfg(schema_since = "0.5.0")]
    pub event_map_state: Option<i32>,
    #[cfg(schema_since = "0.5.0")]
    pub event_map_selected_rank: Option<i32>,
    #[cfg(schema_since = "0.5.0")]
    pub happening_counts: Option<Vec<Option<i32>>>,
    #[cfg(schema_since = "0.5.0")]
    pub happening_mst_ids: Option<Vec<Option<i32>>>,
    #[cfg(schema_since = "0.5.0")]
    pub happening_dentans: Option<Vec<Option<i32>>>,
    #[cfg(schema_since = "0.5.0")]
    pub itemget_ids: Option<Vec<Vec<i32>>>,
    #[cfg(schema_since = "0.5.0")]
    pub itemget_counts: Option<Vec<Vec<i32>>>,
    #[cfg(schema_since = "0.5.0")]
    pub f_deck_before_id: Option<OwnDeckId>,
    #[cfg(schema_since = "0.5.0")]
    pub f_deck_after_id: Option<OwnDeckId>,
    #[cfg(schema_since = "0.5.1")]
    pub destruction_battles: Option<DestructionBattleId>,
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
        let battles = data.battles.values().cloned().collect::<Vec<_>>();
        battles
            .iter()
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

        #[cfg(schema_since = "0.5.1")]
        let new_destruction_battles = {
            let destruction_battle_uuid = Uuid::new_v7(ts);
            let mut has_destruction_battle = false;
            let battle_index_by_cell_no: HashMap<i64, usize> = battles
                .iter()
                .enumerate()
                .map(|(battle_index, battle)| (battle.cell_id, battle_index))
                .collect();

            for cell_no in &data.cell_index {
                let Some(cell) = data.cells.get(cell_no) else {
                    continue;
                };
                let Some(destruction_battle) = cell.destruction_battle.clone() else {
                    continue;
                };
                let Some(&destruction_battle_index) = battle_index_by_cell_no.get(cell_no)
                else {
                    continue;
                };

                if DestructionBattle::new_ret_option(
                    ts,
                    destruction_battle_uuid,
                    destruction_battle,
                    table,
                    dedup,
                    env_uuid,
                    destruction_battle_index,
                    *cell_no,
                )
                .is_some()
                {
                    has_destruction_battle = true;
                }
            }

            has_destruction_battle.then_some(destruction_battle_uuid)
        };
        
        #[cfg(schema_since = "0.5.0")]
        let deck_id = data.clone().battles.values().find_map(|battle| battle.deck_id);
        #[cfg(schema_since = "0.5.0")]
        let new_f_deck_before_id = {
            let cashe = true;
            deck_id.and_then(|deck_id| {
                dedup.new_ret_uuid("own_deck_before", deck_id, ts, |uuid| {
                    OwnDeck::new_ret_option(ts, uuid, deck_id, table, env_uuid, cashe)
                })
            })
        };
        #[cfg(schema_since = "0.5.0")]
        let new_f_deck_after_id = {
            let cashe = false;
            deck_id.and_then(|deck_id| {
                dedup.new_ret_uuid("own_deck_after", deck_id, ts, |uuid| {
                    OwnDeck::new_ret_option(ts, uuid, deck_id, table, env_uuid, cashe)
                })
            })
        };

        #[cfg(schema_since = "0.5.0")]
        let mut happening_counts = Vec::with_capacity(data.cell_index.len());
        #[cfg(schema_since = "0.5.0")]
        let mut happening_mst_ids = Vec::with_capacity(data.cell_index.len());
        #[cfg(schema_since = "0.5.0")]
        let mut happening_dentans = Vec::with_capacity(data.cell_index.len());
        #[cfg(schema_since = "0.5.0")]
        let mut itemget_ids = Vec::with_capacity(data.cell_index.len());
        #[cfg(schema_since = "0.5.0")]
        let mut itemget_counts = Vec::with_capacity(data.cell_index.len());

        #[cfg(schema_since = "0.5.0")]
        let mut has_happening = false;
        #[cfg(schema_since = "0.5.0")]
        let mut has_itemget = false;

        #[cfg(schema_since = "0.5.0")]
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

        #[cfg(schema_since = "0.5.0")]
        let event_map_max_maphp = data.event_map.as_ref().map(|x| x.max_maphp as i32);
        #[cfg(schema_since = "0.5.0")]
        let event_map_now_maphp = data.event_map.as_ref().map(|x| x.now_maphp as i32);
        #[cfg(schema_since = "0.5.0")]
        let event_map_dmg = data.event_map.as_ref().map(|x| x.dmg as i32);
        #[cfg(schema_since = "0.5.0")]
        let event_map_gauge_type = data
            .event_map
            .as_ref()
            .and_then(|x| x.gauge_type)
            .map(|x| x as i32);
        #[cfg(schema_since = "0.5.0")]
        let event_map_gauge_num = data
            .event_map
            .as_ref()
            .and_then(|x| x.gauge_num)
            .map(|x| x as i32);
        #[cfg(schema_since = "0.5.0")]
        let event_map_state = data
            .event_map
            .as_ref()
            .and_then(|x| x.state)
            .map(|x| x as i32);
        #[cfg(schema_since = "0.5.0")]
        let event_map_selected_rank = data
            .event_map
            .as_ref()
            .and_then(|x| x.selected_rank)
            .map(|x| x as i32);

        #[cfg(schema_since = "0.6.0")]
        let new_airbase_id = {
            let mut battle_indexes = data.battles.keys().copied().collect::<Vec<_>>();
            battle_indexes.sort_unstable();

            let base_no_from_battle = battle_indexes.into_iter().find_map(|battle_index| {
                let battle = data.battles.get(&battle_index)?;
                battle
                    .air_base_air_attacks
                    .as_ref()
                    .and_then(|attacks| attacks.attacks.first().map(|attack| attack.base_id))
                    .or_else(|| {
                        battle.air_base_assault.as_ref().and_then(|assault| {
                            (!assault.squadron_count.is_empty()).then_some(1_i64)
                        })
                    })
            });

            #[cfg(schema_since = "0.5.1")]
            let base_no_from_destruction = data.cell_index.iter().find_map(|cell_no| {
                let cell = data.cells.get(cell_no)?;
                let destruction_battle = cell.destruction_battle.as_ref()?;
                let map_squadron_plane = destruction_battle.air_base_attack.map_squadron_plane.as_ref()?;
                let mut base_nos = map_squadron_plane
                    .keys()
                    .filter_map(|base_no| base_no.parse::<i64>().ok())
                    .collect::<Vec<_>>();
                base_nos.sort_unstable();
                base_nos.into_iter().next()
            });

            #[cfg(schema_until = "0.5.0")]
            let base_no_from_destruction = None;

            base_no_from_battle
                .or(base_no_from_destruction)
                .and_then(|base_no| {
                    resolve_airbase_uuid_from_base_no(ts, table, dedup, env_uuid, base_no)
                })
        };


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
            #[cfg(schema_since = "0.6.0")]
            airbase_id: new_airbase_id,
            #[cfg(schema_since = "0.5.0")]
            event_map_max_maphp,
            #[cfg(schema_since = "0.5.0")]
            event_map_now_maphp,
            #[cfg(schema_since = "0.5.0")]
            event_map_dmg,
            #[cfg(schema_since = "0.5.0")]
            event_map_gauge_type,
            #[cfg(schema_since = "0.5.0")]
            event_map_gauge_num,
            #[cfg(schema_since = "0.5.0")]
            event_map_state,
            #[cfg(schema_since = "0.5.0")]
            event_map_selected_rank,
            #[cfg(schema_since = "0.5.0")]
            happening_counts: has_happening.then_some(happening_counts),
            #[cfg(schema_since = "0.5.0")]
            happening_mst_ids: has_happening.then_some(happening_mst_ids),
            #[cfg(schema_since = "0.5.0")]
            happening_dentans: has_happening.then_some(happening_dentans),
            #[cfg(schema_since = "0.5.0")]
            itemget_ids: has_itemget.then_some(itemget_ids),
            #[cfg(schema_since = "0.5.0")]
            itemget_counts: has_itemget.then_some(itemget_counts),
            #[cfg(schema_since = "0.5.0")]
            f_deck_before_id: new_f_deck_before_id,
            #[cfg(schema_since = "0.5.0")]
            f_deck_after_id: new_f_deck_after_id,
            #[cfg(schema_since = "0.5.1")]
            destruction_battles: new_destruction_battles,
        };

        table.cells.push(new_data);
    }
}
