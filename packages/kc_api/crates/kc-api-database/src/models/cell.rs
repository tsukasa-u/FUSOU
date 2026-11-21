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
#[cfg(schema_since = "0.6.1")]
use crate::models::deck::SupportDeck;
#[cfg(schema_since = "0.6.1")]
use crate::models::deck::SupportDeckId;
#[cfg(schema_since = "0.6.1")]
use kc_api_interface::deck_port::DeckPorts;
#[cfg(schema_since = "0.6.1")]
use kc_api_interface::mst_mission::MstMissions;

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
    #[cfg(schema_since = "0.6.1")]
    pub support_deck_ids: Option<Vec<SupportDeckId>>,
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

        #[cfg(schema_since = "0.6.1")]
        let new_support_deck_ids = {
            let decks = {
                let cached = DeckPorts::load_cashe();
                if cached.deck_ports.is_empty() {
                    DeckPorts::load()
                } else {
                    cached
                }
            };
            let mst_missions = MstMissions::load();
            let mut support_ids: Vec<SupportDeckId> = Vec::new();

            for deck_id in 2_i64..=4_i64 {
                let Some(deck) = decks.deck_ports.get(&deck_id) else {
                    continue;
                };
                let mission_state = deck.mission.first().copied().unwrap_or(0);
                let mission_id = deck.mission.get(1).copied().unwrap_or(0);
                if !matches!(mission_state, 1 | 2) || !mst_missions.is_support_mission(mission_id) {
                    continue;
                }
                if let Some(support_uuid) = dedup.new_ret_uuid("support_deck", deck_id, ts, |uuid| {
                    let cashe = true;
                    SupportDeck::new_ret_option(ts, uuid, deck_id, table, env_uuid, cashe)
                }) {
                    support_ids.push(support_uuid);
                }
            }

            // Ensure any support deck that arrived in a battle during this sortie is also linked
            // (e.g., if pre-sortie deck mission state was missed due to mid-sortie app launch).
            for battle in &table.battle {
                if let Some(support_uuid) = battle.support_deck_id {
                    if !support_ids.contains(&support_uuid) {
                        support_ids.push(support_uuid);
                    }
                }
            }

            (!support_ids.is_empty()).then_some(support_ids)
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
            #[cfg(schema_since = "0.6.1")]
            support_deck_ids: new_support_deck_ids,
        };

        table.cells.push(new_data);
    }
}

#[cfg(all(test, schema_since = "0.6.1"))]
mod support_deck_tests {
    use super::*;
    use crate::table::PortTable;
    use kc_api_interface::battle::{Battle as InterfaceBattle, SupportAttack, SupportHourai};
    use kc_api_interface::cells::Cells as InterfaceCells;
    use kc_api_interface::deck_port::{DeckPort, DeckPorts};
    use kc_api_interface::mst_mission::{MstMission, MstMissions};
    use kc_api_interface::ship::{Ship, Ships};
    use std::sync::Mutex;

    static GLOBAL_STATE_LOCK: Mutex<()> = Mutex::new(());

    fn make_ship(id: i64, ship_id: i64) -> Ship {
        Ship {
            id,
            ship_id: Some(ship_id),
            lv: Some(99),
            exp: Some(vec![1_000_000, 0, 100]),
            nowhp: Some(50),
            maxhp: Some(50),
            soku: Some(10),
            leng: Some(2),
            slot: Some(vec![-1, -1, -1, -1, -1]),
            onslot: Some(vec![0, 0, 0, 0, 0]),
            slot_ex: Some(0),
            fuel: Some(40),
            bull: Some(50),
            slotnum: Some(4),
            cond: Some(85),
            cond_state: Some(5),
            karyoku: Some(vec![80, 80]),
            raisou: Some(vec![60, 60]),
            taiku: Some(vec![70, 70]),
            soukou: Some(vec![65, 65]),
            kaihi: Some(vec![75, 75]),
            taisen: Some(vec![50, 50]),
            sakuteki: Some(vec![45, 45]),
            lucky: Some(vec![20, 79]),
            sally_area: Some(0),
            sortie_tag_id: None,
            sp_effect_items: None,
        }
    }

    fn make_battle_with_support(cell_id: i64, support_deck_id: Option<i64>) -> InterfaceBattle {
        InterfaceBattle {
            battle_order: None,
            timestamp: Some(1_700_000_010 + cell_id),
            midnight_timestamp: None,
            cell_id,
            deck_id: Some(1),
            formation: None,
            enemy_ship_id: None,
            e_lv: None,
            e_params: None,
            f_params: None,
            e_slot: None,
            e_hp_max: None,
            e_combined_flag: None,
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: None,
            escape_idx: None,
            smoke_type: None,
            combat_ration: None,
            balloon_flag: None,
            air_base_assault: None,
            carrier_base_assault: None,
            air_base_air_attacks: None,
            opening_air_attack: None,
            support_attack: support_deck_id.map(|deck_id| SupportAttack {
                support_airatack: None,
                support_hourai: Some(SupportHourai {
                    deck_id,
                    ship_id: vec![301, 302],
                    cl_list: vec![1, 1],
                    damage: vec![100.0, 80.0],
                    protect_flag: vec![false, false],
                    now_hps: vec![0, 0],
                }),
            }),
            night_support_attack: None,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            friendly_force_attack: None,
            midnight_flare_pos: None,
            midnight_touchplane: None,
            midnight_hougeki: None,
            f_nowhps: None,
            e_nowhps: None,
            midnight_f_nowhps: None,
            midnight_e_nowhps: None,
            battle_result: None,
        }
    }

