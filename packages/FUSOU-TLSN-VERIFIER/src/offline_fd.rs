use crate::evidence_bundle::{verify_bundle_bytes, BundleBytes, BundleVerifierOptions};
use crate::strict_json::{parse_json, JsonLimits};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const ABI_VERSION: u16 = 1;
pub const HEADER_BYTES: usize = 48;
pub const ENTRY_BYTES: usize = 64;
const MAX_SAFE_INTEGER: u64 = (1_u64 << 53) - 1;
const MAGIC: &[u8; 8] = b"FUSOUFD\0";
const INVENTORY_DOMAIN: &[u8] = b"FUSOU-FD-INVENTORY-V1\0";
const EXTERNAL: [&str; 6] = [
    "binding_authority_registry", "origin_inventory", "session_authority_registry",
    "target_approval", "trust_anchor_der", "trusted_notary_registry",
];
const REQUIRED: [&str; 19] = [
    "presentation", "result", "result_registry", "result_registry_envelope",
    "notary_registry", "health", "session", "authenticated_user", "device_identity",
    "device_authentication", "possession_proof", "consume_receipt", "replay",
    "session_authority_registry", "binding_authority_registry", "capture_metadata",
    "semantic_verification", "trust_root", "subject",
];
const OPTIONS: [&str; 12] = [
    "evidence-root-key-id", "evidence-root-public-key-spki", "session-authority-key-id",
    "session-authority-public-key-spki", "binding-authority-key-id", "binding-authority-public-key-spki",
    "canonical-user-id", "device-id", "device-public-key", "server-identity", "profile-sha256", "verifier-key-id",
];

