use kc_api_interface::interface::{Add, EmitData, Identifier, Set};

use kc_api_dto::main::api_req_quest::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

register_trait!(clearitemget, start, stop);
