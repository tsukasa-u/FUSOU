pub mod convert_trait;
pub mod from_trait;

// Re-export set_member_id_salt for configuration
pub use from_trait::deck_port::set_member_id_salt;

pub struct InterfaceWrapper<T>(T);
impl<T> InterfaceWrapper<T> {
    pub fn unwrap(self) -> T {
        self.0
    }
}

pub trait TraitForConvert {
    type Output;
    fn convert(&self) -> Option<Vec<Self::Output>> {
        None
    }
}

#[macro_export]
macro_rules! register_trait {
    ($ident2:ident, ($($ident1:ident),*)) => {$(impl TraitForConvert for $ident1::$ident2 {
        type Output = EmitData;
        fn convert(&self) -> Option<Vec<EmitData>> {
            Some(vec![])
        }
    })*};
}
