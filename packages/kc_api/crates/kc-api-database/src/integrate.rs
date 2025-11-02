use apache_avro::{AvroSchema, Error};
use register_trait::{TraitForDecode, TraitForEncode};
use serde::{Deserialize, Serialize};

use crate::{decode, encode};

pub fn integrate<T>(datas: Vec<Vec<u8>>) -> Result<Vec<u8>, Error>
where
    T: TraitForEncode + TraitForDecode + AvroSchema + Serialize + for<'de> Deserialize<'de>,
{
    let decode_result = datas
        .into_iter()
        .map(|data| decode::decode::<T>(data))
        .collect::<Result<Vec<_>, _>>()?;

    let merged_data = decode_result.into_iter().flatten().collect::<Vec<T>>();

    encode::encode::<T>(merged_data)
}
