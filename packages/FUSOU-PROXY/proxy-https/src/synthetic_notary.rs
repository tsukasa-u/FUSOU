use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use fusou_tlsn_verifier::session_context::{
    NotarySessionContextAcceptance, SessionContextGrant, SESSION_CONTEXT_GRANT_EXTENSION_ID,
};
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tlsn::{
    attestation::{
        request::Request as AttestationRequest, Attestation, AttestationConfig, CryptoProvider,
        Extension, InvalidExtension,
    },
    connection::{CertBinding, ConnectionInfo, TranscriptLength},
    transcript::{ContentType, TlsTranscript, TranscriptCommitment},
};
use uuid::Uuid;

const STORE_SCHEMA_VERSION: u32 = 1;
const MAX_SAVED_RESULT_BYTES: usize = 8 * 1024 * 1024;
#[cfg(feature = "synthetic-tlsn")]
pub const LOCAL_TEST_NOTARY_ID: &str = "synthetic-notary-v1";
#[cfg(feature = "synthetic-tlsn")]
pub const LOCAL_TEST_ENVIRONMENT: &str = "local-test";
#[cfg(feature = "synthetic-tlsn")]
pub const LOCAL_TEST_SESSION_AUTHORITY_KEY_ID: &str = "synthetic-local-test-notary-v1";
static PROCESS_INSTANCE_ID: OnceLock<String> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotaryGrantStatus {
    Unused,
    Admitted,
    Signing,
    Finalized,
    Unknown,
    Rejected,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoreFile {
    schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    operational_config_sha256: Option<String>,
    process_instance_id: String,
    grants: BTreeMap<String, GrantRecord>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GrantRecord {
    operation_id: String,
    live_connection_id: String,
    authority_key_id: String,
    notary_id: String,
    environment: String,
    state: GrantState,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum GrantState {
    Admitted,
    Signing,
    Finalized { exact_result_base64url: String },
    Unknown,
    Rejected { reason: String },
}

struct DurableGrantStore {
    path: PathBuf,
    process_instance_id: String,
    operational_config_sha256: Option<String>,
    _instance_lock: Option<File>,
}

pub struct DurableNotary {
    store: DurableGrantStore,
    session_authority_public_key_spki: Vec<u8>,
    session_authority_key_id: String,
    notary_id: String,
    environment: String,
}

#[cfg(feature = "synthetic-tlsn")]
pub type LocalTestNotary = DurableNotary;

pub struct LiveNotarySessionContext {
    lease: LiveNotarySessionLease,
    grant: SessionContextGrant,
}

struct LiveNotarySessionLease {
    notary: Arc<DurableNotary>,
    grant_digest: String,
    operation_id: String,
    live_connection_id: String,
    process_instance_id: String,
    terminal: AtomicBool,
}

impl DurableNotary {
    #[cfg(feature = "synthetic-tlsn")]
    pub fn initialize_new(
        path: impl Into<PathBuf>,
        session_authority_public_key_spki: Vec<u8>,
        session_authority_key_id: impl Into<String>,
        notary_id: impl Into<String>,
        environment: impl Into<String>,
    ) -> Result<Arc<Self>, String> {
        let (session_authority_key_id, notary_id, environment) =
            Self::validated_scope(session_authority_key_id, notary_id, environment)?;
        let store = DurableGrantStore::for_path(path.into()).initialize_new()?;
        Ok(Self::with_store(
            store,
            session_authority_public_key_spki,
            session_authority_key_id,
            notary_id,
            environment,
        ))
    }

    #[cfg(feature = "synthetic-tlsn")]
    pub fn open_existing(
        path: impl Into<PathBuf>,
        session_authority_public_key_spki: Vec<u8>,
        session_authority_key_id: impl Into<String>,
        notary_id: impl Into<String>,
        environment: impl Into<String>,
    ) -> Result<Arc<Self>, String> {
        let (session_authority_key_id, notary_id, environment) =
            Self::validated_scope(session_authority_key_id, notary_id, environment)?;
        let store = DurableGrantStore::for_path(path.into()).open_existing()?;
        Ok(Self::with_store(
            store,
            session_authority_public_key_spki,
            session_authority_key_id,
            notary_id,
            environment,
        ))
    }

    #[cfg(all(unix, feature = "operational-notary"))]
    pub(crate) fn operational(
        directory: &std::path::Path,
        config_sha256: String,
        authority_key: Vec<u8>,
        authority_key_id: String,
        notary_id: String,
        environment: String,
        initialize: bool,
    ) -> Result<Arc<Self>, String> {
        let metadata = fs::symlink_metadata(directory)
            .map_err(|_| "operational ledger directory must already exist".to_owned())?;
        if !metadata.is_dir()
            || metadata.permissions().mode() & 0o077 != 0
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Err(
                "operational ledger directory must be private and owned by the service user"
                    .to_owned(),
            );
        }
        if initialize
            && fs::read_dir(directory)
                .map_err(|_| "cannot inspect operational ledger directory".to_owned())?
                .next()
                .is_some()
        {
            return Err("operational ledger initialization requires an empty directory".to_owned());
        }
        let path = directory.join("ledger.json");
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        if initialize {
            options.create_new(true).mode(0o600);
        }
        let instance_lock = options
            .open(directory.join("instance.lock"))
            .map_err(|_| "cannot open operational Notary instance lock".to_owned())?;
        validate_private_file(&instance_lock, "operational Notary instance lock")?;
        instance_lock.try_lock().map_err(|_| {
            "operational Notary ledger already in use or cannot be locked".to_owned()
        })?;
        if initialize {
            instance_lock
                .sync_all()
                .map_err(|_| "cannot sync instance lock".to_owned())?;
            sync_parent_directory(directory)?;
        }
        let mut store = DurableGrantStore::for_path(path);
        store._instance_lock = Some(instance_lock);
        store.operational_config_sha256 = Some(config_sha256);
        let store = if initialize {
            store.initialize_new()?
        } else {
            store.open_existing()?
        };
        Ok(Self::with_store(
            store,
            authority_key,
            authority_key_id,
            notary_id,
            environment,
        ))
    }

    #[cfg(feature = "synthetic-tlsn")]
    fn validated_scope(
        session_authority_key_id: impl Into<String>,
        notary_id: impl Into<String>,
        environment: impl Into<String>,
    ) -> Result<(String, String, String), String> {
        let session_authority_key_id = session_authority_key_id.into();
        let notary_id = notary_id.into();
        let environment = environment.into();
        if session_authority_key_id.is_empty() || notary_id.is_empty() || environment.is_empty() {
            return Err("Notary scope and authority key ID must be nonempty".to_owned());
        }
        Ok((session_authority_key_id, notary_id, environment))
    }

    fn with_store(
        store: DurableGrantStore,
        session_authority_public_key_spki: Vec<u8>,
        session_authority_key_id: String,
        notary_id: String,
        environment: String,
    ) -> Arc<Self> {
        Arc::new(Self {
            store,
            session_authority_public_key_spki,
            session_authority_key_id,
            notary_id,
            environment,
        })
    }

    pub fn admit_grant(
        self: &Arc<Self>,
        encoded_grant: &[u8],
        now_ms: u64,
    ) -> Result<LiveNotarySessionContext, String> {
        let grant = SessionContextGrant::parse(encoded_grant).map_err(|error| error.to_string())?;
        grant
            .verify(
                &self.session_authority_public_key_spki,
                &self.session_authority_key_id,
            )
            .map_err(|error| error.to_string())?;
        if now_ms < grant.issued_at_ms() || now_ms >= grant.expires_at_ms() {
            return Err("Session Authority grant is outside its validity window".to_owned());
        }

        let grant_digest = URL_SAFE_NO_PAD.encode(grant.digest());
        let operation_id = Uuid::new_v4().to_string();
        let live_connection_id = Uuid::new_v4().to_string();
        self.store.update(|database| {
            if database.grants.contains_key(&grant_digest) {
                return Err("Session Authority grant has already been admitted".to_owned());
            }
            database.grants.insert(
                grant_digest.clone(),
                GrantRecord {
                    operation_id: operation_id.clone(),
                    live_connection_id: live_connection_id.clone(),
                    authority_key_id: grant.signer_key_id().to_owned(),
                    notary_id: self.notary_id.clone(),
                    environment: self.environment.clone(),
                    state: GrantState::Admitted,
                },
            );
            Ok(())
        })?;

        Ok(LiveNotarySessionContext {
            lease: LiveNotarySessionLease {
                notary: Arc::clone(self),
                grant_digest,
                operation_id,
                live_connection_id,
                process_instance_id: self.store.process_instance_id.clone(),
                terminal: AtomicBool::new(false),
            },
            grant,
        })
    }

    pub fn status(&self, encoded_grant: &[u8]) -> Result<NotaryGrantStatus, String> {
        let grant = self.parse_and_verify_grant(encoded_grant)?;
        let digest = URL_SAFE_NO_PAD.encode(grant.digest());
        self.store.read(|database| {
            Ok(database.grants.get(&digest).map_or(
                NotaryGrantStatus::Unused,
                |record| match &record.state {
                    GrantState::Admitted => NotaryGrantStatus::Admitted,
                    GrantState::Signing => NotaryGrantStatus::Signing,
                    GrantState::Finalized { .. } => NotaryGrantStatus::Finalized,
                    GrantState::Unknown => NotaryGrantStatus::Unknown,
                    GrantState::Rejected { .. } => NotaryGrantStatus::Rejected,
                },
            ))
        })
    }

    pub fn exact_result(&self, encoded_grant: &[u8]) -> Result<Option<Vec<u8>>, String> {
        let grant = self.parse_and_verify_grant(encoded_grant)?;
        let digest = URL_SAFE_NO_PAD.encode(grant.digest());
        self.store.read(|database| {
            let Some(record) = database.grants.get(&digest) else {
                return Ok(None);
            };
            self.validate_record_scope(record, &grant)?;
            match &record.state {
                GrantState::Finalized {
                    exact_result_base64url,
                } => URL_SAFE_NO_PAD
                    .decode(exact_result_base64url)
                    .map(Some)
                    .map_err(|_| "stored Notary result encoding is corrupt".to_owned()),
                GrantState::Unknown | GrantState::Signing | GrantState::Admitted => Err(
                    "Notary result is Unknown or not finalized; re-signing is prohibited"
                        .to_owned(),
                ),
                GrantState::Rejected { .. } => {
                    Err("Notary grant is quarantined; re-signing is prohibited".to_owned())
                }
            }
        })
    }

    fn parse_and_verify_grant(&self, encoded: &[u8]) -> Result<SessionContextGrant, String> {
        let grant = SessionContextGrant::parse(encoded).map_err(|error| error.to_string())?;
        grant
            .verify(
                &self.session_authority_public_key_spki,
                &self.session_authority_key_id,
            )
            .map_err(|error| error.to_string())?;
        Ok(grant)
    }

    fn validate_record_scope(
        &self,
        record: &GrantRecord,
        grant: &SessionContextGrant,
    ) -> Result<(), String> {
        if record.authority_key_id != grant.signer_key_id()
            || record.authority_key_id != self.session_authority_key_id
            || record.notary_id != self.notary_id
            || record.environment != self.environment
        {
            return Err("persisted grant scope does not match this Notary instance".to_owned());
        }
        Ok(())
    }
}

impl LiveNotarySessionContext {
    #[cfg(test)]
    fn simulate_process_loss(&self) {
        self.lease.terminal.store(true, Ordering::Release);
    }

    pub fn validate_request_extensions(
        &self,
        extensions: &[Extension],
        now_ms: u64,
    ) -> Result<NotarySessionContextAcceptance, String> {
        if extensions.len() != 1 || extensions[0].id != SESSION_CONTEXT_GRANT_EXTENSION_ID {
            self.reject("unexpected or duplicated request extension");
            return Err(
                "request must contain exactly one Session Authority grant extension".to_owned(),
            );
        }
        let grant = match self
            .lease
            .notary
            .parse_and_verify_grant(&extensions[0].value)
        {
            Ok(grant) => grant,
            Err(error) => {
                self.reject("invalid Session Authority grant");
                return Err(error);
            }
        };
        if grant.digest() != self.grant.digest()
            || grant.encoded() != self.grant.encoded()
            || now_ms < grant.issued_at_ms()
            || now_ms >= grant.expires_at_ms()
        {
            self.reject("grant does not match the admitted live connection or validity window");
            return Err(
                "grant does not match the admitted live connection or validity window".to_owned(),
            );
        }

        let acceptance_time = now_ms;
        self.lease.notary.store.update(|database| {
            let record = database
                .grants
                .get_mut(&self.lease.grant_digest)
                .ok_or_else(|| "admitted Notary operation disappeared".to_owned())?;
            self.check_live_record(record, &database.process_instance_id)?;
            match &record.state {
                GrantState::Admitted => record.state = GrantState::Signing,
                GrantState::Signing
                | GrantState::Finalized { .. }
                | GrantState::Unknown
                | GrantState::Rejected { .. } => {
                    return Err("Notary operation cannot start a second signature".to_owned())
                }
            }
            Ok(())
        })?;

        NotarySessionContextAcceptance::from_persisted_authority_claim(&grant, acceptance_time)
            .map_err(|error| error.to_string())
    }

    pub fn finalize_exact_result(&self, exact_signed_result: &[u8]) -> Result<(), String> {
        if exact_signed_result.is_empty() || exact_signed_result.len() > MAX_SAVED_RESULT_BYTES {
            return Err("exact signed Notary result is empty or exceeds the size limit".to_owned());
        }
        let encoded_result = URL_SAFE_NO_PAD.encode(exact_signed_result);
        self.lease.notary.store.update(|database| {
            let record = database
                .grants
                .get_mut(&self.lease.grant_digest)
                .ok_or_else(|| "admitted Notary operation disappeared".to_owned())?;
            self.check_live_record(record, &database.process_instance_id)?;
            if !matches!(&record.state, GrantState::Signing) {
                return Err("Notary operation has no durable pre-signature claim".to_owned());
            }
            record.state = GrantState::Finalized {
                exact_result_base64url: encoded_result,
            };
            Ok(())
        })?;
        self.lease.terminal.store(true, Ordering::Release);
        Ok(())
    }

    fn reject(&self, reason: &'static str) {
        if let Err(error) = self.lease.notary.store.update(|database| {
            let Some(record) = database.grants.get_mut(&self.lease.grant_digest) else {
                return Ok(());
            };
            self.check_live_record(record, &database.process_instance_id)?;
            if matches!(&record.state, GrantState::Admitted) {
                record.state = GrantState::Rejected {
                    reason: reason.to_owned(),
                };
            }
            Ok(())
        }) {
            tracing::error!(%error, "failed to persist rejected Notary grant state");
        }
    }

    fn check_live_record(
        &self,
        record: &GrantRecord,
        database_process_instance_id: &str,
    ) -> Result<(), String> {
        if record.operation_id != self.lease.operation_id
            || record.live_connection_id != self.lease.live_connection_id
            || record.authority_key_id != self.grant.signer_key_id()
            || record.notary_id != self.lease.notary.notary_id
            || record.environment != self.lease.notary.environment
            || self.lease.process_instance_id != self.lease.notary.store.process_instance_id
            || self.lease.process_instance_id != database_process_instance_id
        {
            return Err("Notary operation is not bound to this live TLS connection".to_owned());
        }
        Ok(())
    }
}

pub(crate) fn sign_and_persist_attestation(
    request: AttestationRequest,
    tls_transcript: &TlsTranscript,
    transcript_commitments: Vec<TranscriptCommitment>,
    live_notary_session: LiveNotarySessionContext,
    notary_signing_key: &[u8],
    after_claim: impl FnOnce(),
) -> Result<(Attestation, Vec<u8>), String> {
    let mut provider = CryptoProvider::default();
    provider
        .signer
        .set_secp256k1(notary_signing_key)
        .map_err(|error| format!("configure Notary signer: {error}"))?;

    let accepted_context = Arc::new(Mutex::new(None));
    let live_session_slot = Arc::new(Mutex::new(Some(live_notary_session)));
    let validator_session_slot = Arc::clone(&live_session_slot);
    let accepted_context_slot = Arc::clone(&accepted_context);
    let mut config_builder = AttestationConfig::builder();
    config_builder
        .supported_signature_algs(provider.signer.supported_algs().collect::<Vec<_>>())
        .extension_validator(move |extensions| {
            let now_ms = notary_now_ms()
                .map_err(|_| InvalidExtension::new("Notary clock is before the epoch"))?;
            let live_session = validator_session_slot
                .lock()
                .map_err(|_| InvalidExtension::new("Notary session state is poisoned"))?
                .take()
                .ok_or_else(|| InvalidExtension::new("Notary session was already consumed"))?;
            let acceptance = live_session
                .validate_request_extensions(extensions, now_ms)
                .map_err(|error| InvalidExtension::new(error))?;
            let mut session_slot = validator_session_slot
                .lock()
                .map_err(|_| InvalidExtension::new("Notary session state is poisoned"))?;
            if session_slot.replace(live_session).is_some() {
                return Err(InvalidExtension::new(
                    "Notary session context was unexpectedly replaced",
                ));
            }
            let mut acceptance_slot = accepted_context_slot
                .lock()
                .map_err(|_| InvalidExtension::new("Notary acceptance state is poisoned"))?;
            if acceptance_slot.replace(acceptance).is_some() {
                return Err(InvalidExtension::new(
                    "Notary context was validated more than once",
                ));
            }
            Ok(())
        });
    let config = config_builder
        .build()
        .map_err(|error| format!("build Notary attestation policy: {error}"))?;
    let request_for_validation = request.clone();
    let mut attestation_builder = Attestation::builder(&config)
        .accept_request(request)
        .map_err(|error| format!("reject Notary attestation request: {error}"))?;

    after_claim();

    let live_notary_session = live_session_slot
        .lock()
        .map_err(|_| "Notary session state is poisoned".to_owned())?
        .take()
        .ok_or_else(|| "Notary session was already consumed".to_owned())?;
    let acceptance = accepted_context
        .lock()
        .map_err(|_| "Notary acceptance state is poisoned".to_owned())?
        .take()
        .ok_or_else(|| "Notary grant was not durably claimed".to_owned())?;
    attestation_builder.extension(acceptance.extension());

    let CertBinding::V1_2(binding) = tls_transcript.certificate_binding() else {
        return Err("unsupported TLS certificate binding version".to_owned());
    };
    let sent = application_data_length(tls_transcript, true)?;
    let received = application_data_length(tls_transcript, false)?;
    attestation_builder
        .connection_info(ConnectionInfo {
            time: tls_transcript.time(),
            version: tls_transcript.version(),
            transcript_length: TranscriptLength { sent, received },
        })
        .server_ephemeral_key(binding.server_ephemeral_key.clone())
        .transcript_commitments(transcript_commitments);
    let attestation = attestation_builder
        .build(&provider)
        .map_err(|error| format!("sign Notary attestation: {error}"))?;
    request_for_validation
        .validate(&attestation, &CryptoProvider::default())
        .map_err(|error| format!("validate signed Notary attestation: {error}"))?;
    let exact_result = bincode::serialize(&attestation)
        .map_err(|error| format!("serialize signed Notary attestation: {error}"))?;
    live_notary_session.finalize_exact_result(&exact_result)?;
    Ok((attestation, exact_result))
}

fn application_data_length(tls_transcript: &TlsTranscript, sent: bool) -> Result<u32, String> {
    let records = if sent {
        tls_transcript.sent()
    } else {
        tls_transcript.recv()
    };
    records
        .iter()
        .filter(|record| record.typ == ContentType::ApplicationData)
        .map(|record| record.ciphertext.len())
        .try_fold(0_u32, |total, length| {
            let length = u32::try_from(length)
                .map_err(|_| "TLS transcript length exceeds Notary limit".to_owned())?;
            total
                .checked_add(length)
                .ok_or_else(|| "TLS transcript length exceeds Notary limit".to_owned())
        })
}

fn notary_now_ms() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Notary clock is before the epoch: {error}"))?
        .as_millis();
    u64::try_from(millis).map_err(|error| format!("Notary clock is out of range: {error}"))
}

impl LiveNotarySessionLease {
    fn mark_unknown(&self) -> Result<(), String> {
        self.notary.store.update(|database| {
            let Some(record) = database.grants.get_mut(&self.grant_digest) else {
                return Err("admitted Notary operation disappeared".to_owned());
            };
            if record.operation_id != self.operation_id
                || record.live_connection_id != self.live_connection_id
                || record.authority_key_id != self.notary.session_authority_key_id
                || record.notary_id != self.notary.notary_id
                || record.environment != self.notary.environment
                || database.process_instance_id != self.process_instance_id
            {
                return Err("Notary operation scope changed before finalization".to_owned());
            }
            if matches!(&record.state, GrantState::Admitted | GrantState::Signing) {
                record.state = GrantState::Unknown;
            }
            Ok(())
        })
    }
}

impl Drop for LiveNotarySessionLease {
    fn drop(&mut self) {
        if !self.terminal.load(Ordering::Acquire) {
            if let Err(error) = self.mark_unknown() {
                tracing::error!(%error, "failed to persist Unknown Notary operation state");
            }
        }
    }
}

impl DurableGrantStore {
    fn initialize_new(self) -> Result<Self, String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "Notary store path must have a parent directory".to_owned())?
            .to_path_buf();
        ensure_private_directory(&parent)?;
        let store = self;
        let lock_path = store.lock_path();
        if store
            .path
            .try_exists()
            .map_err(|error| format!("inspect Notary store before initialization: {error}"))?
            || lock_path.try_exists().map_err(|error| {
                format!("inspect Notary store lock before initialization: {error}")
            })?
        {
            return Err(
                "Notary store or lock already exists; initialization is refused".to_owned(),
            );
        }

        let mut options = OpenOptions::new();
        options.create_new(true).read(true).write(true);
        #[cfg(unix)]
        options.mode(0o600);
        let lock = options
            .open(&lock_path)
            .map_err(|error| format!("create Notary store lock: {error}"))?;
        lock.lock()
            .map_err(|error| format!("lock new Notary store: {error}"))?;
        lock.sync_all()
            .map_err(|error| format!("sync new Notary store lock: {error}"))?;
        sync_parent_directory(&parent)?;
        store.create_initial_state()?;
        drop(lock);
        Ok(store)
    }

    fn open_existing(self) -> Result<Self, String> {
        let store = self;
        store.update(|database| {
            if database.process_instance_id != store.process_instance_id {
                for record in database.grants.values_mut() {
                    if matches!(&record.state, GrantState::Admitted | GrantState::Signing) {
                        record.state = GrantState::Unknown;
                    }
                }
                database.process_instance_id = store.process_instance_id.clone();
            }
            Ok(())
        })?;
        Ok(store)
    }

    fn for_path(path: PathBuf) -> Self {
        Self {
            path,
            process_instance_id: PROCESS_INSTANCE_ID
                .get_or_init(|| Uuid::new_v4().to_string())
                .clone(),
            operational_config_sha256: None,
            _instance_lock: None,
        }
    }

    fn lock_path(&self) -> PathBuf {
        self.path.with_extension("lock")
    }

    fn lock(&self) -> Result<File, String> {
        let mut options = OpenOptions::new();
        options.read(true).write(true);
        #[cfg(unix)]
        if self._instance_lock.is_some() {
            options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        let lock = options
            .open(self.lock_path())
            .map_err(|error| format!("open Notary store lock: {error}"))?;
        #[cfg(unix)]
        if self._instance_lock.is_some() {
            validate_private_file(&lock, "operational ledger lock")?;
        }
        lock.lock()
            .map_err(|error| format!("lock Notary store: {error}"))?;
        Ok(lock)
    }

    fn read<R>(&self, action: impl FnOnce(&StoreFile) -> Result<R, String>) -> Result<R, String> {
        let _lock = self.lock()?;
        let database = self.load()?;
        action(&database)
    }

    fn update<R>(
        &self,
        action: impl FnOnce(&mut StoreFile) -> Result<R, String>,
    ) -> Result<R, String> {
        let _lock = self.lock()?;
        let mut database = self.load()?;
        let result = action(&mut database)?;
        self.save(&database)?;
        Ok(result)
    }

    fn load(&self) -> Result<StoreFile, String> {
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        if self._instance_lock.is_some() {
            options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        let mut file = options
            .open(&self.path)
            .map_err(|error| format!("open existing Notary store: {error}"))?;
        #[cfg(unix)]
        if self._instance_lock.is_some() {
            validate_private_file(&file, "operational ledger state")?;
        } else {
            let metadata = file
                .metadata()
                .map_err(|error| format!("inspect Notary store permissions: {error}"))?;
            let mut permissions = metadata.permissions();
            if permissions.mode() & 0o077 != 0 {
                permissions.set_mode(0o600);
                file.set_permissions(permissions)
                    .map_err(|error| format!("restrict Notary store permissions: {error}"))?;
            }
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|error| format!("read Notary store: {error}"))?;
        let database: StoreFile = serde_json::from_slice(&bytes)
            .map_err(|error| format!("parse Notary store: {error}"))?;
        if database.schema_version != STORE_SCHEMA_VERSION {
            return Err("unsupported Notary store schema version".to_owned());
        }
        if database.operational_config_sha256 != self.operational_config_sha256 {
            return Err("Notary ledger does not match the operator configuration".to_owned());
        }
        Ok(database)
    }

    fn create_initial_state(&self) -> Result<(), String> {
        let database = StoreFile {
            schema_version: STORE_SCHEMA_VERSION,
            operational_config_sha256: self.operational_config_sha256.clone(),
            process_instance_id: self.process_instance_id.clone(),
            grants: BTreeMap::new(),
        };
        let bytes = serde_json::to_vec(&database)
            .map_err(|error| format!("serialize initial Notary store: {error}"))?;
        let temporary_path = self.path.with_extension(format!("tmp-{}", Uuid::new_v4()));
        let write_result = (|| {
            let mut options = OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options
                .open(&temporary_path)
                .map_err(|error| format!("create initial Notary store: {error}"))?;
            file.write_all(&bytes)
                .map_err(|error| format!("write initial Notary store: {error}"))?;
            file.sync_all()
                .map_err(|error| format!("sync initial Notary store: {error}"))?;
            fs::hard_link(&temporary_path, &self.path).map_err(|error| {
                format!("install initial Notary store without overwrite: {error}")
            })?;
            if let Err(error) = fs::remove_file(&temporary_path) {
                tracing::warn!(%error, path = %temporary_path.display(), "failed to remove initial Notary store temporary link");
            }
            sync_parent_directory(
                self.path
                    .parent()
                    .ok_or_else(|| "Notary store path lost its parent directory".to_owned())?,
            )
        })();
        if write_result.is_err() {
            if let Err(error) = fs::remove_file(&temporary_path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    tracing::error!(%error, path = %temporary_path.display(), "failed to clean up incomplete initial Notary store");
                }
            }
        }
        write_result
    }

    fn save(&self, database: &StoreFile) -> Result<(), String> {
        let bytes = serde_json::to_vec(database)
            .map_err(|error| format!("serialize Notary store: {error}"))?;
        let temporary_path = self.path.with_extension(format!("tmp-{}", Uuid::new_v4()));
        let write_result = (|| {
            let mut options = OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options
                .open(&temporary_path)
                .map_err(|error| format!("create temporary Notary store: {error}"))?;
            file.write_all(&bytes)
                .map_err(|error| format!("write temporary Notary store: {error}"))?;
            file.sync_all()
                .map_err(|error| format!("sync temporary Notary store: {error}"))?;
            fs::rename(&temporary_path, &self.path)
                .map_err(|error| format!("replace Notary store: {error}"))?;
            let parent = self
                .path
                .parent()
                .ok_or_else(|| "Notary store path lost its parent directory".to_owned())?;
            sync_parent_directory(parent)
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary_path);
        }
        write_result
    }
}

