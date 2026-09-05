#![forbid(unsafe_code)]

pub mod prover_transport;
pub mod tlsn_alpha15;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use std::{fmt::Write as _, io::Read};
use thiserror::Error;
use uuid::Uuid;

pub const PROFILE_ID: &str = "fusou-require-info-v1";
pub const ISSUER: &str = "fusou-tlsn-verifier";
pub const PROOF_PURPOSE: &str = "GAME_ACCOUNT_IDENTITY_V1";
pub const BINDING_HEADER: &str = "X-FUSOU-Attestation-Binding";
pub const REQUIRE_INFO_TARGET: &str = "/kcsapi/api_get_member/require_info";
pub const BINDING_PREFIX: &[u8] = b"FUSOU-ATTESTATION-BINDING-V1\0";
pub const SIGNING_DOMAIN: &[u8] = b"FUSOU-VERIFIER-RESULT-V1\0";

pub const MAX_VERIFIER_RESULT_JSON_BYTES: usize = 25_165_824;
pub const MAX_REQUEST_TRANSCRIPT_BYTES: usize = 512_000;
pub const MAX_RESPONSE_TRANSCRIPT_BYTES: usize = 16_777_216;
pub const MAX_HTTP_HEADER_BYTES: usize = 65_536;
pub const MAX_HTTP_HEADER_COUNT: usize = 128;
pub const MAX_DECOMPRESSED_BODY_BYTES: usize = 16_777_216;
pub const MAX_JSON_DEPTH: usize = 64;
pub const MAX_GAME_JSON_STRING_BYTES: usize = 1_048_576;
pub const MAX_ATTESTATION_ID_BYTES: usize = 16;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum VerifierError {
    #[error("invalid strict base64url")]
    InvalidBase64,
    #[error("invalid canonical UInt64 decimal")]
    InvalidUInt64,
    #[error("resource limit exceeded: {0}")]
    LimitExceeded(&'static str),
    #[error("invalid range: {0}")]
    InvalidRange(&'static str),
    #[error("invalid HTTP transcript: {0}")]
    InvalidHttp(&'static str),
    #[error("invalid JSON transcript: {0}")]
    InvalidJson(&'static str),
    #[error("invalid binding value: {0}")]
    InvalidBinding(&'static str),
    #[error("invalid Verifier Result: {0}")]
    InvalidResult(&'static str),
    #[error("Verifier Result is not canonical JSON")]
    NonCanonicalResult,
}

pub type Result<T> = std::result::Result<T, VerifierError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParserLimits {
    pub request_transcript_bytes: usize,
    pub response_transcript_bytes: usize,
    pub verifier_result_json_bytes: usize,
    pub http_header_bytes: usize,
    pub http_header_count: usize,
    pub decompressed_body_bytes: usize,
    pub json_depth: usize,
    pub game_json_string_bytes: usize,
}

impl Default for ParserLimits {
    fn default() -> Self {
        Self {
            request_transcript_bytes: MAX_REQUEST_TRANSCRIPT_BYTES,
            response_transcript_bytes: MAX_RESPONSE_TRANSCRIPT_BYTES,
            verifier_result_json_bytes: MAX_VERIFIER_RESULT_JSON_BYTES,
            http_header_bytes: MAX_HTTP_HEADER_BYTES,
            http_header_count: MAX_HTTP_HEADER_COUNT,
            decompressed_body_bytes: MAX_DECOMPRESSED_BODY_BYTES,
            json_depth: MAX_JSON_DEPTH,
            game_json_string_bytes: MAX_GAME_JSON_STRING_BYTES,
        }
    }
}

pub fn decode_strict_base64url(value: &str) -> Result<Vec<u8>> {
    if !value.is_ascii() || value.contains('=') {
        return Err(VerifierError::InvalidBase64);
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(value.as_bytes())
        .map_err(|_| VerifierError::InvalidBase64)?;
    if URL_SAFE_NO_PAD.encode(&decoded) != value {
        return Err(VerifierError::InvalidBase64);
    }
    Ok(decoded)
}

pub fn parse_uint64_decimal(value: &str) -> Result<u64> {
    if value.is_empty() || !value.is_ascii() || value.len() > 20 {
        return Err(VerifierError::InvalidUInt64);
    }
    if value == "0" {
        return Ok(0);
    }
    if value.starts_with('0') || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(VerifierError::InvalidUInt64);
    }
    value.parse().map_err(|_| VerifierError::InvalidUInt64)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevealedRange {
    pub start: u64,
    pub length: u64,
    pub bytes: Vec<u8>,
}

pub fn validate_ranges(ranges: &[RevealedRange], transcript_size: u64) -> Result<()> {
    if ranges.len() > u32::MAX as usize {
        return Err(VerifierError::InvalidRange("too many ranges"));
    }
    let mut previous_start = None;
    let mut previous_end = None;
    for range in ranges {
        if range.length == 0 {
            return Err(VerifierError::InvalidRange("range length must be positive"));
        }
        let end = range
            .start
            .checked_add(range.length)
            .ok_or(VerifierError::InvalidRange("range end overflows UInt64"))?;
        if end > transcript_size {
            return Err(VerifierError::InvalidRange("range exceeds transcript size"));
        }
        if u64::try_from(range.bytes.len()).unwrap_or(u64::MAX) != range.length {
            return Err(VerifierError::InvalidRange(
                "decoded range length does not match length field",
            ));
        }
        if let Some(start) = previous_start {
            if range.start <= start {
                return Err(VerifierError::InvalidRange(
                    "range starts are not strictly ascending",
                ));
            }
        }
        if let Some(end_before) = previous_end {
            if end_before > range.start {
                return Err(VerifierError::InvalidRange("ranges overlap"));
            }
        }
        previous_start = Some(range.start);
        previous_end = Some(end);
    }
    Ok(())
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    let digest = Sha256::digest(bytes);
    let mut output = [0_u8; 32];
    output.copy_from_slice(&digest);
    output
}

pub fn verify_transcript_digest(
    transcript: &[u8],
    expected_size: u64,
    expected_sha256: &[u8; 32],
    ranges: &[RevealedRange],
) -> Result<()> {
    if u64::try_from(transcript.len()).unwrap_or(u64::MAX) != expected_size {
        return Err(VerifierError::InvalidRange(
            "transcript size does not match",
        ));
    }
    if sha256(transcript) != *expected_sha256 {
        return Err(VerifierError::InvalidRange(
            "transcript digest does not match",
        ));
    }
    validate_ranges(ranges, expected_size)?;
    for range in ranges {
        let start = usize::try_from(range.start)
            .map_err(|_| VerifierError::InvalidRange("range start does not fit usize"))?;
        let end = start
            .checked_add(range.bytes.len())
            .ok_or(VerifierError::InvalidRange("range end does not fit usize"))?;
        if transcript.get(start..end) != Some(range.bytes.as_slice()) {
            return Err(VerifierError::InvalidRange(
                "revealed bytes do not match transcript",
            ));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedRequireInfo {
    pub verified_member_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedBinding {
    pub session_id: Uuid,
    pub binding_nonce: [u8; 32],
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedRequireInfoRequest {
    pub binding: ParsedBinding,
}

pub fn parse_binding_value(value: &str) -> Result<ParsedBinding> {
    let bytes = decode_strict_base64url(value)
        .map_err(|_| VerifierError::InvalidBinding("binding is not strict base64url"))?;
    let expected_len = BINDING_PREFIX.len() + 2 + 16 + 2 + 32;
    if bytes.len() != expected_len || !bytes.starts_with(BINDING_PREFIX) {
        return Err(VerifierError::InvalidBinding("binding has invalid framing"));
    }
    let mut cursor = BINDING_PREFIX.len();
    let session_len = u16::from_be_bytes([bytes[cursor], bytes[cursor + 1]]);
    cursor += 2;
    if session_len != 16 {
        return Err(VerifierError::InvalidBinding("session ID length is not 16"));
    }
    let session_id = Uuid::from_slice(&bytes[cursor..cursor + 16])
        .map_err(|_| VerifierError::InvalidBinding("session ID is invalid"))?;
    if session_id.get_version_num() != 4 {
        return Err(VerifierError::InvalidBinding("session ID is not UUIDv4"));
    }
    cursor += 16;
    let nonce_len = u16::from_be_bytes([bytes[cursor], bytes[cursor + 1]]);
    cursor += 2;
    if nonce_len != 32 {
        return Err(VerifierError::InvalidBinding("nonce length is not 32"));
    }
    let mut binding_nonce = [0_u8; 32];
    binding_nonce.copy_from_slice(&bytes[cursor..cursor + 32]);
    Ok(ParsedBinding {
        session_id,
        binding_nonce,
        value: value.to_owned(),
    })
}

#[derive(Debug, Clone)]
struct Header {
    name: Vec<u8>,
    value: Vec<u8>,
    raw_value: Vec<u8>,
}

fn is_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'!' | b'#'
                | b'$'
                | b'%'
                | b'&'
                | b'\''
                | b'*'
                | b'+'
                | b'-'
                | b'.'
                | b'^'
                | b'_'
                | b'`'
                | b'|'
                | b'~'
        )
}

fn find_crlf(bytes: &[u8], start: usize) -> Option<usize> {
    bytes[start..]
        .windows(2)
        .position(|window| window == b"\r\n")
        .map(|offset| start + offset)
}

fn trim_ows(bytes: &[u8]) -> &[u8] {
    let mut start = 0;
    let mut end = bytes.len();
    while start < end && matches!(bytes[start], b' ' | b'\t') {
        start += 1;
    }
    while end > start && matches!(bytes[end - 1], b' ' | b'\t') {
        end -= 1;
    }
    &bytes[start..end]
}

fn parse_message_head(
    raw: &[u8],
    expected_start_line: &[u8],
    limits: &ParserLimits,
) -> Result<(Vec<Header>, usize)> {
    if raw.len()
        > limits
            .response_transcript_bytes
            .max(limits.request_transcript_bytes)
    {
        return Err(VerifierError::LimitExceeded("transcript bytes"));
    }
    let first_end = find_crlf(raw, 0).ok_or(VerifierError::InvalidHttp("missing start line"))?;
    if &raw[..first_end] != expected_start_line {
        return Err(VerifierError::InvalidHttp("unexpected start line"));
    }
    let mut cursor = first_end + 2;
    let mut headers = Vec::new();
    loop {
        let line_end = find_crlf(raw, cursor).ok_or(VerifierError::InvalidHttp(
            "header line is not CRLF terminated",
        ))?;
        if line_end == cursor {
            let header_end = cursor + 2;
            if header_end > limits.http_header_bytes {
                return Err(VerifierError::LimitExceeded("HTTP header bytes"));
            }
            return Ok((headers, header_end));
        }
        if headers.len() == limits.http_header_count {
            return Err(VerifierError::LimitExceeded("HTTP header count"));
        }
        let line = &raw[cursor..line_end];
        let colon = line
            .iter()
            .position(|byte| *byte == b':')
            .ok_or(VerifierError::InvalidHttp("header has no colon"))?;
        if colon == 0
            || line[..colon].iter().any(|byte| !is_token_byte(*byte))
            || line[colon - 1].is_ascii_whitespace()
        {
            return Err(VerifierError::InvalidHttp("invalid header name"));
        }
        let raw_value = line[colon + 1..].to_vec();
        if raw_value
            .iter()
            .any(|byte| (*byte < 0x20 && !matches!(byte, b' ' | b'\t')) || *byte == 0x7f)
        {
            return Err(VerifierError::InvalidHttp("invalid header value"));
        }
        headers.push(Header {
            name: line[..colon].to_ascii_lowercase(),
            value: trim_ows(&raw_value).to_vec(),
            raw_value,
        });
        cursor = line_end + 2;
        if cursor > limits.http_header_bytes {
            return Err(VerifierError::LimitExceeded("HTTP header bytes"));
        }
    }
}

fn header_values<'a>(headers: &'a [Header], name: &[u8]) -> Vec<&'a Header> {
    headers
        .iter()
        .filter(|header| header.name == name)
        .collect()
}

fn ascii_case_insensitive_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
}

fn parse_ascii_u64(bytes: &[u8]) -> Result<u64> {
    let value = std::str::from_utf8(bytes).map_err(|_| VerifierError::InvalidUInt64)?;
    parse_uint64_decimal(value)
}

fn parse_framed_body(headers: &[Header], body: &[u8], max_body: usize) -> Result<Vec<u8>> {
    let content_lengths = header_values(headers, b"content-length");
    let transfer_encodings = header_values(headers, b"transfer-encoding");
    if content_lengths.len() > 1 || transfer_encodings.len() > 1 {
        return Err(VerifierError::InvalidHttp("duplicate framing header"));
    }
    if !content_lengths.is_empty() && !transfer_encodings.is_empty() {
        return Err(VerifierError::InvalidHttp(
            "Content-Length and Transfer-Encoding are both present",
        ));
    }
    if content_lengths.len() == 1 {
        let length = parse_ascii_u64(&content_lengths[0].value)
            .map_err(|_| VerifierError::InvalidHttp("invalid Content-Length"))?;
        let length = usize::try_from(length)
            .map_err(|_| VerifierError::InvalidHttp("Content-Length does not fit usize"))?;
        if length > max_body || body.len() != length {
            return Err(VerifierError::InvalidHttp(
                "Content-Length does not match body",
            ));
        }
        return Ok(body.to_vec());
    }
    if transfer_encodings.len() == 1 {
        if !ascii_case_insensitive_eq(&transfer_encodings[0].value, b"chunked") {
            return Err(VerifierError::InvalidHttp("unsupported transfer coding"));
        }
        return decode_chunked(body, max_body);
    }
    Err(VerifierError::InvalidHttp("missing body framing"))
}

fn decode_chunked(body: &[u8], max_body: usize) -> Result<Vec<u8>> {
    let mut cursor = 0;
    let mut decoded = Vec::new();
    loop {
        let line_end = find_crlf(body, cursor).ok_or(VerifierError::InvalidHttp(
            "chunk size is not CRLF terminated",
        ))?;
        let size_line = &body[cursor..line_end];
        if size_line.is_empty()
            || size_line.len() > 16
            || !size_line.iter().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(VerifierError::InvalidHttp("invalid chunk size"));
        }
        let size = u64::from_str_radix(
            std::str::from_utf8(size_line)
                .map_err(|_| VerifierError::InvalidHttp("invalid chunk size"))?,
            16,
        )
        .map_err(|_| VerifierError::InvalidHttp("invalid chunk size"))?;
        cursor = line_end + 2;
        let size = usize::try_from(size)
            .map_err(|_| VerifierError::InvalidHttp("chunk size does not fit usize"))?;
        if size == 0 {
            if body.get(cursor..) != Some(b"\r\n") {
                return Err(VerifierError::InvalidHttp("chunk trailers are not allowed"));
            }
            return Ok(decoded);
        }
        let end = cursor
            .checked_add(size)
            .and_then(|value| value.checked_add(2))
            .ok_or(VerifierError::InvalidHttp("chunk body overflows"))?;
        if end > body.len() || &body[cursor + size..end] != b"\r\n" {
            return Err(VerifierError::InvalidHttp(
                "chunk body is not CRLF terminated",
            ));
        }
        if decoded.len().saturating_add(size) > max_body {
            return Err(VerifierError::LimitExceeded("decompressed body bytes"));
        }
        decoded.extend_from_slice(&body[cursor..cursor + size]);
        cursor = end;
    }
}

struct OneByteReader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl Read for OneByteReader<'_> {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if self.position == self.bytes.len() || output.is_empty() {
            return Ok(0);
        }
        output[0] = self.bytes[self.position];
        self.position += 1;
        Ok(1)
    }
}

fn read_limited<R: Read>(reader: &mut R, max_bytes: usize) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|_| VerifierError::InvalidHttp("gzip decoding failed"))?;
        if count == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(count) > max_bytes {
            return Err(VerifierError::LimitExceeded("decompressed body bytes"));
        }
        output.extend_from_slice(&buffer[..count]);
    }
}

