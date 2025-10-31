pub mod convert_trait;
pub mod from_trait;

pub struct InterfaceWrapper<T>(T);
impl<T> InterfaceWrapper<T> {
    pub fn unwrap(self) -> T {
        self.0
    }
}

pub trait TraitForConvert {
    type Output;
    fn convert(&self) -> Option<Vec<Self::Output>> {
        return None;
    }
}
