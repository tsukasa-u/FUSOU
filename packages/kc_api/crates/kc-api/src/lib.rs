//! Facade crate for the kc_api workspace.

pub use kc_api_database as database;
pub use kc_api_dto as kcapi_dto;
pub use kc_api_interface as interface;
pub use kc_api_interface_adapter as interface_adapter;
pub use kc_api_parser as parser;
pub use kc_fleet_snapshot as fleet_snapshot;

pub mod prelude {
    pub use kc_api_database;
    pub use kc_api_dto;
    pub use kc_api_interface;
    pub use kc_api_interface_adapter;
    pub use kc_api_parser;
    pub use kc_fleet_snapshot;
}
