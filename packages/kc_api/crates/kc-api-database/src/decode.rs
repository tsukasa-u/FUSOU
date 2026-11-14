use apache_avro::{from_value, AvroSchema, Error, Reader};
use register_trait::TraitForDecode;
use serde::Deserialize;

pub fn decode<T>(datas: Vec<u8>) -> Result<Vec<T>, Error>
where
    T: TraitForDecode + AvroSchema + for<'de> Deserialize<'de>,
{
    let schema = T::get_schema();
    let reader = Reader::with_schema(&schema, &datas[..])?;
    let mut result = Vec::new();

    for record_res in reader {
        let record =
            record_res.map_err(|e| {
                <Error as serde::de::Error>::custom(format!("Avro block decode error: {e}"))
            })?;
        result.push(from_value::<T>(&record)?);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::decode;
    use apache_avro::{types::Value, AvroSchema, Writer};
    use register_trait::TraitForDecode;
    use serde::Deserialize;

    #[derive(AvroSchema, Deserialize)]
    struct DecodeTestRecord {
        value: i64,
    }

    impl TraitForDecode for DecodeTestRecord {}

    #[test]
    fn corrupted_block_sync_marker_returns_an_error() {
        let schema = DecodeTestRecord::get_schema();
        let mut writer = Writer::new(&schema, Vec::new());
        writer
            .append(Value::Record(vec![("value".to_owned(), Value::Long(42))]))
            .unwrap();
        let encoded = writer.into_inner().unwrap();
        let decoded = decode::<DecodeTestRecord>(encoded.clone()).unwrap();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].value, 42);

        let mut corrupted = encoded;
        *corrupted.last_mut().unwrap() ^= 0xff;
        assert!(decode::<DecodeTestRecord>(corrupted).is_err());
    }
}
