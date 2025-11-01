use kc_api_interface::interface::EmitData;

use kc_api_dto::main::api_req_furniture::*;

use crate::{register_trait, TraitForConvert};

register_trait!(Req, (buy, change, music_list, music_play, set_portbgm));
register_trait!(Res, (buy, change, music_list, music_play, set_portbgm));
