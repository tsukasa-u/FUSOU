use super::*;

fn limits() -> FdInputLimits {
    FdInputLimits {
        max_frame_bytes: 131072, max_entries: 64, max_entry_bytes: 65536,
        max_json_bytes: 65536, max_json_nodes: 2048, max_json_depth: 16,
        max_string_bytes: 4096, max_read_calls: 64,
    }
}
fn vector() -> Value {
    serde_json::from_str(include_str!("../fixtures/offline-fd-v1-vector.json")).unwrap()
}
fn bytes() -> Vec<u8> {
    use base64::engine::general_purpose::STANDARD;
    STANDARD.decode(vector()["frame_base64"].as_str().unwrap()).unwrap()
}
type TestEntry = (u16, String, String, Vec<u8>);
fn entries() -> Vec<TestEntry> {
    let parsed = parse_frame(bytes(), &limits()).unwrap();
    parsed.entries.iter().map(|entry|
        (entry.kind, entry.role.clone(), entry.path.clone(), parsed.raw(entry).to_vec())).collect()
}
fn refresh_descriptors(entries: &mut [TestEntry]) {
    let artifacts: BTreeMap<String, Value> = entries.iter().filter(|entry| entry.0 == 3).map(|entry| {
        (entry.1.clone(), json!({
            "path": entry.2, "byte_length": entry.3.len(),
            "artifact_sha256": URL_SAFE_NO_PAD.encode(crate::sha256(&entry.3)),
        }))
    }).collect();
    let manifest = entries.iter_mut().find(|entry| entry.0 == 1).unwrap();
    let mut value: Value = serde_json::from_slice(&manifest.3).unwrap();
    value["artifacts"] = serde_json::to_value(artifacts).unwrap();
    manifest.3 = serde_json::to_vec(&value).unwrap();
}
fn encode(mut entries: Vec<TestEntry>) -> Vec<u8> {
    entries.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
    let table_length: usize = entries.iter().map(|entry| aligned(64 + entry.1.len() + entry.2.len()).unwrap()).sum();
    let payload = HEADER_BYTES + table_length;
    let total = payload + entries.iter().map(|entry| entry.3.len()).sum::<usize>();
    let mut raw = vec![0; total];
    raw[..8].copy_from_slice(MAGIC);
    raw[8..10].copy_from_slice(&ABI_VERSION.to_le_bytes());
    raw[12..16].copy_from_slice(&(HEADER_BYTES as u32).to_le_bytes());
    raw[16..20].copy_from_slice(&(entries.len() as u32).to_le_bytes());
    raw[24..32].copy_from_slice(&(table_length as u64).to_le_bytes());
    raw[32..40].copy_from_slice(&(total as u64).to_le_bytes());
    raw[40..48].copy_from_slice(&(payload as u64).to_le_bytes());
    let mut cursor = HEADER_BYTES;
    let mut offset = payload;
    for (kind, role, path, data) in entries {
        raw[cursor..cursor + 2].copy_from_slice(&kind.to_le_bytes());
        raw[cursor + 4..cursor + 8].copy_from_slice(&(role.len() as u32).to_le_bytes());
        raw[cursor + 8..cursor + 12].copy_from_slice(&(path.len() as u32).to_le_bytes());
        raw[cursor + 16..cursor + 24].copy_from_slice(&(offset as u64).to_le_bytes());
        raw[cursor + 24..cursor + 32].copy_from_slice(&(data.len() as u64).to_le_bytes());
        raw[cursor + 32..cursor + 64].copy_from_slice(&crate::sha256(&data));
        raw[cursor + 64..cursor + 64 + role.len()].copy_from_slice(role.as_bytes());
        raw[cursor + 64 + role.len()..cursor + 64 + role.len() + path.len()].copy_from_slice(path.as_bytes());
        raw[offset..offset + data.len()].copy_from_slice(&data);
        offset += data.len();
        cursor += aligned(64 + role.len() + path.len()).unwrap();
    }
    raw
}

#[test]
fn shared_node_vector_and_independent_encoder_agree() {
    let parsed = parse_frame(bytes(), &limits()).unwrap();
    assert_eq!(parsed.binding(), &vector()["binding"]);
    assert_eq!(encode(entries()), bytes());
    assert_eq!(parsed.entries.len(), 27);
    assert_eq!(parsed.bundle().unwrap().artifacts.len(), 19);
    assert!(verify_frame_bytes(bytes(), &limits(), &json!({})).unwrap_err()
        .to_string().contains("independent consumed-input"));
}

