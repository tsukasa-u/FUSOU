use apache_avro::{from_value, AvroSchema, Error, Reader};
use register_trait::TraitForDecode;
use serde::Deserialize;

pub fn decode<T>(datas: Vec<u8>) -> Result<Vec<T>, Error>
where
    T: TraitForDecode + AvroSchema + for<'de> Deserialize<'de>,
{
    let schema = T::get_schema();
    let mut reader = Reader::with_schema(&schema, &datas[..])?;
    let mut result = Vec::new();

    while let Some(Ok(record)) = reader.next() {
        result.push(record);
    }

    let from_value_result: Result<Vec<T>, Error> = result
        .into_iter()
        .map(|value| from_value::<T>(&value))
        .collect();

    from_value_result
}