#[derive(Debug, thiserror::Error)]
pub enum FdInputError {
    #[error("FD_ABI_V1 {0}")]
    Invalid(&'static str),
    #[error("FD_ABI_V1 JSON: {0}")]
    Json(String),
    #[error("FD_ABI_V1 I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("FD_ABI_V1 evidence: {0}")]
    Evidence(String),
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    #[error("FD_ABI_V1 seal/fd syscall: {0}")]
    Syscall(#[from] nix::errno::Errno),
}
type Result<T> = std::result::Result<T, FdInputError>;

fn require(condition: bool, message: &'static str) -> Result<()> {
    if condition { Ok(()) } else { Err(FdInputError::Invalid(message)) }
}
fn sum(a: usize, b: usize) -> Result<usize> {
    a.checked_add(b).ok_or(FdInputError::Invalid("integer overflow"))
}
fn aligned(value: usize) -> Result<usize> {
    sum(value, (8 - value % 8) % 8)
}
fn word<const N: usize>(raw: &[u8], offset: usize) -> Result<[u8; N]> {
    raw.get(offset..sum(offset, N)?).and_then(|bytes| bytes.try_into().ok())
        .ok_or(FdInputError::Invalid("truncated integer"))
}
fn u16_at(raw: &[u8], offset: usize) -> Result<u16> {
    Ok(u16::from_le_bytes(word(raw, offset)?))
}
fn u32_at(raw: &[u8], offset: usize) -> Result<usize> {
    usize::try_from(u32::from_le_bytes(word(raw, offset)?))
        .map_err(|_| FdInputError::Invalid("integer overflow"))
}
fn u64_at(raw: &[u8], offset: usize) -> Result<usize> {
    let value = u64::from_le_bytes(word(raw, offset)?);
    require(value <= MAX_SAFE_INTEGER, "integer overflow")?;
    usize::try_from(value).map_err(|_| FdInputError::Invalid("integer overflow"))
}

#[derive(Clone, Copy, Debug)]
pub struct FdInputLimits {
    pub max_frame_bytes: usize,
    pub max_entries: usize,
    pub max_entry_bytes: usize,
    pub max_json_bytes: usize,
    pub max_json_nodes: usize,
    pub max_json_depth: usize,
    pub max_string_bytes: usize,
    pub max_read_calls: usize,
}
impl FdInputLimits {
    pub fn validate(&self) -> Result<()> {
        require([
            self.max_frame_bytes, self.max_entries, self.max_entry_bytes, self.max_json_bytes,
            self.max_json_nodes, self.max_json_depth, self.max_string_bytes, self.max_read_calls,
        ].iter().all(|&value| value > 0 && value as u128 <= u128::from(MAX_SAFE_INTEGER))
            && self.max_entries <= u32::MAX as usize
            && self.max_json_depth <= crate::MAX_JSON_DEPTH, "limits")
    }
    fn json(&self, raw: &[u8]) -> Result<Value> {
        parse_json(raw, JsonLimits {
            max_bytes: self.max_json_bytes, max_nodes: self.max_json_nodes,
            max_depth: self.max_json_depth, max_string_bytes: self.max_string_bytes,
        }).map_err(|error| FdInputError::Json(error.to_string()))
    }
}

struct Header {
    count: usize,
    table_length: usize,
    payload: usize,
    total: usize,
}
fn header(raw: &[u8], size: usize, limits: &FdInputLimits) -> Result<Header> {
    limits.validate()?;
    require(size <= limits.max_frame_bytes && raw.len() >= HEADER_BYTES, "frame size limit")?;
    require(raw.get(..8) == Some(MAGIC.as_slice())
        && u16_at(raw, 8)? == ABI_VERSION && u16_at(raw, 10)? == 0
        && u32_at(raw, 12)? == HEADER_BYTES && u32_at(raw, 20)? == 0, "header/version/flags")?;
    let result = Header {
        count: u32_at(raw, 16)?, table_length: u64_at(raw, 24)?,
        total: u64_at(raw, 32)?, payload: u64_at(raw, 40)?,
    };
    require(result.count >= 27 && result.count <= limits.max_entries
        && result.total == size && result.payload == sum(HEADER_BYTES, result.table_length)?
        && result.payload <= size
        && result.count.checked_mul(ENTRY_BYTES).is_some_and(|minimum| minimum <= result.table_length),
        "count/table/total length")?;
    Ok(result)
}

#[derive(Debug)]
struct Entry {
    kind: u16,
    role: String,
    path: String,
    offset: usize,
    length: usize,
    digest: [u8; 32],
}
fn logical_path(path: &str) -> bool {
    !path.is_empty() && !path.starts_with('/') && !path.contains(['\\', ':', '\0'])
        && path.split('/').all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}
fn role_name(role: &str) -> bool {
    role.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && role.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}
#[derive(Default)]
struct PathNode {
    file: bool,
    children: BTreeMap<String, usize>,
}

fn table(raw: &[u8], h: &Header, limits: &FdInputLimits) -> Result<Vec<Entry>> {
    require(raw.len() == h.table_length, "truncated table")?;
    let mut entries: Vec<Entry> = Vec::new();
    entries.try_reserve_exact(h.count).map_err(|_| FdInputError::Invalid("table allocation refused"))?;
    let mut cursor = 0;
    let mut end = h.payload;
    for _ in 0..h.count {
        require(sum(cursor, ENTRY_BYTES)? <= raw.len(), "truncated table")?;
        let kind = u16_at(raw, cursor)?;
        let role_length = u32_at(raw, cursor + 4)?;
        let path_length = u32_at(raw, cursor + 8)?;
        require(kind <= 3 && u16_at(raw, cursor + 2)? == 0 && u32_at(raw, cursor + 12)? == 0
            && role_length > 0 && path_length > 0 && role_length <= limits.max_string_bytes
            && path_length <= limits.max_string_bytes, "entry flags/strings/kind")?;
        let offset = u64_at(raw, cursor + 16)?;
        let length = u64_at(raw, cursor + 24)?;
        require(length <= limits.max_entry_bytes && offset == end && sum(offset, length)? <= h.total,
            "entry range/length")?;
        let strings = sum(cursor, ENTRY_BYTES)?;
        let role_end = sum(strings, role_length)?;
        let strings_end = sum(role_end, path_length)?;
        let next = aligned(strings_end)?;
        require(next <= raw.len(), "table strings")?;
        let role = std::str::from_utf8(&raw[strings..role_end])
            .map_err(|_| FdInputError::Invalid("invalid metadata UTF-8"))?.to_owned();
        let path = std::str::from_utf8(&raw[role_end..strings_end])
            .map_err(|_| FdInputError::Invalid("invalid metadata UTF-8"))?.to_owned();
        require(role_name(&role) && logical_path(&path), "logical path/role")?;
        require(raw[strings_end..next].iter().all(|&byte| byte == 0), "table padding")?;
        let entry = Entry { kind, role, path, offset, length, digest: word(raw, cursor + 32)? };
        if let Some(previous) = entries.last() {
            require((previous.kind, previous.role.as_str()) < (entry.kind, entry.role.as_str()),
                "entry order/duplicate")?;
        }
        entries.push(entry);
        end = sum(offset, length)?;
        cursor = next;
    }
    require(cursor == raw.len() && end == h.total, "table/payload trailing bytes")?;
    let mut paths = vec![PathNode::default()];
    for entry in &entries {
        let mut node = 0;
        for segment in entry.path.split('/') {
            require(!paths[node].file, "logical path collision")?;
            node = if let Some(&next) = paths[node].children.get(segment) {
                next
            } else {
                let next = paths.len();
                paths.try_reserve(1).map_err(|_| FdInputError::Invalid("path allocation refused"))?;
                paths.push(PathNode::default());
                paths[node].children.insert(segment.to_owned(), next);
                next
            };
        }
        require(!paths[node].file && paths[node].children.is_empty(), "logical path collision")?;
        paths[node].file = true;
    }
    Ok(entries)
}
fn digest_string(value: &Value) -> Result<[u8; 32]> {
    let text = value.as_str().ok_or(FdInputError::Invalid("digest string"))?;
    require(text.len() == 43, "digest encoding")?;
    let bytes = URL_SAFE_NO_PAD.decode(text).map_err(|_| FdInputError::Invalid("digest encoding"))?;
    require(URL_SAFE_NO_PAD.encode(&bytes) == text, "digest encoding")?;
    bytes.try_into().map_err(|_| FdInputError::Invalid("digest length"))
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|object| object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key)))
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value.get(key).and_then(Value::as_str).filter(|text| !text.is_empty())
        .ok_or(FdInputError::Invalid("required string"))
}
fn control(value: &Value) -> Result<()> {
    require(exact(value, &["abi_version", "scope", "context", "options", "policy_sha256",
        "verifier_executable_sha256", "verifier_build_sha256", "runtime_profile_sha256"])
        && value["abi_version"].as_u64() == Some(1)
        && value["scope"].as_str() == Some("fusou-offline-fd-input-v1"), "control")?;
    for name in ["policy_sha256", "verifier_executable_sha256", "verifier_build_sha256", "runtime_profile_sha256"] {
        digest_string(&value[name])?;
    }
    let context = &value["context"];
    require(exact(context, &["repository", "source_sha", "workflow_sha", "run_id", "run_attempt"])
        && context["repository"].as_str() == Some("tsukasa-u/FUSOU")
        && ["source_sha", "workflow_sha"].iter().all(|name| context[*name].as_str().is_some_and(|text|
            text.len() == 40 && text.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))))
        && ["run_id", "run_attempt"].iter().all(|name|
            context[*name].as_u64().is_some_and(|n| n > 0 && n <= MAX_SAFE_INTEGER)), "context")?;
    let options = &value["options"];
    let mut names = OPTIONS.to_vec();
    if options.get("sparse-profile-sha256").is_some() { names.push("sparse-profile-sha256"); }
    require(exact(options, &names) && names.iter().all(|name|
        options[*name].as_str().is_some_and(|text| !text.is_empty())), "scalar options")
}

