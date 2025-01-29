use register_trait::TraitForTest;
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