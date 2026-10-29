use crate::{JsonCursor, ParserLimits, VerifierError};
use serde_json::Value;

#[derive(Clone, Copy, Debug)]
pub struct JsonLimits {
    pub max_bytes: usize,
    pub max_nodes: usize,
    pub max_depth: usize,
    pub max_string_bytes: usize,
}

pub fn parse_json(bytes: &[u8], limits: JsonLimits) -> Result<Value, VerifierError> {
    if limits.max_bytes == 0
        || limits.max_nodes == 0
        || limits.max_depth == 0
        || limits.max_depth > crate::MAX_JSON_DEPTH
        || limits.max_string_bytes == 0
        || bytes.len() > limits.max_bytes
    {
        return Err(VerifierError::LimitExceeded("JSON limits/bytes"));
    }
    std::str::from_utf8(bytes).map_err(|_| VerifierError::InvalidJson("invalid UTF-8"))?;
    let mut position = 0;
    let mut depth = 0_usize;
    let mut nodes = 0_usize;
    while let Some(&byte) = bytes.get(position) {
        match byte {
            b'"' => {
                position += 1;
                let start = position;
                while let Some(&next) = bytes.get(position) {
                    if next == b'"' {
                        break;
                    }
                    if next == b'\\' {
                        position += 1;
                    }
                    position += 1;
                }
                if position >= bytes.len() || position - start > limits.max_string_bytes {
                    return Err(VerifierError::LimitExceeded("JSON raw string bytes"));
                }
                nodes += 1;
            }
            b'{' | b'[' => {
                depth += 1;
                nodes += 1;
                if depth > limits.max_depth {
                    return Err(VerifierError::LimitExceeded("JSON depth"));
                }
            }
            b'}' | b']' => {
                depth = depth
                    .checked_sub(1)
                    .ok_or(VerifierError::InvalidJson("unbalanced container"))?;
            }
            b' ' | b'\t' | b'\r' | b'\n' | b',' | b':' => {}
            _ => {
                nodes += 1;
                while bytes.get(position + 1).is_some_and(|next| {
                    !matches!(next, b' ' | b'\t' | b'\r' | b'\n' | b',' | b':' | b'}' | b']')
                }) {
                    position += 1;
                }
            }
        }
        if nodes > limits.max_nodes {
            return Err(VerifierError::LimitExceeded("JSON nodes"));
        }
        position += 1;
    }
    if depth != 0 {
        return Err(VerifierError::InvalidJson("unbalanced container"));
    }
    let cursor_limits = ParserLimits {
        json_depth: limits.max_depth,
        game_json_string_bytes: limits.max_string_bytes,
        ..ParserLimits::default()
    };
    let mut cursor = JsonCursor::new(bytes, &cursor_limits);
    cursor.skip_value(0)?;
    cursor.skip_whitespace();
    if cursor.position != bytes.len() {
        return Err(VerifierError::InvalidJson("trailing JSON bytes"));
    }
    serde_json::from_slice(bytes).map_err(|_| VerifierError::InvalidJson("invalid JSON value"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limits() -> JsonLimits {
        JsonLimits { max_bytes: 4096, max_nodes: 64, max_depth: 8, max_string_bytes: 128 }
    }

    #[test]
    fn rejects_duplicate_decoded_keys_and_invalid_grammar() {
        for raw in [
            br#"{"x":1,"x":2}"#.as_slice(),
            br#"{"outer":{"x":1,"\u0078":2}}"#,
            br#"{"x":"\q"}"#,
            br#"{"x":"\ud800"}"#,
            br#"{} trailing"#,
            b"{\"x\":\"\xff\"}",
        ] {
            assert!(parse_json(raw, limits()).is_err());
        }
        assert!(parse_json(br#"{"x":"\"x\":","nested":[{},{"x":2}]}"#, limits()).is_ok());
    }

    #[test]
    fn checks_structural_limits_before_value_construction() {
        assert!(parse_json(b"[[]]", JsonLimits { max_depth: 1, ..limits() }).is_err());
        assert!(parse_json(b"[0,1]", JsonLimits { max_nodes: 2, ..limits() }).is_err());
        assert!(parse_json(br#""long""#, JsonLimits { max_string_bytes: 3, ..limits() }).is_err());
        assert!(parse_json(b"{}", JsonLimits { max_bytes: 1, ..limits() }).is_err());
    }
}
