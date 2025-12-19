use std::fs;
use std::io::Read;
use std::io::Write;
use std::path::PathBuf;
use tokio::sync::OnceCell;
use tracing_unwrap::{OptionExt, ResultExt};
use uuid::Uuid;
use kc_api::interface::deck_port::Basic;

use crate::RESOURCES_DIR;
use crate::ROAMING_DIR;
/// Deprecated: Environment-scoped ID cache (ENV_UNIQ_ID). Do not use for user identification.
///
/// Use [`get_user_member_id()`] instead for a user-scoped, salted SHA-256 identifier
/// that enables secure cross-device data consolidation.
#[deprecated(since = "0.4.0", note = "Environment-scoped ID cache. Do not use for user identification. Use get_user_member_id() instead.")]
static KC_USER_ENV_UNIQUE_ID: OnceCell<String> = OnceCell::const_new();

#[allow(non_snake_case)]
pub fn get_ROAMING_DIR() -> PathBuf {
    return ROAMING_DIR
        .get()
        .expect_or_log("ROAMING_DIR not found")
        .lock()
        .unwrap()
        .clone();
}

#[allow(non_snake_case)]
pub fn get_RESOURCES_DIR() -> PathBuf {
    return RESOURCES_DIR
        .get()
        .expect_or_log("RESOURCES_DIR not found")
        .lock()
        .unwrap()
        .clone();
}

/// Deprecated: Returns an environment-scoped ID (ENV_UNIQ_ID). Do not use for user identification.
///
/// Use [`get_user_member_id()`] instead. It uses the server-provided user ID
/// hashed with a fixed salt (SHA-256), enabling cross-device data consolidation
/// and meeting security requirements.
#[deprecated(since = "0.4.0", note = "Environment-scoped ID. Do not use for user identification. Use get_user_member_id() instead.")]
pub async fn get_user_env_id() -> String {
    KC_USER_ENV_UNIQUE_ID
        .get_or_init(|| async {
            let binding = get_ROAMING_DIR().join("./user");
            let directory_path = binding.as_path();

            if !fs::exists(directory_path).expect_or_log("failed to check the directory existence")
            {
                fs::create_dir_all(directory_path).expect_or_log("failed to create folder");
            }

            let file_path_binding = directory_path.join("./ENV_UNIQ_ID");
            let file_path = file_path_binding.as_path();

            if fs::exists(file_path).expect_or_log("failed to check the file existence") {
                let mut file = fs::File::open(file_path).expect_or_log("file not found");
                let mut contents = String::new();
                file.read_to_string(&mut contents)
                    .expect_or_log("something went wrong reading the file");
                contents
            } else {
                let mut file = fs::File::create(file_path).expect_or_log("failed to create file.");

                let new_uuid = Uuid::new_v4().to_string();
                writeln!(file, "{new_uuid}").expect_or_log("cannot write.");
                new_uuid
            }
        })
        .await
        .clone()
}

pub async fn get_user_member_id() -> String {
    let basic = Basic::load();
    basic.member_id
}

#[allow(dead_code)]
pub fn type_of<T>(_: &T) -> &'static str {
    std::any::type_name::<T>()
}