pub struct ParsedFrame {
    bytes: Vec<u8>,
    entries: Vec<Entry>,
    control: Value,
    binding: Value,
}
impl ParsedFrame {
    pub fn frame_bytes(&self) -> &[u8] { &self.bytes }
    pub fn control(&self) -> &Value { &self.control }
    pub fn binding(&self) -> &Value { &self.binding }
    pub fn verify(&self, expected_binding: &Value) -> Result<Value> {
        require(self.binding() == expected_binding, "independent consumed-input binding")?;
        let mut report = verify_bundle_bytes(self.bundle()?, &self.options()?)
            .map_err(|error| FdInputError::Evidence(error.to_string()))?;
        report["input_binding"] = self.binding.clone();
        report["authenticated"] = Value::Bool(false);
        report["publication_authorized"] = Value::Bool(false);
        Ok(report)
    }
    fn entry(&self, kind: u16, role: &str) -> Result<&Entry> {
        self.entries.iter().find(|entry| entry.kind == kind && entry.role == role)
            .ok_or(FdInputError::Invalid("missing entry"))
    }
    fn raw(&self, entry: &Entry) -> &[u8] {
        &self.bytes[entry.offset..entry.offset + entry.length]
    }
    fn input(&self, kind: u16, role: &str) -> Result<&[u8]> { Ok(self.raw(self.entry(kind, role)?)) }
    fn validate(&self, limits: &FdInputLimits) -> Result<()> {
        control(&self.control)?;
        require(self.entry(0, "control")?.path == "control.json"
            && self.entry(1, "bundle")?.path == "bundle.input", "control/manifest role")?;
        for entry in &self.entries {
            require(crate::sha256(self.raw(entry)) == entry.digest, "entry digest")?;
            if entry.kind == 0 { require(entry.role == "control", "control role")?; }
            if entry.kind == 1 { require(entry.role == "bundle", "manifest role")?; }
            if entry.kind == 2 {
                require(EXTERNAL.contains(&entry.role.as_str()) && entry.path == format!("{}.input", entry.role),
                    "external role")?;
            }
        }
        for role in EXTERNAL { self.entry(2, role)?; }
        let manifest = limits.json(self.input(1, "bundle")?)?;
        let descriptors = manifest.get("artifacts").and_then(Value::as_object)
            .ok_or(FdInputError::Invalid("manifest artifacts"))?;
        require(sum(descriptors.len(), 8)? == self.entries.len() && REQUIRED.iter().all(|name| descriptors.contains_key(*name)),
            "artifact inventory")?;
        for (role, descriptor) in descriptors {
            let entry = self.entry(3, role)?;
            require(descriptor["path"].as_str() == Some(entry.path.as_str())
                && descriptor["byte_length"].as_u64() == Some(entry.length as u64)
                && digest_string(&descriptor["artifact_sha256"])? == entry.digest, "artifact descriptor")?;
        }
        for entry in &self.entries {
            if (entry.kind == 2 && entry.role != "trust_anchor_der")
                || (entry.kind == 3 && REQUIRED.contains(&entry.role.as_str())
                    && !["presentation", "trust_root"].contains(&entry.role.as_str()))
            {
                limits.json(self.raw(entry))?;
            }
        }
        for (external, artifact) in [
            ("trusted_notary_registry", "notary_registry"),
            ("session_authority_registry", "session_authority_registry"),
            ("binding_authority_registry", "binding_authority_registry"),
            ("trust_anchor_der", "trust_root"),
        ] {
            require(self.input(2, external)? == self.input(3, artifact)?, "external/bundle bytes")?;
        }
        Ok(())
    }
    fn bundle(&self) -> Result<BundleBytes> {
        let artifacts = self.entries.iter().filter(|entry| entry.kind == 3)
            .map(|entry| (entry.role.clone(), self.raw(entry).to_vec())).collect();
        Ok(BundleBytes { manifest: self.input(1, "bundle")?.to_vec(), artifacts })
    }
    fn options(&self) -> Result<BundleVerifierOptions> {
        let options = &self.control["options"];
        Ok(BundleVerifierOptions {
            evidence_root_key_id: string(options, "evidence-root-key-id")?.to_owned(),
            evidence_root_public_key_spki: string(options, "evidence-root-public-key-spki")?.to_owned(),
            trusted_notary_registry_raw: self.input(2, "trusted_notary_registry")?.to_vec(),
            session_authority_registry_raw: self.input(2, "session_authority_registry")?.to_vec(),
            session_authority_key_id: string(options, "session-authority-key-id")?.to_owned(),
            session_authority_public_key_spki: string(options, "session-authority-public-key-spki")?.to_owned(),
            binding_authority_registry_raw: self.input(2, "binding_authority_registry")?.to_vec(),
            binding_authority_key_id: string(options, "binding-authority-key-id")?.to_owned(),
            binding_authority_public_key_spki: string(options, "binding-authority-public-key-spki")?.to_owned(),
            canonical_user_id: string(options, "canonical-user-id")?.to_owned(),
            device_id: string(options, "device-id")?.to_owned(),
            device_public_key: string(options, "device-public-key")?.to_owned(),
            server_identity: string(options, "server-identity")?.to_owned(),
            origin_inventory_raw: self.input(2, "origin_inventory")?.to_vec(),
            target_approval_raw: self.input(2, "target_approval")?.to_vec(),
            profile_sha256: string(options, "profile-sha256")?.to_owned(),
            sparse_profile_sha256: options.get("sparse-profile-sha256").and_then(Value::as_str).map(str::to_owned),
            verifier_key_id: string(options, "verifier-key-id")?.to_owned(),
            trust_anchor_der: self.input(2, "trust_anchor_der")?.to_vec(),
        })
    }
}
pub fn parse_frame(bytes: Vec<u8>, limits: &FdInputLimits) -> Result<ParsedFrame> {
    let h = header(&bytes, bytes.len(), limits)?;
    let entries = table(&bytes[HEADER_BYTES..h.payload], &h, limits)?;
    let first = entries.first().ok_or(FdInputError::Invalid("missing control"))?;
    require(first.kind == 0 && first.role == "control", "control entry")?;
    require(crate::sha256(&bytes[first.offset..sum(first.offset, first.length)?]) == first.digest, "control digest")?;
    let control = limits.json(&bytes[first.offset..first.offset + first.length])?;
    let mut inventory = Sha256::new();
    inventory.update(INVENTORY_DOMAIN);
    inventory.update(&bytes[HEADER_BYTES..h.payload]);
    let binding = json!({
        "abi_version": 1, "frame_sha256": URL_SAFE_NO_PAD.encode(crate::sha256(&bytes)),
        "frame_byte_length": bytes.len(), "control_sha256": URL_SAFE_NO_PAD.encode(first.digest),
        "inventory_sha256": URL_SAFE_NO_PAD.encode(inventory.finalize()),
        "verifier_build_sha256": control["verifier_build_sha256"],
        "runtime_profile_sha256": control["runtime_profile_sha256"],
    });
    let parsed = ParsedFrame { bytes, entries, control, binding };
    parsed.validate(limits)?;
    Ok(parsed)
}

