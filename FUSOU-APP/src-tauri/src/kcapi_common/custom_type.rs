use register_trait::{Getter, TraitForTest, LogMapNumberSize};
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DuoType<S, T> {
    Type1(S),
    Type2(T),
}

impl<S, T> TraitForTest for DuoType<S, T> {}

impl <S, T> Default for DuoType<S, T> where  S: Default {
    fn default() -> Self {
        DuoType::Type1(Default::default())
    }
}


impl<S, T> Getter for DuoType<S, T> where S: Getter, T: Getter {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        match self {
            DuoType::Type1(v) => v.check_number(log_map, key),
            DuoType::Type2(v) => v.check_number(log_map, key),
        }
    }
}