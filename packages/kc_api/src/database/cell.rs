use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::battle::Battle;
use crate::database::battle::BattleId;
use crate::database::env_info::EnvInfoId;
use crate::database::table::PortTable;

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
    pub maparea_id: i64,
    pub mapinfo_no: i64,
    pub cell_index: Vec<i64>,
    pub battle_index: Vec<i64>,
    pub battles: BattleId,
}

impl Cells {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::cells::Cells,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) {
        let new_battle = Uuid::new_v7(ts);
        data.battles
            .values()
            .enumerate()
            .for_each(|(battle_index, battle)| {
                Battle::new(
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
            maparea_id: data.maparea_id,
            mapinfo_no: data.mapinfo_no,
            cell_index: data.cell_index,
            battle_index: data.battles.keys().cloned().collect(),
            battles: new_battle,
        };

        table.cells.push(new_data);
    }
}