fn decode_content_encoding(headers: &[Header], body: &[u8], max_body: usize) -> Result<Vec<u8>> {
    let encodings = header_values(headers, b"content-encoding");
    if encodings.len() > 1 {
        return Err(VerifierError::InvalidHttp("duplicate Content-Encoding"));
    }
    if encodings.is_empty() || ascii_case_insensitive_eq(&encodings[0].value, b"identity") {
        if body.len() > max_body {
            return Err(VerifierError::LimitExceeded("decompressed body bytes"));
        }
        return Ok(body.to_vec());
    }
    if !ascii_case_insensitive_eq(&encodings[0].value, b"gzip") {
        return Err(VerifierError::InvalidHttp("unsupported Content-Encoding"));
    }
    let reader = OneByteReader {
        bytes: body,
        position: 0,
    };
    let mut decoder = GzDecoder::new(reader);
    let decoded = read_limited(&mut decoder, max_body)?;
    let reader = decoder.into_inner();
    if reader.position != reader.bytes.len() {
        return Err(VerifierError::InvalidHttp("gzip has trailing bytes"));
    }
    Ok(decoded)
}

pub fn parse_require_info_request(
    raw: &[u8],
    expected_server_identity: &str,
    limits: &ParserLimits,
) -> Result<ParsedRequireInfoRequest> {
    validate_server_identity(expected_server_identity)?;
    if raw.len() > limits.request_transcript_bytes {
        return Err(VerifierError::LimitExceeded("request transcript bytes"));
    }
    let start_line = format!("POST {REQUIRE_INFO_TARGET} HTTP/1.1");
    let (headers, body_start) = parse_message_head(raw, start_line.as_bytes(), limits)?;
    let hosts = header_values(&headers, b"host");
    if hosts.len() != 1 || hosts[0].value != expected_server_identity.as_bytes() {
        return Err(VerifierError::InvalidHttp("Host does not match allowlist"));
    }
    let bindings: Vec<&Header> = headers
        .iter()
        .filter(|header| header.name == BINDING_HEADER.to_ascii_lowercase().as_bytes())
        .collect();
    if bindings.len() != 1 || bindings[0].name != BINDING_HEADER.as_bytes().to_ascii_lowercase() {
        return Err(VerifierError::InvalidHttp(
            "binding header cardinality is invalid",
        ));
    }
    let binding_header = bindings[0];
    let mut expected_raw = vec![b' '];
    expected_raw.extend_from_slice(&binding_header.value);
    if binding_header.raw_value != expected_raw {
        return Err(VerifierError::InvalidBinding(
            "binding header must use one leading ASCII space and no trailing OWS",
        ));
    }
    let binding_value = std::str::from_utf8(&binding_header.value)
        .map_err(|_| VerifierError::InvalidBinding("binding is not ASCII"))?;
    let binding = parse_binding_value(binding_value)?;
    let _body = parse_framed_body(
        &headers,
        &raw[body_start..],
        limits.request_transcript_bytes,
    )?;
    Ok(ParsedRequireInfoRequest { binding })
}

