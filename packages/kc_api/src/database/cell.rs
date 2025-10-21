use parquet_derive::ParquetRecordWriter;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::battle::Battle;
use crate::database::battle::BattleId;
use crate::database::env_info::EnvInfoId;
use crate::database::table::PortTable;

use register_trait::{TraitForDecode, TraitForEncode};

pub type CellsId = Uuid;

#[derive(
    Debug, Clone, Deserialize, Serialize, ParquetRecordWriter, TraitForEncode, TraitForDecode,
)]
pub struct Cells {
    /// UUID of EnvInfo.
    pub env_uuid: Vec<u8>,
    /// UUID of Cells.
    pub uuid: Vec<u8>,
    pub maparea_id: i64,
    pub mapinfo_no: i64,
    pub cell_index: Vec<u8>,
    pub battle_index: Vec<u8>,
    /// UUIDs of Battles. These UUIDs may be referenced multiple times.
    pub battles: Vec<u8>,
}

impl Cells {
    pub fn new_ret_uuid(
        data: crate::interface::cells::Cells,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Uuid> {
        let new_uuid = Uuid::new_v4();
        let new_battle = data
            .battles
            .values()
            .map(|battle| Battle::new_ret_uuid(battle.clone(), table, env_uuid))
            .collect();

        let new_data = Cells {
            env_uuid,
            uuid: new_uuid,
            maparea_id: data.maparea_id,
            mapinfo_no: data.mapinfo_no,
            cell_index: data.cell_index,
            battle_index: data.battles.keys().cloned().collect(),
            battles: new_battle,
        };

        table.cells.push(new_data);
        return Some(new_uuid);
    }
}
