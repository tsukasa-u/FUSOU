use apache_avro::{AvroSchema, Codec, Writer};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct OwnDeck {
    pub ship_ids: Vec<i64>,
    pub combined: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct EnemyDeck {
    pub ship_mst_ids: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct FriendDeck {
    pub ship_mst_ids: Vec<i64>,
}
