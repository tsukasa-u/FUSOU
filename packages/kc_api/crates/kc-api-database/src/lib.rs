#![doc = "# Database Dependency"]
#![doc = register_trait::insert_svg!(path="../../tests/database_dependency_svg/all.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_database_dependency(all)")]
#![doc = include_str!("../../../js/svg_pan_zoom.html")]

// Heavy modules only available with "full" feature (native builds)
// These modules depend on arrow, datafusion, parquet, tokio, etc.
#[cfg(feature = "full")]
pub mod decode;
#[cfg(feature = "full")]
pub mod encode;
#[cfg(feature = "full")]
pub mod integrate;
#[cfg(feature = "full")]
pub mod table;
// models depends on table, so also gated behind full
#[cfg(feature = "full")]
pub mod models;

pub mod schema_version;

pub use schema_version::{DATABASE_TABLE_VERSION, SCHEMA_VERSION};