pub fn parse_require_info_response(raw: &[u8], limits: &ParserLimits) -> Result<ParsedRequireInfo> {
    if raw.len() > limits.response_transcript_bytes {
        return Err(VerifierError::LimitExceeded("response transcript bytes"));
    }
    let (headers, body_start) = parse_message_head(raw, b"HTTP/1.1 200 OK", limits)?;
    let framed = parse_framed_body(
        &headers,
        &raw[body_start..],
        limits.response_transcript_bytes,
    )?;
    let body = decode_content_encoding(&headers, &framed, limits.decompressed_body_bytes)?;
    if !body.starts_with(b"svdata=") {
        return Err(VerifierError::InvalidHttp(
            "body lacks exact svdata= prefix",
        ));
    }
    extract_member_id(&body[7..], limits)
}

#[derive(Debug, Clone)]
struct ParsedJsonString {
    value: String,
    had_escape: bool,
}

struct JsonCursor<'a> {
    bytes: &'a [u8],
    position: usize,
    limits: &'a ParserLimits,
}

impl<'a> JsonCursor<'a> {
    fn new(bytes: &'a [u8], limits: &'a ParserLimits) -> Self {
        Self {
            bytes,
            position: 0,
            limits,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.position).copied()
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\r' | b'\n')) {
            self.position += 1;
        }
    }

    fn expect_byte(&mut self, expected: u8) -> Result<()> {
        if self.peek() == Some(expected) {
            self.position += 1;
            Ok(())
        } else {
            Err(VerifierError::InvalidJson("unexpected JSON byte"))
        }
    }

    fn parse_string(&mut self) -> Result<ParsedJsonString> {
        self.expect_byte(b'"')?;
        let source_start = self.position;
        let mut value = String::new();
        let mut had_escape = false;
        loop {
            let byte = self
                .peek()
                .ok_or(VerifierError::InvalidJson("unterminated JSON string"))?;
            match byte {
                b'"' => {
                    self.position += 1;
                    return Ok(ParsedJsonString { value, had_escape });
                }
                b'\\' => {
                    had_escape = true;
                    self.position += 1;
                    self.parse_escape(&mut value)?;
                }
                byte if byte < 0x20 => {
                    return Err(VerifierError::InvalidJson("control byte in JSON string"));
                }
                byte if byte < 0x80 => {
                    value.push(byte as char);
                    self.position += 1;
                }
                _ => {
                    let character = std::str::from_utf8(&self.bytes[self.position..])
                        .map_err(|_| VerifierError::InvalidJson("invalid UTF-8 string"))?
                        .chars()
                        .next()
                        .ok_or(VerifierError::InvalidJson("invalid UTF-8 string"))?;
                    value.push(character);
                    self.position += character.len_utf8();
                }
            }
            if self.position - source_start > self.limits.game_json_string_bytes
                || value.len() > self.limits.game_json_string_bytes
            {
                return Err(VerifierError::LimitExceeded("JSON string bytes"));
            }
        }
    }

    fn parse_escape(&mut self, value: &mut String) -> Result<()> {
        let escape = self
            .peek()
            .ok_or(VerifierError::InvalidJson("truncated JSON escape"))?;
        self.position += 1;
        match escape {
            b'"' => value.push('"'),
            b'\\' => value.push('\\'),
            b'/' => value.push('/'),
            b'b' => value.push('\u{0008}'),
            b'f' => value.push('\u{000c}'),
            b'n' => value.push('\n'),
            b'r' => value.push('\r'),
            b't' => value.push('\t'),
            b'u' => {
                let high = self.parse_hex_quad()?;
                let character = if (0xD800..=0xDBFF).contains(&high) {
                    if self.bytes.get(self.position..self.position + 2) != Some(b"\\u") {
                        return Err(VerifierError::InvalidJson(
                            "unpaired high surrogate in JSON string",
                        ));
                    }
                    self.position += 2;
                    let low = self.parse_hex_quad()?;
                    if !(0xDC00..=0xDFFF).contains(&low) {
                        return Err(VerifierError::InvalidJson(
                            "invalid surrogate pair in JSON string",
                        ));
                    }
                    let scalar =
                        0x1_0000_u32 + (u32::from(high - 0xD800) << 10) + u32::from(low - 0xDC00);
                    char::from_u32(scalar)
                        .ok_or(VerifierError::InvalidJson("invalid Unicode scalar"))?
                } else if (0xDC00..=0xDFFF).contains(&high) {
                    return Err(VerifierError::InvalidJson(
                        "unpaired low surrogate in JSON string",
                    ));
                } else {
                    char::from_u32(high as u32)
                        .ok_or(VerifierError::InvalidJson("invalid Unicode scalar"))?
                };
                value.push(character);
            }
            _ => return Err(VerifierError::InvalidJson("invalid JSON escape")),
        }
        Ok(())
    }

    fn parse_hex_quad(&mut self) -> Result<u16> {
        let bytes = self
            .bytes
            .get(self.position..self.position + 4)
            .ok_or(VerifierError::InvalidJson("truncated Unicode escape"))?;
        if !bytes.iter().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(VerifierError::InvalidJson("invalid Unicode escape"));
        }
        self.position += 4;
        u16::from_str_radix(
            std::str::from_utf8(bytes)
                .map_err(|_| VerifierError::InvalidJson("invalid Unicode escape"))?,
            16,
        )
        .map_err(|_| VerifierError::InvalidJson("invalid Unicode escape"))
    }

    fn parse_number(&mut self) -> Result<&'a [u8]> {
        let start = self.position;
        if self.peek() == Some(b'-') {
            self.position += 1;
        }
        match self.peek() {
            Some(b'0') => self.position += 1,
            Some(byte @ b'1'..=b'9') => {
                let _ = byte;
                self.position += 1;
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.position += 1;
                }
            }
            _ => return Err(VerifierError::InvalidJson("invalid JSON number")),
        }
        if self.peek() == Some(b'.') {
            self.position += 1;
            let fraction_start = self.position;
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.position += 1;
            }
            if self.position == fraction_start {
                return Err(VerifierError::InvalidJson("invalid JSON number fraction"));
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.position += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.position += 1;
            }
            let exponent_start = self.position;
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.position += 1;
            }
            if self.position == exponent_start {
                return Err(VerifierError::InvalidJson("invalid JSON number exponent"));
            }
        }
        Ok(&self.bytes[start..self.position])
    }

    fn parse_literal(&mut self, literal: &[u8]) -> Result<()> {
        if self.bytes.get(self.position..self.position + literal.len()) == Some(literal) {
            self.position += literal.len();
            Ok(())
        } else {
            Err(VerifierError::InvalidJson("invalid JSON literal"))
        }
    }

    fn skip_value(&mut self, depth: usize) -> Result<()> {
        if depth > self.limits.json_depth {
            return Err(VerifierError::LimitExceeded("JSON depth"));
        }
        self.skip_whitespace();
        match self.peek() {
            Some(b'"') => {
                self.parse_string()?;
                Ok(())
            }
            Some(b'{') => self.skip_object(depth + 1),
            Some(b'[') => self.skip_array(depth + 1),
            Some(b't') => self.parse_literal(b"true"),
            Some(b'f') => self.parse_literal(b"false"),
            Some(b'n') => self.parse_literal(b"null"),
            Some(b'-' | b'0'..=b'9') => {
                self.parse_number()?;
                Ok(())
            }
            _ => Err(VerifierError::InvalidJson("invalid JSON value")),
        }
    }

    fn skip_object(&mut self, depth: usize) -> Result<()> {
        self.expect_byte(b'{')?;
        let mut keys = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(b'}') {
            self.position += 1;
            return Ok(());
        }
        loop {
            let key = self.parse_string()?;
            if keys.iter().any(|known: &String| known == &key.value) {
                return Err(VerifierError::InvalidJson("duplicate JSON object key"));
            }
            keys.push(key.value);
            self.skip_whitespace();
            self.expect_byte(b':')?;
            self.skip_value(depth)?;
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => {
                    self.position += 1;
                    self.skip_whitespace();
                }
                Some(b'}') => {
                    self.position += 1;
                    return Ok(());
                }
                _ => return Err(VerifierError::InvalidJson("invalid JSON object separator")),
            }
        }
    }

    fn skip_array(&mut self, depth: usize) -> Result<()> {
        self.expect_byte(b'[')?;
        self.skip_whitespace();
        if self.peek() == Some(b']') {
            self.position += 1;
            return Ok(());
        }
        loop {
            self.skip_value(depth)?;
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => {
                    self.position += 1;
                    self.skip_whitespace();
                }
                Some(b']') => {
                    self.position += 1;
                    return Ok(());
                }
                _ => return Err(VerifierError::InvalidJson("invalid JSON array separator")),
            }
        }
    }
}