#[test]
fn rejects_header_flags_lengths_versions_and_ranges() {
    for (offset, replacement) in [
        (8, vec![2, 0]), (10, vec![1, 0]), (12, 47_u32.to_le_bytes().to_vec()),
        (20, 1_u32.to_le_bytes().to_vec()), (16, 26_u32.to_le_bytes().to_vec()),
        (24, 1_u64.to_le_bytes().to_vec()), (64, u64::MAX.to_le_bytes().to_vec()),
        (72, u64::MAX.to_le_bytes().to_vec()), (48, vec![4, 0]), (50, vec![1, 0]),
    ] {
        let mut raw = bytes();
        raw[offset..offset + replacement.len()].copy_from_slice(&replacement);
        assert!(parse_frame(raw, &limits()).is_err());
    }
    let original = bytes();
    for raw in [original[..40].to_vec(), original[..original.len() - 1].to_vec(),
        [original.as_slice(), &[0]].concat()]
    {
        assert!(parse_frame(raw, &limits()).is_err());
    }
    for delta in [-1_i64, 1] {
        let mut raw = bytes();
        let offset = u64_at(&raw, 64).unwrap() as i64 + delta;
        raw[64..72].copy_from_slice(&(offset as u64).to_le_bytes());
        assert!(parse_frame(raw, &limits()).is_err());
    }
}

#[test]
fn shared_node_vector_rejects_entry_metadata_padding_and_payload_mutations() {
    let original = bytes();
    let path_start = HEADER_BYTES + ENTRY_BYTES + "control".len();
    let padding_start = path_start + "control.json".len();
    for offset in [50, 60, padding_start, 80, original.len() - 1] {
        let mut raw = original.clone();
        raw[offset] ^= 1;
        assert!(parse_frame(raw, &limits()).is_err());
    }
    let mut invalid_utf8 = original.clone();
    invalid_utf8[path_start] = 0xff;
    assert!(parse_frame(invalid_utf8, &limits()).is_err());
    let mut trailing = original;
    trailing.push(0);
    let length = trailing.len() as u64;
    trailing[32..40].copy_from_slice(&length.to_le_bytes());
    assert!(parse_frame(trailing, &limits()).is_err());
}

#[test]
fn rejects_missing_duplicate_unknown_and_noncanonical_paths() {
    let mut missing = entries(); missing.retain(|entry| entry.1 != "health");
    assert!(parse_frame(encode(missing), &limits()).is_err());
    let mut duplicate = entries(); duplicate.push(duplicate[0].clone());
    assert!(parse_frame(encode(duplicate), &limits()).is_err());
    for path in ["../health", "/health", "a//b", "a/./b", "a/../b", "a\\b", "a:b",
        "artifacts/result.bin", "artifacts/result.bin/child", "control.json", "control.json/child"]
    {
        let mut source = entries();
        source.iter_mut().find(|entry| entry.1 == "health").unwrap().2 = path.to_owned();
        assert!(parse_frame(encode(source), &limits()).is_err());
    }
    let mut unknown = entries();
    unknown.iter_mut().find(|entry| entry.1 == "health").unwrap().1 = "unknown_role".to_owned();
    assert!(parse_frame(encode(unknown), &limits()).is_err());
    let mut interleaved = entries();
    interleaved.iter_mut().find(|entry| entry.1 == "health").unwrap().2 = "artifacts/result.bin/child".to_owned();
    interleaved.push((3, "extra".to_owned(), "artifacts/result.bin-between".to_owned(), Vec::new()));
    refresh_descriptors(&mut interleaved);
    let error = parse_frame(encode(interleaved), &limits()).err().unwrap().to_string();
    assert!(error.contains("logical path collision"));
}

#[test]
fn rejects_duplicate_json_bad_unicode_and_structure_limits() {
    for raw in [
        br#"{"x":1,"x":2}"#.as_slice(),
        br#"{"nested":{"x":1,"\u0078":2}}"#,
        br#"{"x":"\q"}"#, br#"{} trailing"#, br#"{"x":"\ud800"}"#, b"{\"x\":\"\xff\"}",
    ] {
        let mut source = entries();
        source.iter_mut().find(|entry| entry.1 == "health").unwrap().3 = raw.to_vec();
        refresh_descriptors(&mut source);
        let error = parse_frame(encode(source), &limits()).err().unwrap().to_string();
        assert!(error.contains("JSON"), "{error}");
    }
    let mut valid = entries();
    valid.iter_mut().find(|entry| entry.1 == "health").unwrap().3 = br#"{"text":"\"x\":","array":[{},{}]}"#.to_vec();
    refresh_descriptors(&mut valid);
    assert!(parse_frame(encode(valid), &limits()).is_ok());
    for smaller in [
        FdInputLimits { max_frame_bytes: 1, ..limits() },
        FdInputLimits { max_entries: 26, ..limits() },
        FdInputLimits { max_entry_bytes: 1, ..limits() },
        FdInputLimits { max_json_bytes: 1, ..limits() },
        FdInputLimits { max_json_nodes: 1, ..limits() },
        FdInputLimits { max_json_depth: 1, ..limits() },
        FdInputLimits { max_string_bytes: 1, ..limits() },
    ] {
        assert!(parse_frame(bytes(), &smaller).is_err());
    }
}