#[cfg(unix)]
fn validate_private_file(file: &File, label: &str) -> Result<(), String> {
    let metadata = file
        .metadata()
        .map_err(|_| format!("could not inspect {label}"))?;
    if !metadata.is_file()
        || metadata.nlink() != 1
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err(format!(
            "invalid {label} file type, ownership or permissions"
        ));
    }
    Ok(())
}

fn sync_parent_directory(path: &std::path::Path) -> Result<(), String> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("sync Notary store directory: {error}"))
}

fn ensure_private_directory(path: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true).mode(0o700);
        match builder.create(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let metadata = fs::metadata(path)
                    .map_err(|error| format!("inspect Notary store directory: {error}"))?;
                let mut permissions = metadata.permissions();
                if permissions.mode() & 0o077 != 0 {
                    permissions.set_mode(0o700);
                    fs::set_permissions(path, permissions)
                        .map_err(|error| format!("restrict Notary store directory: {error}"))?;
                }
                Ok(())
            }
            Err(error) => Err(format!("create Notary store directory: {error}")),
        }
    }
    #[cfg(not(unix))]
    {
        fs::create_dir_all(path).map_err(|error| format!("create Notary store directory: {error}"))
    }
}

#[cfg(all(test, feature = "synthetic-tlsn"))]
mod tests {
    use super::*;
    use crate::synthetic_tlsn::{
        synthetic_attestation_binding, synthetic_session_authority_public_key_spki,
        SYNTHETIC_SESSION_AUTHORITY_KEY_ID,
    };
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use fusou_tlsn_verifier::session_context::SESSION_CONTEXT_GRANT_EXTENSION_ID;
    use std::{
        process::{Command, Output},
        sync::Barrier,
        thread,
        time::SystemTime,
    };

