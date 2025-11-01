use kc_api_interface::interface::EmitData;

use kc_api_dto::endpoints::api_req_hokyu::*;

use crate::{register_trait, TraitForConvert};

register_trait!(Req, (charge));
// register_trait!(Res, ());

impl TraitForConvert for charge::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        // let materials: Materials = Materials::from(self.api_data.clone());
        // let ships: Ships = Ships::from(self.api_data.clone());
        // Some(vec![
        //     EmitData::Add(Add::Ships(ships)),
        //     EmitData::Add(Add::Materials(materials))])
        Some(vec![])
    }
}
