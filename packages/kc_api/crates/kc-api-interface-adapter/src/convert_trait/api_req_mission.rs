use kc_api_interface::interface::{Add, EmitData, Identifier, Set};

use kc_api_dto::main::api_req_mission::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

register_trait!(result, return_instruction, start);
