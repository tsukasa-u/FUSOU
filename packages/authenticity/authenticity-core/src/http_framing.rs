#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum HttpContentLengthError {
    #[error("Content-Length must contain one or more ASCII decimal digits")]
    InvalidDigits,
    #[error("Content-Length overflows u64")]
    Overflow,
}

pub fn parse_http_content_length(value: &[u8]) -> Result<u64, HttpContentLengthError> {
    let value = trim_ows(value);
    if value.is_empty() || !value.iter().all(u8::is_ascii_digit) {
        return Err(HttpContentLengthError::InvalidDigits);
    }

    value.iter().try_fold(0_u64, |length, digit| {
        length
            .checked_mul(10)
            .and_then(|length| length.checked_add(u64::from(*digit - b'0')))
            .ok_or(HttpContentLengthError::Overflow)
    })
}

fn trim_ows(mut value: &[u8]) -> &[u8] {
    while value
        .first()
        .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
    {
        value = &value[1..];
    }
    while value
        .last()
        .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
    {
        value = &value[..value.len() - 1];
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_length_accepts_http_decimal_digits_and_surrounding_ows() {
        for (value, expected) in [
            (b"0".as_slice(), 0_u64),
            (b"007".as_slice(), 7_u64),
            (b"7".as_slice(), 7_u64),
            (b" \t007\t ".as_slice(), 7_u64),
        ] {
            assert_eq!(parse_http_content_length(value), Ok(expected));
        }
    }

    #[test]
    fn content_length_rejects_empty_signed_non_ascii_embedded_whitespace_and_overflow() {
        for value in [b"".as_slice(), b" \t ", b"+7", b"-7", b"7 0", b"\xd9\xa7"] {
            assert_eq!(
                parse_http_content_length(value),
                Err(HttpContentLengthError::InvalidDigits),
                "{value:?}"
            );
        }
        assert_eq!(
            parse_http_content_length(b"18446744073709551616"),
            Err(HttpContentLengthError::Overflow)
        );
    }
}
