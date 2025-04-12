use apache_avro::{AvroSchema, Codec, Error, Writer};
use register_trait::TraitForEncode;
use serde::Serialize;

pub fn encode<T>(data: Vec<T>) -> Result<Vec<u8>, Error>
where
    T: TraitForEncode + AvroSchema + Serialize,
{
    let schema = T::get_schema();
    let mut writer = Writer::with_codec(&schema, Vec::new(), Codec::Deflate);
    writer.append_ser(data)?;
    writer.into_inner()
}
