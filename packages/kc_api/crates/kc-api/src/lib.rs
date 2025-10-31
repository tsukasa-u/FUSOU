//! Facade crate for the kc_api workspace.

pub use kc_api_database as database;
pub use kc_api_dto as kcapi_dto;
pub use kc_api_interface as interface;
pub use kc_api_parser as parser;

pub mod prelude {
    pub use kc_api_database::*;
    pub use kc_api_interface::*;
    pub use kc_api_main::*;
    pub use kc_api_parser::*;
}
