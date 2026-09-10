use register_trait::{FieldSizeChecker, LogMapNumberSize, TraitForTest};
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

impl<S, T> FieldSizeChecker for DuoType<S, T>
where
    S: FieldSizeChecker,
    T: FieldSizeChecker,
{
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        match self {
            DuoType::Type1(v) => v.check_number(log_map, key),
            DuoType::Type2(v) => v.check_number(log_map, key),
        }
    }
}
impl<S: std::fmt::Display, T: std::fmt::Display> std::fmt::Display for DuoType<S, T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DuoType::Type1(v) => write!(f, "{}", v),
            DuoType::Type2(v) => write!(f, "{}", v),
        }
    }
}

impl<S: std::str::FromStr, T: std::str::FromStr> std::str::FromStr for DuoType<S, T> {
    type Err = T::Err;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if let Ok(val) = s.parse::<S>() {
            Ok(DuoType::Type1(val))
        } else {
            s.parse::<T>().map(DuoType::Type2)
        }
    }
}
