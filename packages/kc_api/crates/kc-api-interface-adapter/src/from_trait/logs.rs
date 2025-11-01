use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::logs::Logs;

impl From<Vec<kcapi_main::api_port::port::ApiLog>> for InterfaceWrapper<Logs> {
    fn from(logs: Vec<kcapi_main::api_port::port::ApiLog>) -> Self {
        let mut message_list = Vec::<String>::new();
        for log in logs {
            message_list.push(log.api_message);
        }
        Self(Logs {
            message: Some(message_list),
        })
    }
}
