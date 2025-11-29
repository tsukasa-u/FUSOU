use kc_api_interface::air_base::AirBases;
use kc_api_interface::interface::{EmitData, Identifier, Set};
use kc_api_interface::slot_item::SlotItems;

use kc_api_dto::endpoints::api_get_member::*;
use kc_api_interface::use_items::UseItems;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

register_trait!(
    Req,
    (
        basic,
        chart_additional_info,
        deck,
        furniture,
        kdock,
        material,
        mapinfo,
        mission,
        ndock,
        payitem,
        picture_book,
        practice,
        preset_deck,
        preset_slot,
        questlist,
        record,
        require_info,
        ship_deck,
        ship2,
        ship3,
        slot_item,
        sortie_conditions,
        unsetslot,
        useitem
    )
);

register_trait!(
    Res,
    (
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
    )
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
        let use_item =
            InterfaceWrapper::<UseItems>::from(self.api_data.api_useitem.clone()).unwrap();

        Some(vec![
            EmitData::Set(Set::SlotItems(slot_item)),
            EmitData::Set(Set::UseItems(use_item)),
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