#[test]
fn all_external_duplicates_and_extra_descriptors_are_checked() {
    for role in EXTERNAL {
        if !["origin_inventory", "target_approval"].contains(&role) {
            let mut source = entries();
            source.iter_mut().find(|entry| entry.0 == 2 && entry.1 == role).unwrap().3 = b"{}".to_vec();
            assert!(parse_frame(encode(source), &limits()).is_err());
        }
    }
    let mut extra = entries();
    let data = b"opaque additional artifact".to_vec();
    let manifest = extra.iter_mut().find(|entry| entry.0 == 1).unwrap();
    let mut value: Value = serde_json::from_slice(&manifest.3).unwrap();
    value["artifacts"]["extra"] = json!({
        "path": "extra.bin", "byte_length": data.len(),
        "artifact_sha256": URL_SAFE_NO_PAD.encode(crate::sha256(&data)),
    });
    manifest.3 = serde_json::to_vec(&value).unwrap();
    extra.push((3, "extra".to_owned(), "extra.bin".to_owned(), data));
    assert_eq!(parse_frame(encode(extra), &limits()).unwrap().entries.len(), 28);
}

#[test]
fn owned_frame_is_independent_of_the_original_buffer() {
    let mut original = bytes();
    let parsed = parse_frame(original.clone(), &limits()).unwrap();
    original.fill(0);
    assert_eq!(parsed.binding(), &vector()["binding"]);
    let mut claimed = parsed.binding().clone();
    claimed["inventory_sha256"] = Value::String(URL_SAFE_NO_PAD.encode([0; 32]));
    assert!(verify_frame_bytes(bytes(), &limits(), &claimed).is_err());
}

#[test]
fn common_bytes_loader_rechecks_the_owned_bytes_before_semantic_verification() {
    let parsed = parse_frame(bytes(), &limits()).unwrap();
    let mut bundle = parsed.bundle().unwrap();
    bundle.artifacts.get_mut("health").unwrap().fill(0);
    let error = verify_bundle_bytes(bundle, &parsed.options().unwrap()).unwrap_err();
    assert!(error.to_string().contains("artifact SHA-256 does not match the manifest"));
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
mod linux {
    use super::*;
    use nix::fcntl::{fcntl, FcntlArg, SealFlag};
    use nix::sys::memfd::{memfd_create, MFdFlags};
    use std::{fs::File, io::{Seek, SeekFrom, Write}};

    fn input(seal: bool) -> File {
        let flags = MFdFlags::MFD_CLOEXEC | MFdFlags::MFD_ALLOW_SEALING | MFdFlags::from_bits_retain(0x0008);
        let mut file = File::from(memfd_create("fusou-fd-abi-test", flags).unwrap());
        file.write_all(&bytes()).unwrap();
        if seal {
            fcntl(&file, FcntlArg::F_ADD_SEALS(
                SealFlag::F_SEAL_WRITE | SealFlag::F_SEAL_GROW | SealFlag::F_SEAL_SHRINK | SealFlag::F_SEAL_SEAL,
            )).unwrap();
        }
        file
    }

    #[test]
    fn shared_cursor_changes_do_not_affect_consumption() {
        let mut file = input(true);
        file.seek(SeekFrom::Start(123)).unwrap();
        let mut shared = file.try_clone().unwrap();
        let interferer = std::thread::spawn(move || {
            for position in 0..1000 { shared.seek(SeekFrom::Start(position)).unwrap(); }
        });
        let parsed = read_sealed_file(&file, &limits()).unwrap();
        interferer.join().unwrap();
        assert_eq!(parsed.binding(), &vector()["binding"]);
    }

    #[test]
    fn unsealed_pipes_sockets_and_exhausted_read_limits_are_rejected() {
        assert!(read_sealed_file(&input(false), &limits()).is_err());
        let (reader, _writer) = nix::unistd::pipe().unwrap();
        assert!(read_sealed_file(&File::from(reader), &limits()).is_err());
        let (socket, _peer) = std::os::unix::net::UnixStream::pair().unwrap();
        let fd: std::os::fd::OwnedFd = socket.into();
        assert!(read_sealed_file(&File::from(fd), &limits()).is_err());
        assert!(read_sealed_file(&input(true), &FdInputLimits { max_read_calls: 1, ..limits() }).is_err());
        let future_only = input(false);
        fcntl(&future_only, FcntlArg::F_ADD_SEALS(
            SealFlag::F_SEAL_FUTURE_WRITE | SealFlag::F_SEAL_GROW | SealFlag::F_SEAL_SHRINK | SealFlag::F_SEAL_SEAL,
        )).unwrap();
        assert!(read_sealed_file(&future_only, &limits()).is_err());
    }
}
