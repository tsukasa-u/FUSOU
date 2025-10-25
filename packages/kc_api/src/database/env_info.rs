use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::table::PortTable;
use crate::database::table::DATABASE_TABLE_VERSION;

use register_trait::{FieldSizeChecker, TraitForDecode, TraitForEncode};

pub type UserEnv = String;
pub type EnvInfoId = Uuid;

pub type EnvInfoProps = (
    UserEnv,
    i64, // timestamp
);

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
pub struct EnvInfo {
    pub version: String,
    pub uuid: EnvInfoId,
    pub user_env_unique: UserEnv,
    pub timestamp: i64,
}

impl EnvInfo {
    pub fn new_ret_uuid(data: EnvInfoProps, table: &mut PortTable) -> Uuid {
        let new_uuid: Uuid = Uuid::new_v4();

        let new_data: EnvInfo = EnvInfo {
            version: DATABASE_TABLE_VERSION.to_string(),
            uuid: new_uuid,
            user_env_unique: data.0,
            timestamp: data.1,
        };

        table.env_info.push(new_data);

        return new_uuid;
    }
}