    #[test]
    fn registers_dispatched_support_decks_without_duplicating_battle_support_decks() {
        let _guard = GLOBAL_STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        MstMissions {
            mst_missions: HashMap::from([
                (
                    15,
                    MstMission {
                        id: 15,
                        disp_no: "15".to_string(),
                        maparea_id: 2,
                        name: "囮機動部隊支援作戦".to_string(),
                        time: 720,
                        reset_type: 0,
                        return_flag: 1,
                    },
                ),
                (
                    33,
                    MstMission {
                        id: 33,
                        disp_no: "33".to_string(),
                        maparea_id: 5,
                        name: "前衛支援任務".to_string(),
                        time: 15,
                        reset_type: 0,
                        return_flag: 0,
                    },
                ),
                (
                    302,
                    MstMission {
                        id: 302,
                        disp_no: "S2".to_string(),
                        maparea_id: 61,
                        name: "艦隊決戦支援任務".to_string(),
                        time: 30,
                        reset_type: 0,
                        return_flag: 0,
                    },
                ),
            ]),
        }
        .restore();

        Ships {
            ships: HashMap::from([
                (101, make_ship(101, 1)),
                (201, make_ship(201, 2)),
                (301, make_ship(301, 3)),
                (302, make_ship(302, 4)),
                (401, make_ship(401, 5)),
            ]),
        }
        .restore();
        Ships::cashe_restore();

        DeckPorts {
            deck_ports: HashMap::from([
                (
                    1,
                    DeckPort {
                        id: 1,
                        name: "第一艦隊".to_string(),
                        mission: vec![0, 0, 0, 0],
                        ship: Some(vec![101, -1, -1, -1, -1, -1]),
                        chart_seiku_value: None,
                        chart_tp_value: None,
                    },
                ),
                (
                    2,
                    DeckPort {
                        id: 2,
                        name: "第二艦隊".to_string(),
                        // Regular expedition containing "支援" in its name (return_flag == 1): MUST NOT be recorded
                        mission: vec![1, 15, 1_700_005_000_000, 0],
                        ship: Some(vec![201, -1, -1, -1, -1, -1]),
                        chart_seiku_value: None,
                        chart_tp_value: None,
                    },
                ),
                (
                    3,
                    DeckPort {
                        id: 3,
                        name: "第三艦隊".to_string(),
                        // World 5 vanguard support: arrives in battles 1 and 2
                        mission: vec![1, 33, 1_700_000_900_000, 0],
                        ship: Some(vec![301, 302, -1, -1, -1, -1]),
                        chart_seiku_value: None,
                        chart_tp_value: None,
                    },
                ),
                (
                    4,
                    DeckPort {
                        id: 4,
                        name: "第四艦隊".to_string(),
                        // Event boss support: dispatched, does NOT arrive in any battle
                        mission: vec![1, 302, 1_700_001_800_000, 0],
                        ship: Some(vec![401, -1, -1, -1, -1, -1]),
                        chart_seiku_value: None,
                        chart_tp_value: None,
                    },
                ),
            ]),
            combined_flag: None,
        }
        .restore();
        DeckPorts::cashe_restore();

        // Simulate post-port expedition claim clearing live KCS_DECKS before PortTable::new runs.
        DeckPorts {
            deck_ports: HashMap::from([(
                3,
                DeckPort {
                    id: 3,
                    name: "第三艦隊".to_string(),
                    mission: vec![0, 0, 0, 0],
                    ship: Some(vec![301, 302, -1, -1, -1, -1]),
                    chart_seiku_value: None,
                    chart_tp_value: None,
                },
            )]),
            combined_flag: None,
        }
        .restore();

        let interface_cells = InterfaceCells {
            maparea_id: 61,
            mapinfo_no: 3,
            bosscell_no: 10,
            bosscomp: 0,
            cells: HashMap::new(),
            cell_index: vec![1, 2],
            cell_labels: None,
            event_map: None,
            cell_data: vec![],
            battles: HashMap::from([
                (1, make_battle_with_support(1, Some(3))),
                (2, make_battle_with_support(2, Some(3))),
            ]),
        };

        let port_table = PortTable::new(interface_cells, "test-env".to_string(), 1_700_000_000);

        // Exactly 2 support decks: Fleet 3 (deduplicated across 2 battles + Cells) and Fleet 4 (dispatched only).
        assert_eq!(port_table.support_deck.len(), 2);

        let fleet3 = port_table
            .support_deck
            .iter()
            .find(|d| d.support_mission_id == Some(33))
            .expect("Fleet 3 support deck must be recorded");

        let fleet4 = port_table
            .support_deck
            .iter()
            .find(|d| d.support_mission_id == Some(302))
            .expect("Fleet 4 support deck must be recorded even when not arriving");

        // Both battles point to the exact same deduplicated Fleet 3 SupportDeck UUID.
        assert_eq!(port_table.battle.len(), 2);
        for battle in &port_table.battle {
            assert_eq!(battle.support_deck_id, Some(fleet3.uuid));
        }

        // Cells records both dispatched support fleets in deck order (Fleet 3, Fleet 4) and excludes Fleet 2.
        assert_eq!(port_table.cells.len(), 1);
        assert_eq!(
            port_table.cells[0].support_deck_ids,
            Some(vec![fleet3.uuid, fleet4.uuid])
        );

        // Fleet 3 ships (2 ships) must only be written once for support_deck (no duplicate OwnShip rows).
        let fleet3_ship_rows = port_table
            .own_ship
            .iter()
            .filter(|s| Some(s.uuid) == fleet3.ship_ids)
            .count();
        assert_eq!(fleet3_ship_rows, 2);

        // Ensure Avro encoding succeeds for all populated v0.6.1 tables.
        let encoded = port_table
            .encode_non_empty_tables()
            .expect("PortTable v0.6.1 Avro encoding must succeed");
        assert!(!encoded.is_empty());
    }
}
