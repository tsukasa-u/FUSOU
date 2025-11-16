use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::battle::Battle;
use crate::models::battle::BattleId;
use crate::models::env_info::EnvInfoId;
use crate::table::PortTable;

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
}

impl Cells {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::cells::Cells,
        table: &mut PortTable,
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
                    env_uuid,
                    battle_index,
                )
            });

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
        };

        table.cells.push(new_data);
    }
}
