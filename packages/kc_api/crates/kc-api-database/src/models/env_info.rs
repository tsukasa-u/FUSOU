use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::table::PortTable;
use crate::table::DATABASE_TABLE_VERSION;

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
    /// Added in table_version 0.5 (schema_v0_5).
    /// When compiling with schema_v0_4 feature, this field is excluded
    /// so the generated schema matches the 0.4 shape.
    #[cfg(not(feature = "schema_v0_4"))]
    #[serde(default)]
    pub app_platform: Option<String>,
}

impl EnvInfo {
    pub fn new_ret_uuid(
        ts: uuid::Timestamp,
        data: EnvInfoProps,
        table: &mut PortTable,
    ) -> EnvInfoId {
        let new_uuid = Uuid::new_v7(ts);

        let new_data: EnvInfo = EnvInfo {
            version: DATABASE_TABLE_VERSION.to_string(),
            uuid: new_uuid,
            user_env_unique: data.0,
            timestamp: data.1,
            #[cfg(not(feature = "schema_v0_4"))]
            app_platform: None,
        };

        table.env_info.push(new_data);

        new_uuid
    }
}
