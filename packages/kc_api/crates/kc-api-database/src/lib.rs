#![doc = "# Database Dependency"]
#![doc = register_trait::insert_svg!(path="../../tests/database_dependency_svg/all.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_database_dependency(all)")]
#![doc = include_str!("../../../js/svg_pan_zoom.html")]

pub mod avro_to_parquet;
pub mod batch_upload;
pub mod decode;
pub mod encode;
pub mod integrate;
pub mod models;
pub mod schema_version;

pub mod table;

// Re-export version constants
pub use schema_version::{SCHEMA_VERSION, DATABASE_TABLE_VERSION};
