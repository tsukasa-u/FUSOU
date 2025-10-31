use crate::kcapi_main;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

impl From<Vec<kcapi_main::api_port::port::ApiLog>> for Logs {
    fn from(logs: Vec<kcapi_main::api_port::port::ApiLog>) -> Self {
        let mut message_list = Vec::<String>::new();
        for log in logs {
            message_list.push(log.api_message);
        }
        Self {
            message: Some(message_list),
        }
    }
}
