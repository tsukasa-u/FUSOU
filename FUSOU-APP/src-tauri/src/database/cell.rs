use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::battle::Battle;
use crate::database::table::PortTable;

use register_trait::TraitForEncode;

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct Cells {
    pub uuid: Uuid,
    pub maparea_id: i64,
    pub mapinfo_no: i64,
    pub cell_index: Vec<i64>,
    pub battle_index: Vec<i64>,
    pub battles: Vec<Option<Uuid>>,
}

// impl From<Cells> for Result<Vec<u8>, apache_avro::Error> {
//     fn from(cells: Cells) -> Self {
//         let schema = Cells::get_schema();

//         let mut writer = Writer::with_codec(&schema, Vec::new(), Codec::Deflate);
//         writer.append_ser(cells)?;
//         writer.into_inner()
//     }
// }

// impl From<crate::interface::cells::Cells> for Cells {
//     fn from(cells: crate::interface::cells::Cells) -> Self {
//     }
// }

impl Cells {
    pub fn new_ret_uuid(
        data: crate::interface::cells::Cells,
        table: &mut PortTable,
    ) -> Option<Uuid> {
        let new_uuid = Uuid::new_v4();
        let new_battle = data
            .battles
            .values()
            .map(|battle| Battle::new_ret_uuid(battle.clone(), table))
            .collect();

        let new_data = Cells {
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