fn target_key(key: &ParsedJsonString, expected: &str) -> Result<bool> {
    if key.value == expected && key.had_escape {
        return Err(VerifierError::InvalidJson(
            "target JSON key must not use an escape",
        ));
    }
    Ok(key.value == expected)
}

fn extract_member_id(json: &[u8], limits: &ParserLimits) -> Result<ParsedRequireInfo> {
    if json.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Err(VerifierError::InvalidJson("JSON BOM is not allowed"));
    }
    let mut cursor = JsonCursor::new(json, limits);
    cursor.expect_byte(b'{')?;
    let mut keys = Vec::new();
    let mut result_seen = false;
    let mut member_id = None;
    let mut data_seen = false;
    cursor.skip_whitespace();
    if cursor.peek() == Some(b'}') {
        return Err(VerifierError::InvalidJson(
            "required JSON members are missing",
        ));
    }
    loop {
        let key = cursor.parse_string()?;
        if keys.iter().any(|known: &String| known == &key.value) {
            return Err(VerifierError::InvalidJson("duplicate JSON object key"));
        }
        keys.push(key.value.clone());
        cursor.skip_whitespace();
        cursor.expect_byte(b':')?;
        cursor.skip_whitespace();
        if target_key(&key, "api_result")? {
            let token = cursor.parse_number()?;
            if token != b"1" {
                return Err(VerifierError::InvalidJson("api_result is not number 1"));
            }
            result_seen = true;
        } else if target_key(&key, "api_data")? {
            parse_api_data(&mut cursor, &mut member_id, limits)?;
            data_seen = true;
        } else {
            cursor.skip_value(1)?;
        }
        cursor.skip_whitespace();
        match cursor.peek() {
            Some(b',') => {
                cursor.position += 1;
                cursor.skip_whitespace();
            }
            Some(b'}') => {
                cursor.position += 1;
                break;
            }
            _ => return Err(VerifierError::InvalidJson("invalid root object separator")),
        }
    }
    if cursor.position != json.len() {
        return Err(VerifierError::InvalidJson(
            "trailing JSON bytes are not allowed",
        ));
    }
    if !result_seen || !data_seen {
        return Err(VerifierError::InvalidJson(
            "required JSON members are missing",
        ));
    }
    let verified_member_id =
        member_id.ok_or(VerifierError::InvalidJson("api_member_id is missing"))?;
    Ok(ParsedRequireInfo { verified_member_id })
}

