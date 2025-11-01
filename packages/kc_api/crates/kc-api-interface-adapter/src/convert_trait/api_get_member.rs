use kc_api_interface::air_base::AirBases;
use kc_api_interface::interface::{EmitData, Identifier, Set};
use kc_api_interface::slot_item::SlotItems;

use kc_api_dto::main::api_get_member::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

register_trait!(
    basic,
    chart_additional_info,
    deck,
    furniture,
    kdock,
    material,
    mission,
    ndock,
    payitem,
    picture_book,
    practice,
    preset_deck,
    preset_slot,
    questlist,
    record,
    ship_deck,
    ship2,
    ship3,
    sortie_conditions,
    unsetslot,
    useitem
);

impl TraitForConvert for mapinfo::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let air_bases =
            InterfaceWrapper::<AirBases>::from(self.api_data.api_air_base.clone()).unwrap();

        Some(vec![EmitData::Set(Set::AirBases(air_bases))])
    }
}

impl TraitForConvert for require_info::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let slot_item =
            InterfaceWrapper::<SlotItems>::from(self.api_data.api_slot_item.clone()).unwrap();

        Some(vec![
            EmitData::Set(Set::SlotItems(slot_item)),
            EmitData::Identifier(Identifier::RequireInfo(())),
        ])
    }
}

impl TraitForConvert for slot_item::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let slot_item = InterfaceWrapper::<SlotItems>::from(self.api_data.clone()).unwrap();

        Some(vec![EmitData::Set(Set::SlotItems(slot_item))])
    }
}
