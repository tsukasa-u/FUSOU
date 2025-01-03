//! # kanColle API
//! KC APIs are also dependent on kcapi::kcapi_common.
//! The dependency graph of the APIs is shown below.
//! <div style="height: 80vh; overflow: scroll;">
//!   <img src="https://raw.githubusercontent.com/tsukasa-u/FUSOU/refs/heads/main/FUSOU-APP/src-tauri/tests/struct_dependency.svg" alt="KC_API_dependency" style="max-width: 2000px;"/>
//! </div>

pub mod api_req_hokyu;
pub mod api_req_map;
pub mod api_req_sortie;
pub mod api_get_member;
pub mod api_req_kaisou;
pub mod api_req_quest;
pub mod api_req_kousyou;
pub mod api_req_mission;
pub mod api_req_hensei;
pub mod api_req_nyukyo;
pub mod api_req_member;
pub mod api_req_practice;
pub mod api_req_battle_midnight;
pub mod api_start2;
pub mod api_port;
pub mod api_req_ranking;

