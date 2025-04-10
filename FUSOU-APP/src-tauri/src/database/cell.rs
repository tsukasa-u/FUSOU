use apache_avro::{AvroSchema, Codec, Writer};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct Cells {
    pub maparea_id: i64,
    pub mapinfo_no: i64,
    pub cell_index: Vec<i64>,
    pub battle_index: Vec<i64>,
    pub battles: Vec<Uuid>,
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
//         Self {
//             maparea_id: cells.maparea_id,
//             mapinfo_no: cells.mapinfo_no,
//             cell_index: cells.cell_index,
//             battle_index: cells.battles.keys().cloned().collect(),
//             battles: cells
//                 .battles
//                 .values()
//                 .map(|battle| Uuid::new_v4())
//                 .collect(),
//         }
//     }
// }
