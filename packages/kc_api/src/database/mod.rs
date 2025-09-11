#![doc = "# Database Dependency"]
#![doc = register_trait::insert_svg!(path="./tests/database_dependency_svg/all.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_database_dependency(all)")]
#![doc = include_str!("../js/svg_pan_zoom.html")]

pub mod airbase;
pub mod battle;
pub mod cell;
pub mod deck;
pub mod env_info;
pub mod ship;
pub mod slotitem;

pub mod decode;
pub mod encode;
pub mod integrate;

pub mod table;