fn parse_api_data(
    cursor: &mut JsonCursor<'_>,
    member_id: &mut Option<String>,
    limits: &ParserLimits,
) -> Result<()> {
    cursor.expect_byte(b'{')?;
    let mut keys = Vec::new();
    let mut basic_seen = false;
    cursor.skip_whitespace();
    if cursor.peek() == Some(b'}') {
        return Err(VerifierError::InvalidJson("api_basic is missing"));
    }
    loop {
        let key = cursor.parse_string()?;
        if keys.iter().any(|known: &String| known == &key.value) {
            return Err(VerifierError::InvalidJson("duplicate JSON object key"));
        }
        keys.push(key.value.clone());
        cursor.skip_whitespace();
        cursor.expect_byte(b':')?;
        cursor.skip_whitespace();
        if target_key(&key, "api_basic")? {
            parse_api_basic(cursor, member_id, limits)?;
            basic_seen = true;
        } else {
            cursor.skip_value(2)?;
        }
        cursor.skip_whitespace();
        match cursor.peek() {
            Some(b',') => {
                cursor.position += 1;
                cursor.skip_whitespace();
            }
            Some(b'}') => {
                cursor.position += 1;
                break;
            }
            _ => return Err(VerifierError::InvalidJson("invalid api_data separator")),
        }
    }
    if !basic_seen {
        return Err(VerifierError::InvalidJson("api_basic is missing"));
    }
    Ok(())
}

