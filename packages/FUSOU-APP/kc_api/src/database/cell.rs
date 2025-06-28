use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::battle::Battle;
use crate::database::battle::BattleId;
use crate::database::env_info::EnvInfoId;
use crate::database::table::PortTable;
use crate::database::table::DATABASE_TABLE_VERSION;

use register_trait::TraitForEncode;

pub type CellsId = Uuid;

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct Cells {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: CellsId,
    pub maparea_id: i64,
    pub mapinfo_no: i64,
    pub cell_index: Vec<i64>,
    pub battle_index: Vec<i64>,
    pub battles: Vec<Option<BattleId>>,
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
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
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
