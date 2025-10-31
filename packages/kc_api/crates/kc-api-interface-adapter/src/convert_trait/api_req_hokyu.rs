use crate::TraitForConvert;

impl TraitForConvert for Res {
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

pub struct InterfaceWrapper<T>(T);

impl<T> TraitForConvert for InterfaceWrapper<T> {
    fn unwrap(self) -> T {
        self.0
    }
}