fn parse_api_basic(
    cursor: &mut JsonCursor<'_>,
    member_id: &mut Option<String>,
    _limits: &ParserLimits,
) -> Result<()> {
    cursor.expect_byte(b'{')?;
    let mut keys = Vec::new();
    let mut member_seen = false;
    cursor.skip_whitespace();
    if cursor.peek() == Some(b'}') {
        return Err(VerifierError::InvalidJson("api_member_id is missing"));
    }
    loop {
        let key = cursor.parse_string()?;
        if keys.iter().any(|known: &String| known == &key.value) {
            return Err(VerifierError::InvalidJson("duplicate JSON object key"));
        }
        keys.push(key.value.clone());
        cursor.skip_whitespace();
        cursor.expect_byte(b':')?;
        cursor.skip_whitespace();
        if target_key(&key, "api_member_id")? {
            let token = cursor.parse_number()?;
            if token.len() > 16
                || token.is_empty()
                || token[0] == b'0'
                || !token.iter().all(|byte| byte.is_ascii_digit())
            {
                return Err(VerifierError::InvalidJson(
                    "api_member_id is not a canonical decimal number",
                ));
            }
            *member_id = Some(
                std::str::from_utf8(token)
                    .map_err(|_| VerifierError::InvalidJson("api_member_id is not ASCII"))?
                    .to_owned(),
            );
            member_seen = true;
        } else {
            cursor.skip_value(3)?;
        }
        cursor.skip_whitespace();
        match cursor.peek() {
            Some(b',') => {
                cursor.position += 1;
                cursor.skip_whitespace();
            }
            Some(b'}') => {
                cursor.position += 1;
                break;
            }
            _ => return Err(VerifierError::InvalidJson("invalid api_basic separator")),
        }
    }
    if !member_seen {
        return Err(VerifierError::InvalidJson("api_member_id is missing"));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifierResult {
    pub version: u16,
    pub profile_id: String,
    pub profile_sha256: [u8; 32],
    pub issuer: String,
    pub proof_purpose: String,
    pub attestation_session_id: Uuid,
    pub binding_nonce: [u8; 32],
    pub binding_value: String,
    pub verifier_key_id: String,
    pub notary_key_id: String,
    pub tlsn_attestation_id: Vec<u8>,
    pub server_identity: String,
    pub request_transcript_size: u64,
    pub request_transcript_sha256: [u8; 32],
    pub response_transcript_size: u64,
    pub response_transcript_sha256: [u8; 32],
    pub revealed_request_ranges: Vec<RevealedRange>,
    pub revealed_response_ranges: Vec<RevealedRange>,
    pub signature: [u8; 64],
}

fn validate_ascii_string(value: &str, max_bytes: usize) -> Result<()> {
    if value.is_empty()
        || value.len() > max_bytes
        || !value.is_ascii()
        || value.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
    {
        return Err(VerifierError::InvalidResult("invalid ASCII string"));
    }
    Ok(())
}

fn validate_key_id(value: &str) -> Result<()> {
    if !(1..=64).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(VerifierError::InvalidResult("invalid key ID"));
    }
    Ok(())
}

pub fn validate_server_identity(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > 253 || !value.is_ascii() || value.ends_with('.') {
        return Err(VerifierError::InvalidResult("invalid server identity"));
    }
    for label in value.split('.') {
        if label.is_empty()
            || label.len() > 63
            || !label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || !label.as_bytes()[0].is_ascii_alphanumeric()
            || !label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
            || label.bytes().any(|byte| byte.is_ascii_uppercase())
        {
            return Err(VerifierError::InvalidResult("invalid server identity"));
        }
    }
    Ok(())
}

impl VerifierResult {
    pub fn validate(&self) -> Result<()> {
        if self.version != 1 {
            return Err(VerifierError::InvalidResult("unsupported version"));
        }
        if self.profile_id != PROFILE_ID {
            return Err(VerifierError::InvalidResult("unexpected profile ID"));
        }
        if self.issuer != ISSUER {
            return Err(VerifierError::InvalidResult("unexpected issuer"));
        }
        if self.proof_purpose != PROOF_PURPOSE {
            return Err(VerifierError::InvalidResult("unexpected proof purpose"));
        }
        if self.attestation_session_id.get_version_num() != 4 {
            return Err(VerifierError::InvalidResult("session ID is not UUIDv4"));
        }
        validate_ascii_string(&self.binding_value, 65_535)?;
        let binding = parse_binding_value(&self.binding_value)?;
        if binding.session_id != self.attestation_session_id
            || binding.binding_nonce != self.binding_nonce
        {
            return Err(VerifierError::InvalidResult(
                "binding fields do not match binding value",
            ));
        }
        validate_key_id(&self.verifier_key_id)?;
        validate_key_id(&self.notary_key_id)?;
        if self.tlsn_attestation_id.len() != MAX_ATTESTATION_ID_BYTES {
            return Err(VerifierError::InvalidResult(
                "attestation ID is not 16 bytes",
            ));
        }
        validate_server_identity(&self.server_identity)?;
        validate_ranges(&self.revealed_request_ranges, self.request_transcript_size)?;
        validate_ranges(
            &self.revealed_response_ranges,
            self.response_transcript_size,
        )?;
        Ok(())
    }

    pub fn canonical_json(&self) -> Result<String> {
        self.validate()?;
        let mut output = String::new();
        output.push('{');
        append_json_field(&mut output, "version", &self.version.to_string(), false);
        append_json_string_field(&mut output, "profile_id", &self.profile_id);
        append_json_string_field(
            &mut output,
            "profile_sha256",
            &URL_SAFE_NO_PAD.encode(self.profile_sha256),
        );
        append_json_string_field(&mut output, "issuer", &self.issuer);
        append_json_string_field(&mut output, "proof_purpose", &self.proof_purpose);
        append_json_string_field(
            &mut output,
            "attestation_session_id",
            &self.attestation_session_id.to_string(),
        );
        append_json_string_field(
            &mut output,
            "binding_nonce",
            &URL_SAFE_NO_PAD.encode(self.binding_nonce),
        );
        append_json_string_field(&mut output, "binding_value", &self.binding_value);
        append_json_string_field(&mut output, "verifier_key_id", &self.verifier_key_id);
        append_json_string_field(&mut output, "notary_key_id", &self.notary_key_id);
        append_json_string_field(
            &mut output,
            "tlsn_attestation_id",
            &URL_SAFE_NO_PAD.encode(&self.tlsn_attestation_id),
        );
        append_json_string_field(&mut output, "server_identity", &self.server_identity);
        append_json_string_field(
            &mut output,
            "request_transcript_size",
            &self.request_transcript_size.to_string(),
        );
        append_json_string_field(
            &mut output,
            "request_transcript_sha256",
            &URL_SAFE_NO_PAD.encode(self.request_transcript_sha256),
        );
        append_json_string_field(
            &mut output,
            "response_transcript_size",
            &self.response_transcript_size.to_string(),
        );
        append_json_string_field(
            &mut output,
            "response_transcript_sha256",
            &URL_SAFE_NO_PAD.encode(self.response_transcript_sha256),
        );
        append_range_field(
            &mut output,
            "revealed_request_ranges",
            &self.revealed_request_ranges,
        );
        append_range_field(
            &mut output,
            "revealed_response_ranges",
            &self.revealed_response_ranges,
        );
        append_json_string_field(
            &mut output,
            "signature",
            &URL_SAFE_NO_PAD.encode(self.signature),
        );
        output.push('}');
        Ok(output)
    }

    pub fn signing_bytes(&self) -> Result<Vec<u8>> {
        self.validate()?;
        let mut output = Vec::new();
        output.extend_from_slice(SIGNING_DOMAIN);
        push_u16(&mut output, self.version);
        push_len_prefixed(&mut output, self.profile_id.as_bytes())?;
        push_len_prefixed(&mut output, &self.profile_sha256)?;
        push_len_prefixed(&mut output, self.issuer.as_bytes())?;
        push_len_prefixed(&mut output, self.proof_purpose.as_bytes())?;
        push_len_prefixed(&mut output, self.attestation_session_id.as_bytes())?;
        push_len_prefixed(&mut output, &self.binding_nonce)?;
        push_len_prefixed(&mut output, self.binding_value.as_bytes())?;
        push_len_prefixed(&mut output, self.verifier_key_id.as_bytes())?;
        push_len_prefixed(&mut output, self.notary_key_id.as_bytes())?;
        push_len_prefixed(&mut output, &self.tlsn_attestation_id)?;
        push_len_prefixed(&mut output, self.server_identity.as_bytes())?;
        push_u64(&mut output, self.request_transcript_size);
        push_len_prefixed(&mut output, &self.request_transcript_sha256)?;
        push_ranges(&mut output, &self.revealed_request_ranges)?;
        push_u64(&mut output, self.response_transcript_size);
        push_len_prefixed(&mut output, &self.response_transcript_sha256)?;
        push_ranges(&mut output, &self.revealed_response_ranges)?;
        Ok(output)
    }
}

fn push_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn push_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn push_u64(output: &mut Vec<u8>, value: u64) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn push_len_prefixed(output: &mut Vec<u8>, bytes: &[u8]) -> Result<()> {
    let length = u16::try_from(bytes.len())
        .map_err(|_| VerifierError::InvalidResult("signing field exceeds UInt16"))?;
    push_u16(output, length);
    output.extend_from_slice(bytes);
    Ok(())
}

fn push_ranges(output: &mut Vec<u8>, ranges: &[RevealedRange]) -> Result<()> {
    let count = u32::try_from(ranges.len())
        .map_err(|_| VerifierError::InvalidResult("too many signing ranges"))?;
    push_u32(output, count);
    for range in ranges {
        push_u64(output, range.start);
        push_u64(output, range.length);
        push_u64(
            output,
            u64::try_from(range.bytes.len())
                .map_err(|_| VerifierError::InvalidResult("range length exceeds UInt64"))?,
        );
        output.extend_from_slice(&range.bytes);
    }
    Ok(())
}

fn append_json_field(output: &mut String, key: &str, value: &str, comma: bool) {
    if comma {
        output.push(',');
    }
    let _ = write!(output, "\"{key}\":{value}");
}

fn append_json_string_field(output: &mut String, key: &str, value: &str) {
    output.push(',');
    let _ = write!(output, "\"{key}\":\"{value}\"");
}

fn append_range_field(output: &mut String, key: &str, ranges: &[RevealedRange]) {
    output.push(',');
    let _ = write!(output, "\"{key}\":[");
    for (index, range) in ranges.iter().enumerate() {
        if index != 0 {
            output.push(',');
        }
        let _ = write!(
            output,
            "{{\"start\":\"{}\",\"length\":\"{}\",\"bytes\":\"{}\"}}",
            range.start,
            range.length,
            URL_SAFE_NO_PAD.encode(&range.bytes)
        );
    }
    output.push(']');
}

pub fn parse_verifier_result(input: &[u8], limits: &ParserLimits) -> Result<VerifierResult> {
    if input.len() > limits.verifier_result_json_bytes {
        return Err(VerifierError::LimitExceeded("Verifier Result JSON bytes"));
    }
    let mut cursor = JsonCursor::new(input, limits);
    cursor.skip_whitespace();
    cursor.expect_byte(b'{')?;

    expect_result_field(&mut cursor, "version", false)?;
    let version = parse_exact_number(&mut cursor, b"1")? as u16;
    expect_result_field(&mut cursor, "profile_id", true)?;
    let profile_id = parse_result_string(&mut cursor)?;
    expect_result_field(&mut cursor, "profile_sha256", true)?;
    let profile_sha256 = parse_fixed_base64::<32>(&mut cursor)?;
    expect_result_field(&mut cursor, "issuer", true)?;
    let issuer = parse_result_string(&mut cursor)?;
    expect_result_field(&mut cursor, "proof_purpose", true)?;
    let proof_purpose = parse_result_string(&mut cursor)?;
    expect_result_field(&mut cursor, "attestation_session_id", true)?;
    let attestation_session_id = parse_result_uuid(&mut cursor)?;
    expect_result_field(&mut cursor, "binding_nonce", true)?;
    let binding_nonce = parse_fixed_base64::<32>(&mut cursor)?;
    expect_result_field(&mut cursor, "binding_value", true)?;
    let binding_value = parse_result_string(&mut cursor)?;
    expect_result_field(&mut cursor, "verifier_key_id", true)?;
    let verifier_key_id = parse_result_string(&mut cursor)?;
    expect_result_field(&mut cursor, "notary_key_id", true)?;
    let notary_key_id = parse_result_string(&mut cursor)?;
    expect_result_field(&mut cursor, "tlsn_attestation_id", true)?;
    let tlsn_attestation_id = parse_result_base64(&mut cursor)?;
    expect_result_field(&mut cursor, "server_identity", true)?;
    let server_identity = parse_result_string(&mut cursor)?;
    expect_result_field(&mut cursor, "request_transcript_size", true)?;
    let request_transcript_size = parse_result_uint64(&mut cursor)?;
    expect_result_field(&mut cursor, "request_transcript_sha256", true)?;
    let request_transcript_sha256 = parse_fixed_base64::<32>(&mut cursor)?;
    expect_result_field(&mut cursor, "response_transcript_size", true)?;
    let response_transcript_size = parse_result_uint64(&mut cursor)?;
    expect_result_field(&mut cursor, "response_transcript_sha256", true)?;
    let response_transcript_sha256 = parse_fixed_base64::<32>(&mut cursor)?;
    expect_result_field(&mut cursor, "revealed_request_ranges", true)?;
    let revealed_request_ranges = parse_range_array(&mut cursor)?;
    expect_result_field(&mut cursor, "revealed_response_ranges", true)?;
    let revealed_response_ranges = parse_range_array(&mut cursor)?;
    expect_result_field(&mut cursor, "signature", true)?;
    let signature = parse_fixed_base64::<64>(&mut cursor)?;
    cursor.skip_whitespace();
    cursor.expect_byte(b'}')?;
    if cursor.position != input.len() {
        return Err(VerifierError::InvalidResult("trailing Result bytes"));
    }

    let result = VerifierResult {
        version,
        profile_id,
        profile_sha256,
        issuer,
        proof_purpose,
        attestation_session_id,
        binding_nonce,
        binding_value,
        verifier_key_id,
        notary_key_id,
        tlsn_attestation_id,
        server_identity,
        request_transcript_size,
        request_transcript_sha256,
        response_transcript_size,
        response_transcript_sha256,
        revealed_request_ranges,
        revealed_response_ranges,
        signature,
    };
    result.validate()?;
    let canonical = result.canonical_json()?;
    if canonical.as_bytes() != input {
        return Err(VerifierError::NonCanonicalResult);
    }
    Ok(result)
}

fn expect_result_field(cursor: &mut JsonCursor<'_>, key: &str, comma: bool) -> Result<()> {
    cursor.skip_whitespace();
    if comma {
        cursor.expect_byte(b',')?;
        cursor.skip_whitespace();
    }
    let parsed = cursor.parse_string()?;
    if parsed.had_escape || parsed.value != key {
        return Err(VerifierError::InvalidResult(
            "unexpected or escaped field name",
        ));
    }
    cursor.skip_whitespace();
    cursor.expect_byte(b':')?;
    cursor.skip_whitespace();
    Ok(())
}

fn parse_exact_number(cursor: &mut JsonCursor<'_>, expected: &[u8]) -> Result<u64> {
    let token = cursor.parse_number()?;
    if token != expected {
        return Err(VerifierError::InvalidResult("unexpected Result number"));
    }
    Ok(1)
}

fn parse_result_string(cursor: &mut JsonCursor<'_>) -> Result<String> {
    let parsed = cursor.parse_string()?;
    if parsed.had_escape {
        return Err(VerifierError::InvalidResult(
            "Result strings must not use escapes",
        ));
    }
    Ok(parsed.value)
}

fn parse_result_base64(cursor: &mut JsonCursor<'_>) -> Result<Vec<u8>> {
    let value = parse_result_string(cursor)?;
    decode_strict_base64url(&value)
}

fn parse_fixed_base64<const N: usize>(cursor: &mut JsonCursor<'_>) -> Result<[u8; N]> {
    let value = parse_result_base64(cursor)?;
    if value.len() != N {
        return Err(VerifierError::InvalidResult(
            "invalid fixed-size base64 field",
        ));
    }
    let mut output = [0_u8; N];
    output.copy_from_slice(&value);
    Ok(output)
}

fn parse_result_uuid(cursor: &mut JsonCursor<'_>) -> Result<Uuid> {
    let value = parse_result_string(cursor)?;
    let uuid = Uuid::parse_str(&value)
        .map_err(|_| VerifierError::InvalidResult("invalid session UUID"))?;
    if uuid.to_string() != value {
        return Err(VerifierError::InvalidResult(
            "session UUID is not lowercase canonical",
        ));
    }
    Ok(uuid)
}

fn parse_result_uint64(cursor: &mut JsonCursor<'_>) -> Result<u64> {
    let value = parse_result_string(cursor)?;
    parse_uint64_decimal(&value).map_err(|_| VerifierError::InvalidResult("invalid UInt64 field"))
}

fn parse_range_array(cursor: &mut JsonCursor<'_>) -> Result<Vec<RevealedRange>> {
    cursor.expect_byte(b'[')?;
    cursor.skip_whitespace();
    let mut ranges = Vec::new();
    if cursor.peek() == Some(b']') {
        cursor.position += 1;
        return Ok(ranges);
    }
    loop {
        cursor.expect_byte(b'{')?;
        expect_result_field(cursor, "start", false)?;
        let start = parse_result_uint64(cursor)?;
        expect_result_field(cursor, "length", true)?;
        let length = parse_result_uint64(cursor)?;
        expect_result_field(cursor, "bytes", true)?;
        let bytes = parse_result_base64(cursor)?;
        cursor.skip_whitespace();
        cursor.expect_byte(b'}')?;
        ranges.push(RevealedRange {
            start,
            length,
            bytes,
        });
        cursor.skip_whitespace();
        match cursor.peek() {
            Some(b',') => {
                cursor.position += 1;
                cursor.skip_whitespace();
            }
            Some(b']') => {
                cursor.position += 1;
                return Ok(ranges);
            }
            _ => {
                return Err(VerifierError::InvalidResult(
                    "invalid range array separator",
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::{fs, io::Write};

    fn default_limits() -> ParserLimits {
        ParserLimits::default()
    }

    fn chunked_response(body: &[u8]) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Encoding: identity\r\n\r\n{:x}\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(body);
        response.extend_from_slice(b"\r\n0\r\n\r\n");
        response
    }

    fn content_length_response(body: &[u8]) -> Vec<u8> {
        let mut response =
            format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", body.len()).into_bytes();
        response.extend_from_slice(body);
        response
    }

    fn gzip_response(body: &[u8]) -> Vec<u8> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(body).unwrap();
        let encoded = encoder.finish().unwrap();
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Encoding: gzip\r\n\r\n",
            encoded.len()
        )
        .into_bytes();
        response.extend_from_slice(&encoded);
        response
    }

    fn binding() -> String {
        let session = Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap();
        let nonce = [0x42_u8; 32];
        let mut bytes = Vec::new();
        bytes.extend_from_slice(BINDING_PREFIX);
        bytes.extend_from_slice(&16_u16.to_be_bytes());
        bytes.extend_from_slice(session.as_bytes());
        bytes.extend_from_slice(&32_u16.to_be_bytes());
        bytes.extend_from_slice(&nonce);
        URL_SAFE_NO_PAD.encode(bytes)
    }

    fn sanitized_result() -> VerifierResult {
        let response =
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Encoding: identity\r\n\r\n";
        VerifierResult {
            version: 1,
            profile_id: PROFILE_ID.to_owned(),
            profile_sha256: [1_u8; 32],
            issuer: ISSUER.to_owned(),
            proof_purpose: PROOF_PURPOSE.to_owned(),
            attestation_session_id: Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000")
                .unwrap(),
            binding_nonce: [0x42_u8; 32],
            binding_value: binding(),
            verifier_key_id: "verifier-test".to_owned(),
            notary_key_id: "notary-test".to_owned(),
            tlsn_attestation_id: vec![2_u8; 16],
            server_identity: "game.example.test".to_owned(),
            request_transcript_size: 4,
            request_transcript_sha256: [3_u8; 32],
            response_transcript_size: response.len() as u64,
            response_transcript_sha256: [4_u8; 32],
            revealed_request_ranges: vec![RevealedRange {
                start: 0,
                length: 4,
                bytes: b"POST".to_vec(),
            }],
            revealed_response_ranges: vec![RevealedRange {
                start: 0,
                length: response.len() as u64,
                bytes: response.to_vec(),
            }],
            signature: [5_u8; 64],
        }
    }

    #[test]
    fn parses_sanitized_chunked_fixture_without_number_conversion() {
        let body = fs::read("fixtures/require-info-response.http").unwrap();
        let fixture = chunked_response(&body);
        let parsed = parse_require_info_response(&fixture, &default_limits()).unwrap();
        assert_eq!(parsed.verified_member_id, "16189463");
    }

    #[test]
    fn rejects_duplicate_json_keys() {
        let body = b"svdata={\"api_result\":1,\"api_result\":1,\"api_data\":{\"api_basic\":{\"api_member_id\":1}}}";
        let raw = content_length_response(body);
        assert!(matches!(
            parse_require_info_response(&raw, &default_limits()),
            Err(VerifierError::InvalidJson(_))
        ));
    }

    #[test]
    fn rejects_member_id_string_and_noncanonical_numbers() {
        for body in [
            b"svdata={\"api_result\":1,\"api_data\":{\"api_basic\":{\"api_member_id\":\"16189463\"}}}".as_slice(),
            b"svdata={\"api_result\":1,\"api_data\":{\"api_basic\":{\"api_member_id\":016189463}}}".as_slice(),
            b"svdata={\"api_result\":1,\"api_data\":{\"api_basic\":{\"api_member_id\":1e7}}}".as_slice(),
        ] {
            let raw = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                std::str::from_utf8(body).unwrap()
            );
            assert!(parse_require_info_response(raw.as_bytes(), &default_limits()).is_err());
        }
    }

    #[test]
    fn rejects_response_trailing_bytes_and_invalid_chunk_extensions() {
        let body = fs::read("fixtures/require-info-response.http").unwrap();
        let fixture = chunked_response(&body);
        let mut trailing = fixture.clone();
        trailing.extend_from_slice(b"x");
        assert!(parse_require_info_response(&trailing, &default_limits()).is_err());
        let invalid = fixture
            .windows(4)
            .position(|window| window == b"62\r\n")
            .map(|position| {
                let mut copy = fixture.clone();
                copy.splice(position..position + 2, b"62;x".iter().copied());
                copy
            })
            .unwrap();
        assert!(parse_require_info_response(&invalid, &default_limits()).is_err());
    }

    #[test]
    fn accepts_single_member_gzip_and_rejects_gzip_trailing_bytes() {
        let body = fs::read("fixtures/require-info-response.http").unwrap();
        let response = gzip_response(&body);
        let parsed = parse_require_info_response(&response, &default_limits()).unwrap();
        assert_eq!(parsed.verified_member_id, "16189463");
        let mut trailing = response;
        trailing.push(0);
        assert!(parse_require_info_response(&trailing, &default_limits()).is_err());
    }

    #[test]
    fn validates_request_binding_and_host() {
        let value = binding();
        let request = format!(
            "POST {REQUIRE_INFO_TARGET} HTTP/1.1\r\nHost: game.example.test\r\nX-FUSOU-Attestation-Binding: {value}\r\nContent-Length: 0\r\n\r\n"
        );
        let parsed =
            parse_require_info_request(request.as_bytes(), "game.example.test", &default_limits())
                .unwrap();
        assert_eq!(parsed.binding.value, value);
        assert_eq!(parsed.binding.binding_nonce, [0x42_u8; 32]);
    }

    #[test]
    fn rejects_request_binding_ows_and_duplicate_binding() {
        let value = binding();
        let request = format!(
            "POST {REQUIRE_INFO_TARGET} HTTP/1.1\r\nHost: game.example.test\r\nX-FUSOU-Attestation-Binding:  {value}\r\nContent-Length: 0\r\n\r\n"
        );
        assert!(parse_require_info_request(
            request.as_bytes(),
            "game.example.test",
            &default_limits()
        )
        .is_err());
        let duplicate = format!(
            "POST {REQUIRE_INFO_TARGET} HTTP/1.1\r\nHost: game.example.test\r\nX-FUSOU-Attestation-Binding: {value}\r\nX-FUSOU-Attestation-Binding: {value}\r\nContent-Length: 0\r\n\r\n"
        );
        assert!(parse_require_info_request(
            duplicate.as_bytes(),
            "game.example.test",
            &default_limits()
        )
        .is_err());
    }

    #[test]
    fn rejects_wrong_request_method_target_and_host() {
        let value = binding();
        for start_line in [
            format!("GET {REQUIRE_INFO_TARGET} HTTP/1.1"),
            "POST /kcsapi/api_get_member/other HTTP/1.1".to_owned(),
        ] {
            let request = format!(
                "{start_line}\r\nHost: game.example.test\r\nX-FUSOU-Attestation-Binding: {value}\r\nContent-Length: 0\r\n\r\n"
            );
            assert!(parse_require_info_request(
                request.as_bytes(),
                "game.example.test",
                &default_limits()
            )
            .is_err());
        }
        let wrong_host = format!(
            "POST {REQUIRE_INFO_TARGET} HTTP/1.1\r\nHost: other.example.test\r\nX-FUSOU-Attestation-Binding: {value}\r\nContent-Length: 0\r\n\r\n"
        );
        assert!(parse_require_info_request(
            wrong_host.as_bytes(),
            "game.example.test",
            &default_limits()
        )
        .is_err());
    }

    #[test]
    fn rejects_missing_request_or_response_framing() {
        let value = binding();
        let request = format!(
            "POST {REQUIRE_INFO_TARGET} HTTP/1.1\r\nHost: game.example.test\r\nX-FUSOU-Attestation-Binding: {value}\r\n\r\n"
        );
        assert!(parse_require_info_request(
            request.as_bytes(),
            "game.example.test",
            &default_limits()
        )
        .is_err());
        let body = b"svdata={\"api_result\":1,\"api_data\":{\"api_basic\":{\"api_member_id\":1}}}";
        let response = format!(
            "HTTP/1.1 200 OK\r\n\r\n{}",
            std::str::from_utf8(body).unwrap()
        );
        assert!(parse_require_info_response(response.as_bytes(), &default_limits()).is_err());
    }

    #[test]
    fn validates_ranges_and_rejects_overlap_or_mismatch() {
        let ranges = vec![RevealedRange {
            start: 0,
            length: 2,
            bytes: b"ab".to_vec(),
        }];
        validate_ranges(&ranges, 2).unwrap();
        let overlap = vec![
            RevealedRange {
                start: 0,
                length: 2,
                bytes: b"ab".to_vec(),
            },
            RevealedRange {
                start: 1,
                length: 1,
                bytes: b"b".to_vec(),
            },
        ];
        assert!(validate_ranges(&overlap, 2).is_err());
        let mismatch = vec![RevealedRange {
            start: 0,
            length: 3,
            bytes: b"ab".to_vec(),
        }];
        assert!(validate_ranges(&mismatch, 3).is_err());
    }

    #[test]
    fn validates_full_transcript_digest_and_revealed_bytes() {
        let transcript = b"0123456789";
        let ranges = vec![RevealedRange {
            start: 2,
            length: 3,
            bytes: b"234".to_vec(),
        }];
        verify_transcript_digest(transcript, 10, &sha256(transcript), &ranges).unwrap();
        let wrong_bytes = vec![RevealedRange {
            start: 2,
            length: 3,
            bytes: b"xyz".to_vec(),
        }];
        assert!(
            verify_transcript_digest(transcript, 10, &sha256(transcript), &wrong_bytes).is_err()
        );
    }

    #[test]
    fn canonical_result_round_trips_and_signing_bytes_are_stable() {
        let result = sanitized_result();
        let json = result.canonical_json().unwrap();
        let parsed = parse_verifier_result(json.as_bytes(), &default_limits()).unwrap();
        assert_eq!(parsed, result);
        assert_eq!(
            result.signing_bytes().unwrap(),
            parsed.signing_bytes().unwrap()
        );
    }

    #[test]
    fn rejects_result_binding_substitution() {
        let mut result = sanitized_result();
        result.binding_nonce[0] ^= 1;
        assert!(result.validate().is_err());
    }

    #[test]
    fn rejects_result_unknown_ordered_or_padded_fields() {
        let result = sanitized_result();
        let json = result.canonical_json().unwrap();
        let unknown = json.replacen("\"version\":1", "\"unknown\":1,\"version\":1", 1);
        assert!(parse_verifier_result(unknown.as_bytes(), &default_limits()).is_err());
        let padded = json.replacen(
            &URL_SAFE_NO_PAD.encode(result.profile_sha256),
            &format!("{}=", URL_SAFE_NO_PAD.encode(result.profile_sha256)),
            1,
        );
        assert!(parse_verifier_result(padded.as_bytes(), &default_limits()).is_err());
        let spaced = json.replacen("{\"version\":1", "{ \"version\":1", 1);
        assert!(matches!(
            parse_verifier_result(spaced.as_bytes(), &default_limits()),
            Err(VerifierError::NonCanonicalResult)
        ));
    }

    #[test]
    fn rejects_noncanonical_uint64_and_dns_identity() {
        assert!(parse_uint64_decimal("01").is_err());
        assert!(parse_uint64_decimal("18446744073709551616").is_err());
        assert!(validate_server_identity("Game.example.test").is_err());
        assert!(validate_server_identity("game..example").is_err());
        assert!(validate_server_identity("game.example.test.").is_err());
    }
}
