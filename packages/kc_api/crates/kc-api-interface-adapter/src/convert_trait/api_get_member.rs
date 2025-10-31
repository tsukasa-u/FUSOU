use kc_api_interface::air_base::AirBases;
use kc_api_interface::interface::{EmitData, Identifier, Set};
use kc_api_interface::slot_item::SlotItems;

use kc_api_dto::main::api_get_member::*;

use register_trait::TraitForConvert;

impl TraitForConvert for mapinfo::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let air_bases: AirBases = self.api_data.api_air_base.clone().into();

        Some(vec![EmitData::Set(Set::AirBases(air_bases))])
    }
}

impl TraitForConvert for require_info::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let slot_item: SlotItems = self.api_data.api_slot_item.clone().into();

        Some(vec![
            EmitData::Set(Set::SlotItems(slot_item)),
            EmitData::Identifier(Identifier::RequireInfo(())),
        ])
    }
}

impl TraitForConvert for slot_item::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let slot_item: SlotItems = self.api_data.clone().into();

        Some(vec![EmitData::Set(Set::SlotItems(slot_item))])
    }
}