    const RESTART_TEST_MODE_ENV: &str = "FUSOU_LOCAL_NOTARY_RESTART_TEST_MODE";
    const RESTART_TEST_STORE_ENV: &str = "FUSOU_LOCAL_NOTARY_RESTART_TEST_STORE";
    const RESTART_TEST_GRANT_ENV: &str = "FUSOU_LOCAL_NOTARY_RESTART_TEST_GRANT";

    struct TempStoreDir(PathBuf);

    impl Drop for TempStoreDir {
        fn drop(&mut self) {
            if let Err(error) = fs::remove_dir_all(&self.0) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    panic!(
                        "remove temporary Notary store {}: {error}",
                        self.0.display()
                    );
                }
            }
        }
    }

    fn unique_temp_dir() -> TempStoreDir {
        TempStoreDir(std::env::temp_dir().join(format!("fusou_local_notary_{}", Uuid::new_v4())))
    }

    fn grant_bytes() -> Vec<u8> {
        let mut binding = fusou_tlsn_verifier::BINDING_PREFIX.to_vec();
        binding.extend_from_slice(&16_u16.to_be_bytes());
        binding.extend_from_slice(
            Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000")
                .expect("test session ID")
                .as_bytes(),
        );
        binding.extend_from_slice(&32_u16.to_be_bytes());
        binding.extend_from_slice(&[0x42; 32]);
        let value = URL_SAFE_NO_PAD.encode(binding);
        synthetic_attestation_binding(value)
            .expect("test authority grant")
            .session_context_grant()
            .expect("test grant extension")
            .bytes()
            .to_vec()
    }

    fn grant_bytes_for_identity(session_id: &str, device_id: &str) -> Vec<u8> {
        let session_id = Uuid::parse_str(session_id).expect("test session UUID");
        let mut binding = fusou_tlsn_verifier::BINDING_PREFIX.to_vec();
        binding.extend_from_slice(&16_u16.to_be_bytes());
        binding.extend_from_slice(session_id.as_bytes());
        binding.extend_from_slice(&32_u16.to_be_bytes());
        binding.extend_from_slice(&[0x42; 32]);
        let binding_value = URL_SAFE_NO_PAD.encode(binding);
        let issued_at_ms = now_ms();
        let expires_at_ms = issued_at_ms + 60_000;
        let signing_bytes = SessionContextGrant::signing_bytes_for(
            SYNTHETIC_SESSION_AUTHORITY_KEY_ID,
            &session_id.to_string(),
            &binding_value,
            fusou_tlsn_verifier::session_context::device_id_commitment(device_id)
                .expect("test device commitment"),
            [0x33; 32],
            issued_at_ms,
            expires_at_ms,
        )
        .expect("test grant signing bytes");
        let key_pair = ring::signature::Ed25519KeyPair::from_seed_unchecked(&[42; 32])
            .expect("test Session Authority key");
        let mut encoded = signing_bytes.clone();
        encoded.extend_from_slice(key_pair.sign(&signing_bytes).as_ref());
        encoded
    }

    fn try_initialize_test_notary(path: PathBuf) -> Result<Arc<LocalTestNotary>, String> {
        LocalTestNotary::initialize_new(
            path,
            synthetic_session_authority_public_key_spki(),
            SYNTHETIC_SESSION_AUTHORITY_KEY_ID,
            LOCAL_TEST_NOTARY_ID,
            LOCAL_TEST_ENVIRONMENT,
        )
    }

    fn initialize_test_notary(path: PathBuf) -> Arc<LocalTestNotary> {
        try_initialize_test_notary(path).expect("initialize local test Notary")
    }

    fn reopen_test_notary(path: PathBuf) -> Result<Arc<LocalTestNotary>, String> {
        LocalTestNotary::open_existing(
            path,
            synthetic_session_authority_public_key_spki(),
            SYNTHETIC_SESSION_AUTHORITY_KEY_ID,
            LOCAL_TEST_NOTARY_ID,
            LOCAL_TEST_ENVIRONMENT,
        )
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock before epoch")
            .as_millis() as u64
    }

    fn mark_store_as_prior_process(path: &PathBuf) {
        let prior_process_id = "simulated-prior-process".to_owned();
        let mut stale_store = DurableGrantStore::for_path(path.clone());
        stale_store.process_instance_id = prior_process_id.clone();
        stale_store
            .update(|database| {
                database.process_instance_id = prior_process_id;
                Ok(())
            })
            .expect("mark persisted store as owned by prior process");
    }

    fn run_restart_child(path: &PathBuf, mode: &str, grant: &[u8]) -> Output {
        Command::new(std::env::current_exe().expect("current test executable"))
            .arg("--exact")
            .arg("synthetic_notary::tests::notary_restart_child_process_entry")
            .arg("--nocapture")
            .env(RESTART_TEST_MODE_ENV, mode)
            .env(RESTART_TEST_STORE_ENV, path)
            .env(RESTART_TEST_GRANT_ENV, URL_SAFE_NO_PAD.encode(grant))
            .output()
            .expect("run Notary restart child process")
    }

    fn extension(grant: &[u8]) -> Extension {
        Extension {
            id: SESSION_CONTEXT_GRANT_EXTENSION_ID.to_vec(),
            value: grant.to_vec(),
        }
    }

    #[test]
    fn durable_notary_claims_once_and_returns_the_exact_saved_result() {
        let temp_dir = unique_temp_dir();
        let path = temp_dir.0.join("state.json");
        let notary = initialize_test_notary(path.clone());
        let grant = grant_bytes();
        let live = notary
            .admit_grant(&grant, now_ms())
            .expect("admit Session Authority grant");
        assert_eq!(
            notary.status(&grant).expect("grant status"),
            NotaryGrantStatus::Admitted
        );
        live.validate_request_extensions(&[extension(&grant)], now_ms())
            .expect("claim before signing");
        assert_eq!(
            notary.status(&grant).expect("signing status"),
            NotaryGrantStatus::Signing
        );
        let exact_result = b"signed Notary result bytes";
        live.finalize_exact_result(exact_result)
            .expect("persist exact signed result");
        assert_eq!(
            notary.status(&grant).expect("finalized status"),
            NotaryGrantStatus::Finalized
        );
        assert_eq!(
            notary.exact_result(&grant).expect("read exact result"),
            Some(exact_result.to_vec())
        );
        assert!(notary.admit_grant(&grant, now_ms()).is_err());
        mark_store_as_prior_process(&path);
        let reopened = reopen_test_notary(path).expect("reopen finalized local test Notary");
        assert_eq!(
            reopened.status(&grant).expect("restarted finalized status"),
            NotaryGrantStatus::Finalized
        );
        assert_eq!(
            reopened.exact_result(&grant).expect("reopen exact result"),
            Some(exact_result.to_vec())
        );
    }

    #[test]
    fn process_restart_preserves_durable_notary_states_and_exact_result_bytes() {
        for (mode, expected_status) in [
            ("admitted", NotaryGrantStatus::Unknown),
            ("signing", NotaryGrantStatus::Unknown),
            ("finalized", NotaryGrantStatus::Finalized),
        ] {
            let temp_dir = unique_temp_dir();
            let path = temp_dir.0.join("state.json");
            let grant = grant_bytes();
            let output = run_restart_child(&path, mode, &grant);
            assert!(
                output.status.success(),
                "Notary restart child failed in {mode} mode: stdout={} stderr={}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );

            let reopened = reopen_test_notary(path).expect("reopen local test Notary");
            assert_eq!(
                reopened.status(&grant).expect("restarted grant status"),
                expected_status,
                "unexpected grant status after {mode} restart"
            );
            if mode == "finalized" {
                assert_eq!(
                    reopened
                        .exact_result(&grant)
                        .expect("read exact result after process restart"),
                    Some(b"exact finalized result bytes".to_vec())
                );
            } else {
                assert!(reopened.exact_result(&grant).is_err());
                assert!(reopened.admit_grant(&grant, now_ms()).is_err());
            }
        }
    }

    #[test]
    fn missing_store_file_fails_closed_for_all_persisted_states() {
        for expected_status in [
            NotaryGrantStatus::Admitted,
            NotaryGrantStatus::Signing,
            NotaryGrantStatus::Unknown,
            NotaryGrantStatus::Finalized,
        ] {
            let temp_dir = unique_temp_dir();
            let path = temp_dir.0.join("state.json");
            let grant = grant_bytes();
            let notary = initialize_test_notary(path.clone());
            let live = notary
                .admit_grant(&grant, now_ms())
                .expect("admit grant before removing its store");
            match expected_status {
                NotaryGrantStatus::Admitted => live.simulate_process_loss(),
                NotaryGrantStatus::Signing => {
                    live.validate_request_extensions(&[extension(&grant)], now_ms())
                        .expect("persist Signing state");
                    live.simulate_process_loss();
                }
                NotaryGrantStatus::Unknown => drop(live),
                NotaryGrantStatus::Finalized => {
                    live.validate_request_extensions(&[extension(&grant)], now_ms())
                        .expect("persist signature claim");
                    live.finalize_exact_result(b"exact finalized result bytes")
                        .expect("persist Finalized state");
                }
                _ => unreachable!("only persisted nonterminal and Finalized states are tested"),
            }
            assert_eq!(
                notary.status(&grant).expect("pre-removal status"),
                expected_status
            );

            fs::remove_file(&path).expect("remove initialized Notary state file");
            assert!(notary.status(&grant).is_err());
            assert!(notary.exact_result(&grant).is_err());
            assert!(notary.admit_grant(&grant, now_ms()).is_err());
            assert!(reopen_test_notary(path.clone()).is_err());

            let output = run_restart_child(&path, "open-existing", &[]);
            assert!(
                output.status.success(),
                "missing-store reopen child failed: stdout={} stderr={}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(try_initialize_test_notary(path).is_err());
        }
    }

    #[test]
    fn explicit_store_initialization_rejects_existing_store_without_overwriting() {
        let temp_dir = unique_temp_dir();
        let path = temp_dir.0.join("state.json");
        let notary = initialize_test_notary(path.clone());
        let grant = grant_bytes();
        assert_eq!(
            notary.status(&grant).expect("new store status"),
            NotaryGrantStatus::Unused
        );
        let original_state = fs::read(&path).expect("read new store");

        assert!(try_initialize_test_notary(path.clone()).is_err());
        assert_eq!(
            fs::read(&path).expect("read store after duplicate initialization"),
            original_state
        );
        drop(notary);
        assert_eq!(
            reopen_test_notary(path)
                .expect("open existing initialized store")
                .status(&grant)
                .expect("existing store status"),
            NotaryGrantStatus::Unused
        );
    }

    #[test]
    fn corrupt_unreadable_and_unsupported_stores_fail_closed() {
        for corruption in ["truncated", "directory", "unsupported-schema"] {
            let temp_dir = unique_temp_dir();
            let path = temp_dir.0.join("state.json");
            let notary = initialize_test_notary(path.clone());
            drop(notary);

            match corruption {
                "truncated" => fs::write(&path, b"{").expect("truncate Notary store"),
                "directory" => {
                    fs::remove_file(&path).expect("remove Notary state before unreadable case");
                    fs::create_dir(&path).expect("replace Notary state file with directory");
                }
                "unsupported-schema" => {
                    let mut store: serde_json::Value = serde_json::from_slice(
                        &fs::read(&path).expect("read Notary store before schema mutation"),
                    )
                    .expect("parse Notary store JSON");
                    store["schema_version"] = serde_json::Value::from(99_u64);
                    fs::write(
                        &path,
                        serde_json::to_vec(&store).expect("encode unsupported schema"),
                    )
                    .expect("write unsupported Notary schema");
                }
                _ => unreachable!("corruption case is enumerated"),
            }

            assert!(
                reopen_test_notary(path.clone()).is_err(),
                "{corruption} Notary store must not be opened"
            );
            assert!(
                try_initialize_test_notary(path).is_err(),
                "{corruption} Notary store must not be reinitialized"
            );
        }
    }

    #[test]
    fn notary_restart_child_process_entry() {
        let Some(mode) = std::env::var_os(RESTART_TEST_MODE_ENV) else {
            return;
        };
        let path = PathBuf::from(
            std::env::var_os(RESTART_TEST_STORE_ENV).expect("Notary child store path"),
        );
        if mode == "open-existing" {
            assert!(reopen_test_notary(path).is_err());
            return;
        }
        let notary = initialize_test_notary(path);
        let grant = URL_SAFE_NO_PAD
            .decode(std::env::var(RESTART_TEST_GRANT_ENV).expect("Notary child grant"))
            .expect("valid encoded child grant");
        let live = notary
            .admit_grant(&grant, now_ms())
            .expect("admit Session Authority grant in child");
        if mode == "signing" || mode == "finalized" {
            live.validate_request_extensions(&[extension(&grant)], now_ms())
                .expect("claim grant before signing in child");
        }
        if mode == "finalized" {
            live.finalize_exact_result(b"exact finalized result bytes")
                .expect("persist exact result in child");
            return;
        }
        assert!(mode == "admitted" || mode == "signing");
        std::mem::forget(live);
    }

    #[test]
    fn concurrent_grant_admission_has_exactly_one_winner() {
        let temp_dir = unique_temp_dir();
        let path = temp_dir.0.join("state.json");
        let notary = initialize_test_notary(path);
        let grant = grant_bytes();
        let barrier = Arc::new(Barrier::new(3));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let notary = Arc::clone(&notary);
            let grant = grant.clone();
            let barrier = Arc::clone(&barrier);
            workers.push(thread::spawn(move || {
                barrier.wait();
                notary.admit_grant(&grant, now_ms()).is_ok()
            }));
        }
        barrier.wait();
        let winners = workers
            .into_iter()
            .map(|worker| usize::from(worker.join().expect("admission worker")))
            .sum::<usize>();
        assert_eq!(winners, 1);
        assert!(matches!(
            notary.status(&grant).expect("grant status"),
            NotaryGrantStatus::Admitted | NotaryGrantStatus::Unknown
        ));
    }

    #[test]
    fn restart_preserves_unknown_and_never_reopens_a_signature_claim() {
        let temp_dir = unique_temp_dir();
        let path = temp_dir.0.join("state.json");
        let grant = grant_bytes();
        let first = initialize_test_notary(path.clone());
        let live = first
            .admit_grant(&grant, now_ms())
            .expect("admit grant before simulated restart");
        live.validate_request_extensions(&[extension(&grant)], now_ms())
            .expect("persist signature claim");
        live.simulate_process_loss();
        drop(live);
        drop(first);
        mark_store_as_prior_process(&path);
        let reopened = reopen_test_notary(path).expect("reopen local test Notary");
        assert_eq!(
            reopened.status(&grant).expect("restarted grant status"),
            NotaryGrantStatus::Unknown
        );
        assert!(reopened.exact_result(&grant).is_err());
        assert!(reopened.admit_grant(&grant, now_ms()).is_err());
    }

    #[test]
    fn mismatched_or_client_supplied_acceptance_extensions_are_quarantined() {
        let temp_dir = unique_temp_dir();
        let path = temp_dir.0.join("state.json");
        let notary = initialize_test_notary(path);
        let grant = grant_bytes();
        let live = notary.admit_grant(&grant, now_ms()).expect("admit grant");
        let mut changed_grant = grant.clone();
        let last = changed_grant.len() - 1;
        changed_grant[last] ^= 1;
        assert!(live
            .validate_request_extensions(&[extension(&changed_grant)], now_ms())
            .is_err());
        assert_eq!(
            notary.status(&grant).expect("quarantined status"),
            NotaryGrantStatus::Rejected
        );

        let second_grant = grant_bytes();
        let second = notary
            .admit_grant(&second_grant, now_ms())
            .expect("admit independent grant");
        let forged_acceptance = Extension {
            id: fusou_tlsn_verifier::session_context::NOTARY_SESSION_CONTEXT_ACCEPTED_EXTENSION_ID
                .to_vec(),
            value: vec![1, 2, 3],
        };
        assert!(second
            .validate_request_extensions(&[extension(&second_grant), forged_acceptance], now_ms())
            .is_err());
        assert_eq!(
            notary.status(&second_grant).expect("rejected status"),
            NotaryGrantStatus::Rejected
        );
    }

    #[test]
    fn another_session_or_device_grant_cannot_be_substituted_on_a_live_connection() {
        let session_id = "123e4567-e89b-42d3-a456-426614174000";
        let device_id = "22222222-2222-4222-8222-222222222222";
        let other_session_id = "323e4567-e89b-42d3-a456-426614174000";
        let other_device_id = "33333333-3333-4333-8333-333333333333";
        for (grant, substituted_grant) in [
            (
                grant_bytes_for_identity(session_id, device_id),
                grant_bytes_for_identity(other_session_id, device_id),
            ),
            (
                grant_bytes_for_identity(session_id, device_id),
                grant_bytes_for_identity(session_id, other_device_id),
            ),
        ] {
            let temp_dir = unique_temp_dir();
            let notary = initialize_test_notary(temp_dir.0.join("state.json"));
            let live = notary
                .admit_grant(&grant, now_ms())
                .expect("admit original grant");
            assert!(live
                .validate_request_extensions(&[extension(&substituted_grant)], now_ms())
                .is_err());
            assert_eq!(
                notary.status(&grant).expect("mismatched grant status"),
                NotaryGrantStatus::Rejected
            );
        }
    }

    #[test]
    fn another_live_notary_connection_cannot_accept_the_first_connections_grant() {
        let temp_dir = unique_temp_dir();
        let notary = initialize_test_notary(temp_dir.0.join("state.json"));
        let first_grant = grant_bytes_for_identity(
            "123e4567-e89b-42d3-a456-426614174000",
            "22222222-2222-4222-8222-222222222222",
        );
        let second_grant = grant_bytes_for_identity(
            "323e4567-e89b-42d3-a456-426614174000",
            "33333333-3333-4333-8333-333333333333",
        );
        let first_connection = notary
            .admit_grant(&first_grant, now_ms())
            .expect("admit first live connection");
        let second_connection = notary
            .admit_grant(&second_grant, now_ms())
            .expect("admit second live connection");

        assert_ne!(
            first_connection.lease.live_connection_id,
            second_connection.lease.live_connection_id
        );
        assert!(second_connection
            .validate_request_extensions(&[extension(&first_grant)], now_ms())
            .is_err());
        assert_eq!(
            notary.status(&first_grant).expect("first grant status"),
            NotaryGrantStatus::Admitted
        );
        assert_eq!(
            notary.status(&second_grant).expect("second grant status"),
            NotaryGrantStatus::Rejected
        );
    }

    #[test]
    fn wrong_session_authority_pin_is_rejected_at_admission() {
        let temp_dir = unique_temp_dir();
        let notary = LocalTestNotary::initialize_new(
            temp_dir.0.join("state.json"),
            synthetic_session_authority_public_key_spki(),
            "different-session-authority-v1",
            LOCAL_TEST_NOTARY_ID,
            LOCAL_TEST_ENVIRONMENT,
        )
        .expect("open Notary with mismatched authority pin");
        assert!(notary.admit_grant(&grant_bytes(), now_ms()).is_err());
    }

    #[test]
    fn restart_after_admission_marks_operation_unknown_without_signature() {
        let temp_dir = unique_temp_dir();
        let path = temp_dir.0.join("state.json");
        let grant = grant_bytes();
        let notary = initialize_test_notary(path.clone());
        let live = notary.admit_grant(&grant, now_ms()).expect("admit grant");
        live.simulate_process_loss();
        drop(live);
        drop(notary);
        mark_store_as_prior_process(&path);
        let reopened = reopen_test_notary(path).expect("reopen local test Notary");
        assert_eq!(
            reopened.status(&grant).expect("grant status"),
            NotaryGrantStatus::Unknown
        );
        assert!(reopened.exact_result(&grant).is_err());
    }

    #[test]
    fn result_query_requires_the_pinned_authority_signature() {
        let temp_dir = unique_temp_dir();
        let path = temp_dir.0.join("state.json");
        let notary = initialize_test_notary(path);
        let grant = grant_bytes();
        let mut invalid_grant = grant.clone();
        let last = invalid_grant.len() - 1;
        invalid_grant[last] ^= 1;
        assert!(notary.exact_result(&invalid_grant).is_err());
        assert_eq!(
            notary.status(&grant).expect("unadmitted status"),
            NotaryGrantStatus::Unused
        );
    }
}
