#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/all.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(all)")]
#![doc = include_str!("../../../../js/svg_pan_zoom.html")]

pub mod api_dmm_payment;
pub mod api_get_member;
pub mod api_port;
pub mod api_req_air_corps;
pub mod api_req_battle_midnight;
pub mod api_req_combined_battle;
pub mod api_req_furniture;
pub mod api_req_hensei;
pub mod api_req_hokyu;
pub mod api_req_kaisou;
pub mod api_req_kousyou;
pub mod api_req_map;
pub mod api_req_member;
pub mod api_req_mission;
pub mod api_req_nyukyo;
pub mod api_req_practice;
pub mod api_req_quest;
pub mod api_req_ranking;
pub mod api_req_sortie;
pub mod api_start2;
