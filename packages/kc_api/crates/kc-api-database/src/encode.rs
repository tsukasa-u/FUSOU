use apache_avro::{AvroSchema, Codec, Error, Schema, Writer};
use register_trait::TraitForEncode;
use serde::Serialize;
use sha2::{Digest, Sha256};

/// Encode `datas` as Avro OCF with a **deterministic** sync marker.
///
/// `apache_avro::Writer` generates a fresh random 16-byte sync marker on
/// every call, so identical input data produces different bytes (and a
/// different SHA-256 hash) each time.  This breaks content-hash dedup on
/// the server side.
///
/// Fix: after encoding, parse the header to discover the random marker,
/// then replace every occurrence of it with a deterministic value derived
/// from the schema JSON (SHA-256 of schema → first 16 bytes).  The
/// replacement is binary-safe because the file format guarantees that the
/// sync marker only appears after data-block payloads.
pub fn encode<T>(datas: Vec<T>) -> Result<Vec<u8>, Error>
where
    T: TraitForEncode + AvroSchema + Serialize,
{
    let schema = T::get_schema();
    let mut writer = Writer::with_codec(&schema, Vec::new(), Codec::Null);

    for data in datas {
        writer.append_ser(data)?;
    }
    let mut bytes = writer.into_inner()?;

    // Replace the random sync marker with a schema-derived deterministic one.
    fix_sync_marker(&mut bytes, &schema);

    Ok(bytes)
}

/// Derive a 16-byte deterministic sync marker from the schema JSON.
fn deterministic_marker(schema: &Schema) -> [u8; 16] {
    // serde_json serialisation of the Schema enum is deterministic for a
    // given schema definition, so the marker is stable across processes.
    let schema_json = serde_json::to_string(schema).unwrap_or_default();
    let hash = Sha256::digest(schema_json.as_bytes());
    hash[..16].try_into().expect("SHA-256 is always >= 16 bytes")
}

/// Replace the Writer-generated random sync marker with a deterministic one.
///
/// Avro OCF layout:
///   [magic: 4 bytes] [metadata map: variable] [sync marker: 16 bytes]
///   ([block count] [block size] [records] [sync marker: 16 bytes])*
///
/// All occurrences of the 16-byte random marker are replaced in-place.
fn fix_sync_marker(data: &mut Vec<u8>, schema: &Schema) {
    let Some(marker_pos) = find_sync_marker_pos(data) else {
        // Not a valid Avro OCF file – leave untouched.
        return;
    };
    if marker_pos + 16 > data.len() {
        return;
    }

    let mut random_marker = [0u8; 16];
    random_marker.copy_from_slice(&data[marker_pos..marker_pos + 16]);

    let det_marker = deterministic_marker(schema);

    // Replace every occurrence of the random 16-byte marker.
    let mut i = 0;
    while i + 16 <= data.len() {
        if data[i..i + 16] == random_marker {
            data[i..i + 16].copy_from_slice(&det_marker);
            i += 16; // skip past this occurrence
        } else {
            i += 1;
        }
    }
}

/// Parse the Avro OCF header to find the byte offset of the sync marker.
///
/// Returns `None` if the data is not a recognisable Avro OCF file.
fn find_sync_marker_pos(data: &[u8]) -> Option<usize> {
    // Magic bytes: "Obj\x01"
    if data.len() < 5 || &data[..4] != b"Obj\x01" {
        return None;
    }

    let mut pos = 4usize;

    // The metadata is encoded as an Avro map: one or more blocks, each
    // starting with a zigzag long count, followed by that many key-value
    // pairs, terminated by a block with count = 0.
    loop {
        let (count, n) = decode_zigzag_long(&data[pos..])?;
        pos += n;

        if count == 0 {
            break; // End of map
        }

        let abs_count = if count < 0 {
            // Negative count: absolute value is number of entries;
            // the next long is the byte size of the block (skip it).
            let (_, m) = decode_zigzag_long(&data[pos..])?;
            pos += m;
            (-count) as usize
        } else {
            count as usize
        };

        for _ in 0..abs_count {
            // Key: Avro string = zigzag length + UTF-8 bytes
            let (key_len, kn) = decode_zigzag_long(&data[pos..])?;
            if key_len < 0 {
                return None;
            }
            pos += kn + key_len as usize;

            // Value: Avro bytes = zigzag length + raw bytes
            let (val_len, vn) = decode_zigzag_long(&data[pos..])?;
            if val_len < 0 {
                return None;
            }
            pos += vn + val_len as usize;
        }
    }

    Some(pos) // The 16-byte sync marker starts here
}

/// Decode a variable-length zigzag-encoded `i64` from `buf`.
///
/// Returns `(value, bytes_consumed)` or `None` on premature EOF / overflow.
fn decode_zigzag_long(buf: &[u8]) -> Option<(i64, usize)> {
    let mut acc: u64 = 0;
    let mut shift = 0u32;
    let mut i = 0usize;

    loop {
        if i >= buf.len() {
            return None; // Unexpected EOF
        }
        let byte = buf[i] as u64;
        i += 1;
        acc |= (byte & 0x7F) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift >= 64 {
            return None; // Varint too long
        }
    }

    // Zig-zag decode: (n >>> 1) XOR -(n & 1)
    let value = ((acc >> 1) as i64) ^ (-((acc & 1) as i64));
    Some((value, i))
}