pub fn verify_frame_bytes(bytes: Vec<u8>, limits: &FdInputLimits, expected_binding: &Value) -> Result<Value> {
    parse_frame(bytes, limits)?.verify(expected_binding)
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
pub fn read_sealed_file(file: &std::fs::File, limits: &FdInputLimits) -> Result<ParsedFrame> {
    use nix::fcntl::{fcntl, FcntlArg, SealFlag};
    use std::os::unix::{fs::FileExt, fs::PermissionsExt};
    limits.validate()?;
    // Linux UAPI F_SEAL_EXEC is not named by nix 0.30's SealFlag.
    let required = (SealFlag::F_SEAL_WRITE | SealFlag::F_SEAL_GROW | SealFlag::F_SEAL_SHRINK | SealFlag::F_SEAL_SEAL).bits() | 0x0020;
    require(fcntl(file, FcntlArg::F_GET_SEALS)? & required == required, "missing immutable/noexec seals")?;
    // Length and execute bits must be inspected after the immutable seals.
    let metadata = file.metadata()?;
    require(metadata.is_file() && metadata.permissions().mode() & 0o111 == 0, "not a non-executable regular inode")?;
    require(metadata.len() <= limits.max_frame_bytes as u64, "frame size limit")?;
    let size = usize::try_from(metadata.len()).map_err(|_| FdInputError::Invalid("file size overflow"))?;
    let mut remaining = limits.max_read_calls;
    let mut read = |mut destination: &mut [u8], mut offset: u64| -> Result<()> {
        while !destination.is_empty() {
            require(remaining > 0, "read call limit")?;
            remaining -= 1;
            match file.read_at(destination, offset) {
                Ok(0) => return Err(FdInputError::Invalid("short positional read")),
                Ok(count) => {
                    offset = offset.checked_add(count as u64).ok_or(FdInputError::Invalid("read offset overflow"))?;
                    destination = &mut destination[count..];
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    };
    require(size >= HEADER_BYTES, "truncated header")?;
    let mut raw_header = [0; HEADER_BYTES];
    read(&mut raw_header, 0)?;
    let h = header(&raw_header, size, limits)?;
    let mut raw_table = Vec::new();
    raw_table.try_reserve_exact(h.table_length).map_err(|_| FdInputError::Invalid("table allocation refused"))?;
    raw_table.resize(h.table_length, 0);
    read(&mut raw_table, HEADER_BYTES as u64)?;
    table(&raw_table, &h, limits)?;
    let mut bytes = Vec::new();
    bytes.try_reserve_exact(size).map_err(|_| FdInputError::Invalid("frame allocation refused"))?;
    bytes.resize(size, 0);
    bytes[..HEADER_BYTES].copy_from_slice(&raw_header);
    bytes[HEADER_BYTES..h.payload].copy_from_slice(&raw_table);
    read(&mut bytes[h.payload..], h.payload as u64)?;
    parse_frame(bytes, limits)
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
pub fn read_sealed_stdin(limits: &FdInputLimits) -> Result<ParsedFrame> {
    use nix::fcntl::{fcntl, FcntlArg, FdFlag};
    use std::os::fd::AsFd;
    limits.validate()?;
    let stdin = std::io::stdin();
    let owned = stdin.as_fd().try_clone_to_owned()?;
    let flags = FdFlag::from_bits_retain(fcntl(&stdin, FcntlArg::F_GETFD)?);
    fcntl(&stdin, FcntlArg::F_SETFD(flags | FdFlag::FD_CLOEXEC))?;
    read_sealed_file(&std::fs::File::from(owned), limits)
}

#[cfg(not(all(target_os = "linux", target_arch = "x86_64")))]
pub fn read_sealed_stdin(_limits: &FdInputLimits) -> Result<ParsedFrame> {
    Err(FdInputError::Invalid("platform NOT_CHECKED"))
}

#[cfg(test)]
#[path = "offline_fd_tests.rs"]
mod tests;
