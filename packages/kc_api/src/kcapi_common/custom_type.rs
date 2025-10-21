use register_trait::{LogMapNumberSize, NumberSizeChecker, TraitForTest};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DuoType<S, T> {
    Type1(S),
    Type2(T),
}

impl<S, T> TraitForTest for DuoType<S, T> {}

impl<S, T> Default for DuoType<S, T>
where
    S: Default,
{
    fn default() -> Self {
        DuoType::Type1(Default::default())
    }
}

impl<S, T> NumberSizeChecker for DuoType<S, T>
where
    S: NumberSizeChecker,
    T: NumberSizeChecker,
{
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        match self {
            DuoType::Type1(v) => v.check_number(log_map, key),
            DuoType::Type2(v) => v.check_number(log_map, key),
        }
    }
}
