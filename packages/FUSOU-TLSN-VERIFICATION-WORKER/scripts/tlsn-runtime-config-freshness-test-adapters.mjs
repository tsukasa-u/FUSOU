import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign as signBytes,
} from "node:crypto";
import { canonicalJson } from "./production-trust-contract.mjs";
import {
  TLSN_RUNTIME_CONFIG_FRESHNESS as C,
  runtimeConfigFreshnessSigningBytes,
  verifyFreshnessManifestBinding,
  verifyRuntimeConfigDelegation,
  verifyRuntimeConfigFreshnessRequest,
  verifyRuntimeConfigFreshnessResponse,
  verifyRuntimeConfigReleaseCommitRecord,
} from "./tlsn-runtime-config-freshness.mjs";

const ARTIFACT_KEY_PATTERN =
  /^tlsn\/runtime-config\/v2\/artifacts\/(?:worker-reference|origin-inventory|target-approval|security-registry-set|result-registry-envelope)\/[A-Za-z0-9_-]{43}$/;

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function clone(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function timestamp(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function signedEnvelope({ scope, keyIdField, keyId, domain, payload, privateKey }) {
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  const signature = signBytes(
    null,
    runtimeConfigFreshnessSigningBytes(domain, keyId, payloadBytes),
    privateKey,
  );
  const envelope = {
    schema_version: 1,
    scope,
    signature_algorithm: "Ed25519",
    [keyIdField]: keyId,
    payload_base64url: payloadBytes.toString("base64url"),
    signature_base64url: signature.toString("base64url"),
  };
  return Buffer.from(canonicalJson(envelope), "utf8");
}

export function createTestEd25519KeyPair() {
  const pair = generateKeyPairSync("ed25519");
  return Object.freeze({
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeySpki: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  });
}

export function createTestRuntimeConfigDelegation({
  rootPrivateKey,
  rootKeyId,
  payload,
}) {
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  const signature = signBytes(
    null,
    runtimeConfigFreshnessSigningBytes(C.delegationDomain, rootKeyId, payloadBytes),
    rootPrivateKey,
  );
  return Buffer.from(canonicalJson({
    schema_version: 1,
    scope: C.delegationEnvelopeScope,
    signature_algorithm: "Ed25519",
    root_key_id: rootKeyId,
    payload_base64url: payloadBytes.toString("base64url"),
    signature_base64url: signature.toString("base64url"),
  }), "utf8");
}

function createTestReleaseRecord({ payload, signer }) {
  return signedEnvelope({
    scope: C.releaseEnvelopeScope,
    keyIdField: "signer_key_id",
    keyId: signer.key_id,
    domain: C.releaseDomain,
    payload,
    privateKey: signer.private_key,
  });
}

function createTestFreshnessResponse({
  payload,
  freshnessSigner,
  freshnessDelegationRaw,
  releaseDelegationRaw,
  releaseRecordRaw,
}) {
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  const signature = signBytes(
    null,
    runtimeConfigFreshnessSigningBytes(
      C.freshnessDomain,
      freshnessSigner.key_id,
      payloadBytes,
    ),
    freshnessSigner.private_key,
  );
  return Buffer.from(canonicalJson({
    schema_version: 1,
    scope: C.responseEnvelopeScope,
    signature_algorithm: "Ed25519",
    signer_key_id: freshnessSigner.key_id,
    freshness_delegation_base64url: Buffer.from(freshnessDelegationRaw).toString("base64url"),
    release_authority_delegation_base64url: Buffer.from(releaseDelegationRaw).toString("base64url"),
    release_commit_record_base64url: Buffer.from(releaseRecordRaw).toString("base64url"),
    payload_base64url: payloadBytes.toString("base64url"),
    signature_base64url: signature.toString("base64url"),
  }), "utf8");
}

export class InMemoryFreshnessClockForTest {
  constructor(initialMilliseconds) {
    if (!Number.isSafeInteger(initialMilliseconds)) {
      throw new Error("test clock requires an integer millisecond value");
    }
    this.milliseconds = initialMilliseconds;
  }

  now() {
    return this.milliseconds;
  }

  advance(milliseconds) {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new Error("test clock advance must be a nonnegative integer");
    }
    this.milliseconds += milliseconds;
  }
}

export class InMemoryRuntimeConfigR2ForTest {
  constructor(snapshot) {
    this.objects = new Map(snapshot?.objects ?? []);
    this.pointer = clone(snapshot?.pointer ?? null);
    this.etagCounter = snapshot?.etagCounter ?? 0;
  }

  putImmutable(key, raw) {
    const bytes = Buffer.from(raw);
    const existing = this.objects.get(key);
    if (existing && existing !== bytes.toString("base64url")) {
      throw new Error("immutable R2 key already contains different bytes");
    }
    const isManifest = typeof key === "string" &&
      key === `${C.immutableManifestPrefix}${hash(bytes)}`;
    const isArtifact = typeof key === "string" &&
      ARTIFACT_KEY_PATTERN.test(key) &&
      key.endsWith(`/${hash(bytes)}`);
    if (!isManifest && !isArtifact) {
      throw new Error("test R2 immutable Manifest key is not content addressed");
    }
    this.objects.set(key, bytes.toString("base64url"));
  }

  getObject(key) {
    const bytes = this.objects.get(key);
    return bytes === undefined ? null : Buffer.from(bytes, "base64url");
  }

  getPointer() {
    return this.pointer === null
      ? null
      : { body: Buffer.from(this.pointer.body_base64url, "base64url"), etag: this.pointer.etag };
  }

  compareAndSwapManifest(expectedEtag, raw) {
    if ((this.pointer?.etag ?? null) !== expectedEtag) {
      throw new Error("test R2 pointer compare-and-swap conflict");
    }
    this.etagCounter += 1;
    this.pointer = {
      body_base64url: Buffer.from(raw).toString("base64url"),
      etag: `test-etag-${this.etagCounter}`,
    };
    return this.pointer.etag;
  }

  snapshot() {
    return {
      objects: [...this.objects.entries()],
      pointer: clone(this.pointer),
      etagCounter: this.etagCounter,
    };
  }
}

export class InMemoryReleaseJournalForTest {
  constructor({ rootSigner, clock, testOnlyGenesisApproval, snapshot }) {
    this.rootSigner = rootSigner;
    this.clock = clock;
    this.testOnlyGenesisApproval = testOnlyGenesisApproval;
    this.entries = clone(snapshot?.entries ?? []);
  }

  getHead() {
    const entry = this.entries.at(-1);
    return entry ? clone(entry) : null;
  }

  append({ recordRaw, releaseDelegationRaw }) {
    const record = Buffer.from(recordRaw);
    const digest = hash(record);
    const parsed = JSON.parse(record.toString("utf8"));
    const payload = JSON.parse(
      Buffer.from(parsed.payload_base64url, "base64url").toString("utf8"),
    );
    const generation = BigInt(payload.commit_generation);
    const previous = this.entries.at(-1) ?? null;
    if (previous && generation === BigInt(previous.generation)) {
      if (
        previous.record_sha256 !== digest ||
        previous.record_base64url !== record.toString("base64url") ||
        previous.release_delegation_base64url !==
          Buffer.from(releaseDelegationRaw).toString("base64url")
      ) {
        throw new Error("Journal generation already contains different record bytes");
      }
      return clone(previous);
    }
    if (generation !== BigInt(previous?.generation ?? "0") + 1n) {
      throw new Error("Journal compare-and-append generation conflict");
    }
    if (!previous && this.testOnlyGenesisApproval !== "TEST_ONLY_APPROVED_GENESIS") {
      throw new Error("test Journal requires an explicit test-only genesis approval");
    }
    if (
      payload.previous_commit_generation !== (previous?.generation ?? null) ||
      payload.previous_commit_record_sha256 !== (previous?.record_sha256 ?? null)
    ) {
      throw new Error("Journal compare-and-append previous head mismatch");
    }
    const appendedAt = timestamp(this.clock.now());
    const verified = verifyRuntimeConfigReleaseCommitRecord(record, {
      rootSigner: this.rootSigner,
      environment: "production",
      releaseDelegationRaw,
      appendedAt,
    });
    if (
      previous &&
      BigInt(verified.payload.manifest_epoch) <= BigInt(previous.manifest_epoch)
    ) {
      throw new Error("Journal Manifest epoch must strictly increase");
    }
    const entry = {
      generation: verified.payload.commit_generation,
      manifest_epoch: verified.payload.manifest_epoch,
      record_sha256: digest,
      record_base64url: record.toString("base64url"),
      release_delegation_base64url: Buffer.from(releaseDelegationRaw).toString("base64url"),
      appended_at: appendedAt,
    };
    this.entries.push(entry);
    return clone(entry);
  }

  snapshot() {
    return { entries: clone(this.entries) };
  }
}

export class InMemoryReleaseCoordinationForTest {
  constructor({ clock, snapshot }) {
    this.clock = clock;
    this.state = clone(snapshot ?? {
      current: null,
      pending: null,
      leases: [],
      writer_pending: false,
      recovery_pending: false,
    });
  }

  pruneExpiredLeases() {
    this.state.leases = this.state.leases.filter(
      (lease) => this.clock.now() < lease.expires_at_ms,
    );
  }

  getCurrentCommitted() {
    this.pruneExpiredLeases();
    return clone(this.state.current);
  }

  getPending() {
    return clone(this.state.pending);
  }

  activeLeaseCount() {
    this.pruneExpiredLeases();
    return this.state.leases.length;
  }

  beginRelease(candidate) {
    this.pruneExpiredLeases();
    if (this.state.pending) {
      if (this.state.pending.attempt_id === candidate.attempt_id) {
        return this.state.pending.state;
      }
      throw new Error("another release attempt is already pending");
    }
    const current = this.state.current;
    if (
      candidate.previous_generation !== (current?.generation ?? null) ||
      candidate.previous_record_sha256 !== (current?.record_sha256 ?? null) ||
      candidate.expected_pointer_etag !== (current?.pointer_etag ?? null)
    ) {
      throw new Error("release attempt does not match the current coordination head");
    }
    if (
      current &&
      BigInt(candidate.manifest_epoch) <= BigInt(current.manifest_epoch)
    ) {
      throw new Error("release attempt Manifest epoch must strictly increase");
    }
    this.state.writer_pending = true;
    this.state.pending = {
      ...clone(candidate),
      state: this.state.leases.length > 0 ? "WAITING_FOR_LEASES" : "PREPARED",
      pointer_write_started: false,
      authorization_base64url: null,
      authorization_sha256: null,
      pointer_etag: null,
    };
    return this.state.pending.state;
  }

  resumeRelease(attemptId) {
    this.pruneExpiredLeases();
    const pending = this.requirePending(attemptId);
    if (pending.state !== "WAITING_FOR_LEASES" || this.state.leases.length > 0) {
      throw new Error("release is not ready to resume");
    }
    pending.state = "PREPARED";
    return pending.state;
  }

  markPointerWriteStarted(attemptId) {
    this.pruneExpiredLeases();
    const pending = this.requirePending(attemptId);
    if (pending.state !== "PREPARED" || this.state.leases.length > 0) {
      throw new Error("pointer write is not admitted");
    }
    pending.pointer_write_started = true;
  }

  observePointerCommitted(attemptId, { etag, manifestSha256 }) {
    this.pruneExpiredLeases();
    const pending = this.requirePending(attemptId);
    if (
      pending.state !== "PREPARED" ||
      !pending.pointer_write_started ||
      this.state.leases.length > 0 ||
      manifestSha256 !== pending.manifest_sha256 ||
      typeof etag !== "string" ||
      etag.length === 0
    ) {
      throw new Error("R2 pointer readback does not match the pending release");
    }
    pending.pointer_etag = etag;
    pending.state = "POINTER_COMMITTED";
  }

  storeAuthorization(attemptId, raw) {
    const pending = this.requirePending(attemptId);
    if (pending.state !== "POINTER_COMMITTED") {
      throw new Error("commit authorization requires POINTER_COMMITTED");
    }
    const bytes = Buffer.from(raw);
    const digest = hash(bytes);
    if (
      pending.authorization_base64url &&
      (pending.authorization_base64url !== bytes.toString("base64url") ||
        pending.authorization_sha256 !== digest)
    ) {
      throw new Error("pending release authorization bytes cannot be replaced");
    }
    pending.authorization_base64url = bytes.toString("base64url");
    pending.authorization_sha256 = digest;
  }

  acquireIssueLease() {
    this.pruneExpiredLeases();
    if (
      !this.state.current ||
      this.state.writer_pending ||
      this.state.pending ||
      this.state.recovery_pending
    ) {
      throw new Error("Freshness issue lease is unavailable while authority state is pending");
    }
    const lease = {
      lease_id: randomUUID(),
      generation: this.state.current.generation,
      acquired_at_ms: this.clock.now(),
      expires_at_ms: this.clock.now() + C.maxIssueLeaseMs,
    };
    this.state.leases.push(lease);
    return clone(lease);
  }

  assertIssueLease(leaseId) {
    this.pruneExpiredLeases();
    const lease = this.state.leases.find((entry) => entry.lease_id === leaseId);
    if (
      !lease ||
      !this.state.current ||
      lease.generation !== this.state.current.generation
    ) {
      throw new Error("Freshness issue lease is no longer active");
    }
    return clone(lease);
  }

  releaseIssueLease(leaseId) {
    this.pruneExpiredLeases();
    const before = this.state.leases.length;
    this.state.leases = this.state.leases.filter((lease) => lease.lease_id !== leaseId);
    return this.state.leases.length !== before;
  }

  beginRecovery() {
    this.pruneExpiredLeases();
    if (this.state.recovery_pending) {
      return this.state.leases.length > 0 ? "WAITING_FOR_LEASES" : "ADMITTED";
    }
    this.state.recovery_pending = true;
    this.state.writer_pending = true;
    return this.state.leases.length > 0 ? "WAITING_FOR_LEASES" : "ADMITTED";
  }

  completeRecovery({ journalEntry, pointer }) {
    this.pruneExpiredLeases();
    if (
      !this.state.recovery_pending ||
      this.state.leases.length > 0 ||
      !this.state.pending ||
      !journalEntry ||
      !pointer ||
      journalEntry.record_sha256 !== this.state.pending.authorization_sha256 ||
      pointer.etag !== this.state.pending.pointer_etag ||
      pointer.manifest_sha256 !== this.state.pending.manifest_sha256
    ) {
      throw new Error("recovery sources do not match the pending release");
    }
    this.commitCurrent(this.state.pending, journalEntry);
    this.state.pending = null;
    this.state.writer_pending = false;
    this.state.recovery_pending = false;
  }

  commitRelease(attemptId, journalEntry) {
    this.pruneExpiredLeases();
    const pending = this.requirePending(attemptId);
    if (
      pending.state !== "POINTER_COMMITTED" ||
      this.state.leases.length > 0 ||
      !pending.authorization_base64url ||
      journalEntry.record_sha256 !== pending.authorization_sha256 ||
      journalEntry.generation !== pending.commit_generation
    ) {
      throw new Error("Journal record does not authorize the pending DO transition");
    }
    this.commitCurrent(pending, journalEntry);
    this.state.pending = null;
    this.state.writer_pending = false;
  }

  requirePending(attemptId) {
    if (!this.state.pending || this.state.pending.attempt_id !== attemptId) {
      throw new Error("release attempt is not current");
    }
    return this.state.pending;
  }

  commitCurrent(pending, journalEntry) {
    this.state.current = {
      generation: pending.commit_generation,
      manifest_epoch: pending.manifest_epoch,
      manifest_sha256: pending.manifest_sha256,
      manifest_ref: pending.manifest_ref,
      pointer_etag: pending.pointer_etag,
      release_commit_id: pending.release_commit_id,
      record_sha256: journalEntry.record_sha256,
      record_base64url: journalEntry.record_base64url,
      release_delegation_base64url: journalEntry.release_delegation_base64url,
      appended_at: journalEntry.appended_at,
    };
  }

  snapshot() {
    this.pruneExpiredLeases();
    return clone(this.state);
  }
}

export class InMemoryRuntimeConfigFreshnessAuthorityForTest {
  constructor({
    manifestUrl,
    rootSigner,
    releaseSigner,
    freshnessSigner,
    releaseClock,
    journalClock,
    freshnessClock,
    manifestVerifier,
    testOnlyGenesisApproval,
    r2Snapshot,
    journalSnapshot,
    coordinationSnapshot,
  }) {
    this.manifestUrl = manifestUrl;
    this.rootSigner = rootSigner;
    this.releaseSigner = releaseSigner;
    this.freshnessSigner = freshnessSigner;
    this.releaseClock = releaseClock;
    this.journalClock = journalClock;
    this.freshnessClock = freshnessClock;
    this.manifestVerifier = manifestVerifier;
    this.r2 = new InMemoryRuntimeConfigR2ForTest(r2Snapshot);
    this.journal = new InMemoryReleaseJournalForTest({
      rootSigner,
      clock: journalClock,
      testOnlyGenesisApproval,
      snapshot: journalSnapshot,
    });
    this.coordination = new InMemoryReleaseCoordinationForTest({
      clock: releaseClock,
      snapshot: coordinationSnapshot,
    });
  }

  async beginRelease(manifestRaw) {
    if (typeof this.manifestVerifier !== "function") {
      throw new Error("test authority requires full Manifest and artifact verification");
    }
    const bytes = Buffer.from(manifestRaw);
    const manifest = await this.manifestVerifier(bytes, this.r2);
    if (manifest.schema_version !== 2 || typeof manifest.epoch !== "string") {
      throw new Error("verified test Manifest has an invalid schema or epoch");
    }
    const digest = hash(bytes);
    const ref = `${C.immutableManifestPrefix}${digest}`;
    this.r2.putImmutable(ref, bytes);
    const snapshot = this.r2.getObject(ref);
    if (!snapshot?.equals(bytes)) {
      throw new Error("test R2 immutable Manifest readback failed");
    }
    const current = this.coordination.getCurrentCommitted();
    const previousJournal = this.journal.getHead();
    if (
      (current?.record_sha256 ?? null) !== (previousJournal?.record_sha256 ?? null) ||
      (current?.generation ?? null) !== (previousJournal?.generation ?? null)
    ) {
      throw new Error("test DO and Journal heads disagree before release");
    }
    const pointer = this.r2.getPointer();
    if ((pointer?.etag ?? null) !== (current?.pointer_etag ?? null)) {
      throw new Error("test DO and R2 pointer disagree before release");
    }
    const attemptId = randomUUID();
    const generation = BigInt(current?.generation ?? "0") + 1n;
    const candidate = {
      attempt_id: attemptId,
      commit_generation: generation.toString(),
      manifest_epoch: manifest.epoch,
      manifest_sha256: digest,
      manifest_ref: ref,
      manifest_base64url: bytes.toString("base64url"),
      previous_generation: current?.generation ?? null,
      previous_record_sha256: current?.record_sha256 ?? null,
      expected_pointer_etag: pointer?.etag ?? null,
      release_commit_id: randomUUID(),
    };
    const state = this.coordination.beginRelease(candidate);
    return Object.freeze({ attempt_id: attemptId, state, candidate: clone(candidate) });
  }

  resumeRelease(attemptId) {
    return this.coordination.resumeRelease(attemptId);
  }

  writePointerCas(attemptId) {
    const pending = this.coordination.getPending();
    if (!pending || pending.attempt_id !== attemptId) {
      throw new Error("release attempt is not current");
    }
    this.coordination.markPointerWriteStarted(attemptId);
    const raw = Buffer.from(pending.manifest_base64url, "base64url");
    const etag = this.r2.compareAndSwapManifest(pending.expected_pointer_etag, raw);
    return Object.freeze({ etag, manifest_sha256: pending.manifest_sha256 });
  }

  observePointerCommitted(attemptId) {
    const pending = this.coordination.getPending();
    const pointer = this.r2.getPointer();
    const snapshot = pending && this.r2.getObject(pending.manifest_ref);
    if (
      !pending ||
      !pointer ||
      !snapshot ||
      !pointer.body.equals(snapshot) ||
      hash(pointer.body) !== pending.manifest_sha256
    ) {
      throw new Error("test R2 pointer and immutable snapshot readback disagree");
    }
    this.coordination.observePointerCommitted(attemptId, {
      etag: pointer.etag,
      manifestSha256: hash(pointer.body),
    });
  }

  authorizeJournalAppend(attemptId) {
    const pending = this.coordination.getPending();
    if (!pending || pending.attempt_id !== attemptId || pending.state !== "POINTER_COMMITTED") {
      throw new Error("Release Authority requires the exact POINTER_COMMITTED attempt");
    }
    const leaseCount = this.coordination.activeLeaseCount();
    if (leaseCount !== 0) throw new Error("Release Authority is blocked by an issue lease");
    const pointer = this.r2.getPointer();
    const snapshot = this.r2.getObject(pending.manifest_ref);
    if (
      !pointer ||
      !snapshot ||
      pointer.etag !== pending.pointer_etag ||
      !pointer.body.equals(snapshot) ||
      hash(snapshot) !== pending.manifest_sha256
    ) {
      throw new Error("Release Authority direct R2 verification failed");
    }
    const journalHead = this.journal.getHead();
    const current = this.coordination.getCurrentCommitted();
    if (
      (journalHead?.record_sha256 ?? null) !== (pending.previous_record_sha256 ?? null) ||
      (journalHead?.generation ?? null) !== (pending.previous_generation ?? null) ||
      (current?.record_sha256 ?? null) !== (pending.previous_record_sha256 ?? null)
    ) {
      throw new Error("Release Authority prior Journal head changed");
    }
    const signerNow = this.releaseClock.now();
    const releaseDelegation = verifyRuntimeConfigDelegation(
      this.releaseSigner.delegation_raw,
      {
        rootSigner: this.rootSigner,
        expectedPurpose: "release-commit-record-v1",
        expectedEnvironment: "production",
        expectedAudience: `${C.releaseAudiencePrefix}production`,
        signerNowMs: signerNow,
      },
    );
    const payload = {
      schema_version: 1,
      scope: C.releasePayloadScope,
      environment: "production",
      commit_authorization: "AUTHORIZE_JOURNAL_APPEND",
      commit_generation: pending.commit_generation,
      release_commit_id: pending.release_commit_id,
      manifest_schema_version: 2,
      manifest_epoch: pending.manifest_epoch,
      manifest_sha256: pending.manifest_sha256,
      manifest_ref: pending.manifest_ref,
      pointer_etag: pointer.etag,
      previous_commit_generation: pending.previous_generation,
      previous_commit_record_sha256: pending.previous_record_sha256,
      authorized_at: timestamp(signerNow),
      release_authority_delegation_id: releaseDelegation.payload.delegation_id,
      release_authority_delegation_sha256: releaseDelegation.digest,
    };
    const raw = createTestReleaseRecord({ payload, signer: this.releaseSigner });
    verifyRuntimeConfigReleaseCommitRecord(raw, {
      rootSigner: this.rootSigner,
      environment: "production",
      releaseDelegationRaw: this.releaseSigner.delegation_raw,
      appendedAt: payload.authorized_at,
    });
    this.coordination.storeAuthorization(attemptId, raw);
    return Buffer.from(raw);
  }

  appendJournal(attemptId) {
    const pending = this.coordination.getPending();
    if (
      !pending ||
      pending.attempt_id !== attemptId ||
      pending.state !== "POINTER_COMMITTED" ||
      !pending.authorization_base64url
    ) {
      throw new Error("Journal append requires persisted exact authorization bytes");
    }
    const entry = this.journal.append({
      recordRaw: Buffer.from(pending.authorization_base64url, "base64url"),
      releaseDelegationRaw: this.releaseSigner.delegation_raw,
    });
    return Object.freeze(entry);
  }

  completeRelease(attemptId) {
    const pending = this.coordination.getPending();
    const head = this.journal.getHead();
    const pointer = this.r2.getPointer();
    const snapshot = pending && this.r2.getObject(pending.manifest_ref);
    if (
      !pending ||
      !head ||
      !pointer ||
      !snapshot ||
      head.record_sha256 !== pending.authorization_sha256 ||
      head.generation !== pending.commit_generation ||
      pointer.etag !== pending.pointer_etag ||
      !pointer.body.equals(snapshot) ||
      hash(snapshot) !== pending.manifest_sha256
    ) {
      throw new Error("Journal, DO attempt, pointer, or immutable snapshot disagree");
    }
    this.coordination.commitRelease(attemptId, head);
  }

  async commitRelease(manifestRaw, { crashAfter } = {}) {
    const attempt = await this.beginRelease(manifestRaw);
    if (attempt.state === "WAITING_FOR_LEASES") return attempt;
    this.writePointerCas(attempt.attempt_id);
    if (crashAfter === "pointer-cas") return attempt;
    this.observePointerCommitted(attempt.attempt_id);
    if (crashAfter === "pointer-committed") return attempt;
    this.authorizeJournalAppend(attempt.attempt_id);
    if (crashAfter === "authorization-stored") return attempt;
    this.appendJournal(attempt.attempt_id);
    if (crashAfter === "journal-append") return attempt;
    this.completeRelease(attempt.attempt_id);
    return attempt;
  }

  async recoverPendingRelease() {
    const admission = this.coordination.beginRecovery();
    if (admission !== "ADMITTED") return admission;
    const pending = this.coordination.getPending();
    const head = this.journal.getHead();
    const pointer = this.r2.getPointer();
    const snapshot = pending && this.r2.getObject(pending.manifest_ref);
    if (
      !pending ||
      !head ||
      !pointer ||
      !snapshot ||
      !pending.authorization_base64url ||
      head.record_sha256 !== pending.authorization_sha256 ||
      head.record_base64url !== pending.authorization_base64url ||
      pointer.etag !== pending.pointer_etag ||
      !pointer.body.equals(snapshot) ||
      hash(snapshot) !== pending.manifest_sha256
    ) {
      throw new Error("recovery could not reconcile the exact Journal and R2 state");
    }
    const verified = verifyRuntimeConfigReleaseCommitRecord(
      Buffer.from(head.record_base64url, "base64url"),
      {
        rootSigner: this.rootSigner,
        environment: "production",
        releaseDelegationRaw: Buffer.from(head.release_delegation_base64url, "base64url"),
        appendedAt: head.appended_at,
      },
    );
    if (
      verified.digest !== head.record_sha256 ||
      verified.payload.manifest_sha256 !== hash(snapshot)
    ) {
      throw new Error("recovery Release Commit Record verification failed");
    }
    this.coordination.completeRecovery({
      journalEntry: head,
      pointer: { etag: pointer.etag, manifest_sha256: hash(pointer.body) },
    });
    return "COMMITTED";
  }

  async issueFreshness(requestRaw, { afterSign } = {}) {
    const request = verifyRuntimeConfigFreshnessRequest(requestRaw, {
      expectedEnvironment: "production",
      expectedAudience: hash(Buffer.from(this.manifestUrl, "utf8")),
    });
    const lease = this.coordination.acquireIssueLease();
    try {
      const journalHead = this.journal.getHead();
      const committed = this.coordination.getCurrentCommitted();
      if (!journalHead || !committed || this.coordination.getPending()) {
        throw new Error("Freshness authority has no stable committed release");
      }
      if (
        journalHead.record_sha256 !== committed.record_sha256 ||
        journalHead.generation !== committed.generation ||
        journalHead.manifest_epoch !== committed.manifest_epoch
      ) {
        throw new Error("Freshness DO and Journal current heads disagree");
      }
      const recordRaw = Buffer.from(journalHead.record_base64url, "base64url");
      const releaseDelegationRaw = Buffer.from(
        journalHead.release_delegation_base64url,
        "base64url",
      );
      const verifiedRecord = verifyRuntimeConfigReleaseCommitRecord(recordRaw, {
        rootSigner: this.rootSigner,
        environment: "production",
        releaseDelegationRaw,
        appendedAt: journalHead.appended_at,
      });
      const pointer = this.r2.getPointer();
      const snapshot = this.r2.getObject(committed.manifest_ref);
      if (
        !pointer ||
        !snapshot ||
        pointer.etag !== committed.pointer_etag ||
        pointer.etag !== verifiedRecord.payload.pointer_etag ||
        verifiedRecord.payload.commit_generation !== committed.generation ||
        verifiedRecord.payload.manifest_epoch !== committed.manifest_epoch ||
        verifiedRecord.payload.manifest_ref !== committed.manifest_ref ||
        verifiedRecord.payload.release_commit_id !== committed.release_commit_id ||
        !pointer.body.equals(snapshot) ||
        hash(pointer.body) !== committed.manifest_sha256 ||
        hash(snapshot) !== verifiedRecord.payload.manifest_sha256
      ) {
        throw new Error("Freshness R2 pointer and immutable snapshot disagree");
      }
      const manifest = await this.manifestVerifier(snapshot, this.r2);
      if (
        manifest.schema_version !== 2 ||
        manifest.epoch !== committed.manifest_epoch ||
        verifiedRecord.payload.manifest_epoch !== manifest.epoch
      ) {
        throw new Error("Freshness Manifest v2 verification disagrees with commit state");
      }
      const freshnessNow = this.freshnessClock.now();
      const freshnessDelegation = verifyRuntimeConfigDelegation(
        this.freshnessSigner.delegation_raw,
        {
          rootSigner: this.rootSigner,
          expectedPurpose: "freshness-response-v1",
          expectedEnvironment: "production",
          expectedAudience: request.audience_manifest_url_sha256,
          signerNowMs: freshnessNow,
        },
      );
      const issuedAtMs = this.freshnessClock.now();
      const expiresAtMs = Math.min(
        issuedAtMs + C.maxResponseLifetimeMs,
        freshnessDelegation.notAfter,
      );
      if (expiresAtMs <= issuedAtMs) {
        throw new Error("Freshness delegation has no remaining response validity");
      }
      const recordDigest = hash(recordRaw);
      const responsePayload = {
        schema_version: 1,
        scope: C.responsePayloadScope,
        freshness_semantics: "LATEST_AT_ISSUANCE",
        environment: "production",
        audience_manifest_url_sha256: request.audience_manifest_url_sha256,
        request_nonce: request.request_nonce,
        issued_at: timestamp(issuedAtMs),
        expires_at: timestamp(expiresAtMs),
        latest_epoch: manifest.epoch,
        manifest_schema_version: 2,
        manifest_sha256: committed.manifest_sha256,
        manifest_ref: committed.manifest_ref,
        pointer_generation: committed.generation,
        release_commit_id: verifiedRecord.payload.release_commit_id,
        release_commit_record_sha256: recordDigest,
        release_commit_record_appended_at: journalHead.appended_at,
        freshness_signer_key_id: this.freshnessSigner.key_id,
        freshness_delegation_id: freshnessDelegation.payload.delegation_id,
        freshness_delegation_sha256: freshnessDelegation.digest,
        release_authority_key_id: verifiedRecord.envelope.signer_key_id,
        release_authority_delegation_id: verifiedRecord.delegation.payload.delegation_id,
        release_authority_delegation_sha256: verifiedRecord.delegation.digest,
      };
      const response = createTestFreshnessResponse({
        payload: responsePayload,
        freshnessSigner: this.freshnessSigner,
        freshnessDelegationRaw: this.freshnessSigner.delegation_raw,
        releaseDelegationRaw,
        releaseRecordRaw: recordRaw,
      });
      if (afterSign) await afterSign();
      this.coordination.assertIssueLease(lease.lease_id);
      const afterSignNow = this.freshnessClock.now();
      if (
        afterSignNow < freshnessDelegation.notBefore ||
        afterSignNow >= freshnessDelegation.notAfter ||
        afterSignNow >= expiresAtMs
      ) {
        throw new Error("Freshness signer or response expired while signing");
      }
      return response;
    } finally {
      this.coordination.releaseIssueLease(lease.lease_id);
    }
  }

  verifyAppResponse(responseRaw, request, {
    nowMs = this.freshnessClock.now(),
    highWater,
  } = {}) {
    const verified = verifyRuntimeConfigFreshnessResponse(responseRaw, {
      bootstrapSigner: this.rootSigner,
      manifestUrl: this.manifestUrl,
      request,
      nowMs,
      highWater,
    });
    const rawManifest = this.r2.getObject(verified.payload.manifest_ref);
    if (!rawManifest) throw new Error("Freshness Manifest snapshot is missing");
    verifyFreshnessManifestBinding(verified, rawManifest);
    return Object.freeze({ verified, raw_manifest: rawManifest });
  }

  snapshots() {
    return {
      r2: this.r2.snapshot(),
      journal: this.journal.snapshot(),
      coordination: this.coordination.snapshot(),
    };
  }
}

export function createTestKeyDescriptor(keyId, keyPair, delegationRaw) {
  return Object.freeze({
    key_id: keyId,
    private_key: keyPair.privateKey,
    public_key_spki: keyPair.publicKeySpki,
    delegation_raw: Buffer.from(delegationRaw),
  });
}

export function createTestReleasePayload(overrides = {}) {
  const now = "2026-11-01T00:00:00.000Z";
  return Object.freeze({
    schema_version: 1,
    scope: C.releasePayloadScope,
    environment: "production",
    commit_authorization: "AUTHORIZE_JOURNAL_APPEND",
    commit_generation: "1",
    release_commit_id: "00000000-0000-4000-8000-000000000001",
    manifest_schema_version: 2,
    manifest_epoch: "1",
    manifest_sha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    manifest_ref: `${C.immutableManifestPrefix}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
    pointer_etag: "test-etag-1",
    previous_commit_generation: null,
    previous_commit_record_sha256: null,
    authorized_at: now,
    release_authority_delegation_id: "00000000-0000-4000-8000-000000000002",
    release_authority_delegation_sha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ...overrides,
  });
}

export function createTestDelegationPayload({
  delegationId,
  generation = "1",
  environment = "production",
  purpose,
  keyId,
  publicKeySpki,
  audience,
  issuedAt = "2026-11-01T00:00:00.000Z",
  notBefore = "2026-11-01T00:00:00.000Z",
  notAfter,
  previousDigest = null,
}) {
  const maxValidity = purpose === "freshness-response-v1"
    ? C.maxFreshnessDelegationLifetimeSeconds
    : C.maxReleaseDelegationLifetimeSeconds;
  return Object.freeze({
    schema_version: 1,
    scope: C.delegationPayloadScope,
    delegation_id: delegationId,
    delegation_generation: generation,
    environment,
    purpose,
    key_id: keyId,
    public_key_spki: publicKeySpki,
    signature_algorithm: "Ed25519",
    audience,
    issued_at: issuedAt,
    not_before: notBefore,
    not_after: notAfter ?? timestamp(Date.parse(issuedAt) + maxValidity * 1000),
    max_validity_seconds: maxValidity,
    revocation_mode: "expiry-only-v1",
    previous_delegation_sha256: previousDigest,
  });
}
