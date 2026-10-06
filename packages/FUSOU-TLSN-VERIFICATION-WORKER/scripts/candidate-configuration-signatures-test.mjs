import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { canonicalJson } from "./deployment-attestation.mjs";
import { candidateConfigurationBindingAssessment } from "./candidate-configuration-binding.mjs";
import {
  CANDIDATE_CONFIGURATION_SIGNATURE_CONTRACT as contract,
  canonicalCandidateConfigurationSignedPayload,
  verifyCandidateConfigurationEvidenceSignature,
} from "./candidate-configuration-signatures.mjs";

const now = new Date("2026-10-03T12:00:00.000Z");
const hash = (bytes) => createHash("sha256").update(bytes).digest("base64url");
const authorityNames = [
  "APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT",
  "AUTHENTICATED_BUILDER_PROVENANCE",
  "INDEPENDENT_AUTHORITY_RECEIPT",
];

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey,
    publicKeySpki: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

function signerIdentity(inputName) {
  if (inputName === "AUTHENTICATED_BUILDER_PROVENANCE") {
    return { authority_id: "builder-A", key_id: "builder-key-A" };
  }
  return inputName === "APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT"
    ? { authority_id: "approval-A", key_id: "approval-key-A" }
    : { authority_id: "candidate-authority-A", key_id: "candidate-key-A" };
}

function sampleEvidence(inputName) {
  const identity = signerIdentity(inputName);
  if (inputName === "APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT") {
    return {
      schema_version: contract.inputs[inputName].schema_version,
      scope: contract.inputs[inputName].scope,
      combined_sha256: hash(Buffer.from("fingerprint-A")),
      approval_id: "approval-record-A",
      candidate_artifact_id: hash(Buffer.from("candidate-A")),
      candidate_capture_id: "capture-A",
      issued_at: "2026-10-01T00:00:00.000Z",
      valid_from: "2026-10-01T00:00:00.000Z",
      valid_until: "2026-10-05T00:00:00.000Z",
      provenance_source: "configuration-approval-system",
      evidence_sha256: hash(Buffer.from("approval-evidence-A")),
      authority_identity: identity,
      signature: null,
    };
  }
  if (inputName === "AUTHENTICATED_BUILDER_PROVENANCE") {
    return {
      schema_version: contract.inputs[inputName].schema_version,
      scope: contract.inputs[inputName].scope,
      candidate_artifact_id: hash(Buffer.from("candidate-A")),
      artifact_identity: "APP-A",
      binary_sha256: hash(Buffer.from("binary-A")),
      source_commit: "a".repeat(40),
      build_workflow_identity: "owner/FUSOU/.github/workflows/release.yml@main",
      toolchain_identity: "rust-1.95.0",
      builder_identity: identity.authority_id,
      builder_signing_key_id: identity.key_id,
      issued_at: "2026-10-01T00:00:00.000Z",
      valid_from: "2026-10-01T00:00:00.000Z",
      valid_until: "2026-10-05T00:00:00.000Z",
      evidence_sha256: hash(Buffer.from("builder-evidence-A")),
      signature: null,
    };
  }
  return {
    schema_version: contract.inputs[inputName].schema_version,
    scope: contract.inputs[inputName].scope,
    candidate_artifact_id: hash(Buffer.from("candidate-A")),
    app_configuration_fingerprint: {
      schema_version: 2,
      scope: "fusou-tlsn-app-public-configuration",
      combined_sha256: hash(Buffer.from("fingerprint-A")),
    },
    binary_sha256: hash(Buffer.from("binary-A")),
    deployment_identity: {
      deployment_id: "deployment-A",
      worker_name: "worker-A",
      git_commit_sha: "a".repeat(40),
    },
    capture_identity: {
      candidate_capture_id: "capture-A",
      session_id: "session-A",
      request_id: "request-A",
      request_sha256: hash(Buffer.from("request-A")),
      authenticated_request_sha256: hash(Buffer.from("authenticated-request-A")),
      binding_identifier: hash(Buffer.from("binding-A")),
    },
    authority_identity: identity,
    issued_at: "2026-10-01T00:00:00.000Z",
    valid_from: "2026-10-01T00:00:00.000Z",
    valid_until: "2026-10-05T00:00:00.000Z",
    evidence_sha256: hash(Buffer.from("authority-evidence-A")),
    signature: null,
  };
}

function signEvidence(inputName, evidence, signer) {
  const payload = canonicalCandidateConfigurationSignedPayload(inputName, evidence);
  evidence.signature = {
    algorithm: "Ed25519",
    key_id: signerIdentity(inputName).key_id,
    payload_sha256: hash(payload),
    value: sign(null, payload, signer.privateKey).toString("base64url"),
  };
  return evidence;
}

function signedEvidence(inputName, signer) {
  return signEvidence(inputName, sampleEvidence(inputName), signer);
}

function trustBundle(inputName, signer, overrides = {}) {
  const authority = contract.inputs[inputName];
  const root = keyPair();
  const rootIdentity = {
    authority_id: `test-root-${authority.authority_type}`,
    key_id: `test-root-key-${authority.authority_type}`,
    public_key_spki: root.publicKeySpki,
    algorithm: "Ed25519",
    status: "ACTIVE",
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: "2027-01-01T00:00:00.000Z",
    scope: authority.registry_scope,
  };
  const key = signerIdentity(inputName);
  const registryPayload = Buffer.from(canonicalJson({
    schema_version: contract.registry_payload.schema_version,
    scope: authority.registry_scope,
    canonicalization: contract.canonicalization,
    signed_fields: {
      authority_type: authority.authority_type,
      authority_id: key.authority_id,
      registry_version: "test-registry-v1",
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: "2027-01-01T00:00:00.000Z",
      keys: [{
        authority_id: key.authority_id,
        key_id: key.key_id,
        public_key_spki: signer.publicKeySpki,
        algorithm: "Ed25519",
        status: "ACTIVE",
        not_before: "2026-01-01T00:00:00.000Z",
        not_after: "2027-01-01T00:00:00.000Z",
        scopes: [authority.signed_payload_scope],
      }],
    },
  }), "utf8");
  const registryDigest = hash(registryPayload);
  const registrySignature = {
    algorithm: "Ed25519",
    key_id: rootIdentity.key_id,
    payload_sha256: registryDigest,
    value: sign(null, registryPayload, root.privateKey).toString("base64url"),
  };
  return {
    bundle: {
      schema_version: contract.trust_bundle.schema_version,
      scope: contract.trust_bundle.scope,
      authority_type: authority.authority_type,
      trust_root: rootIdentity,
      registry_payload_base64url: registryPayload.toString("base64url"),
      registry_sha256: registryDigest,
      registry_signature: registrySignature,
      ...overrides,
    },
    rootIdentity,
    rootPrivateKey: root.privateKey,
  };
}

function replaceRegistryPayload(bundle, rootPrivateKey, registryPayload) {
  const registryBytes = Buffer.from(canonicalJson(registryPayload), "utf8");
  const registryDigest = hash(registryBytes);
  return {
    ...bundle,
    registry_payload_base64url: registryBytes.toString("base64url"),
    registry_sha256: registryDigest,
    registry_signature: {
      algorithm: "Ed25519",
      key_id: bundle.trust_root.key_id,
      payload_sha256: registryDigest,
      value: sign(null, registryBytes, rootPrivateKey).toString("base64url"),
    },
  };
}

function verify(inputName, evidence, bundle, options = {}) {
  return verifyCandidateConfigurationEvidenceSignature({
    inputName,
    evidence,
    trustBundle: bundle,
    now,
    ...options,
  });
}

test("signed payload schema has explicit domain, canonicalization, and no signature field", () => {
  assert.equal(contract.time_semantics.validity_interval, "inclusive-start-exclusive-end");
  assert.equal(contract.schema_version, 3);
  assert.equal(contract.time_semantics.issuance_timestamp_field, "issued_at");
  assert.equal(contract.time_semantics.issuance_timestamp_is_signed_assertion, true);
  assert.equal(contract.time_semantics.issuance_timestamp_is_independently_time_attested, false);
  assert.equal(contract.time_semantics.registry_must_cover_evidence_issued_at, true);
  assert.equal(contract.time_semantics.registry_validity_meaning, "SIGNER_AUTHORIZATION_WINDOW");
  assert.equal(contract.time_semantics.root_must_cover_registry_validity, true);
  assert.equal(contract.time_semantics.registry_signature_timestamp, "NOT_PRESENT");
  assert.equal(contract.time_semantics.root_authorization_at_registry_physical_signing_time, "NOT_ESTABLISHED");
  assert.equal(contract.time_semantics.trust_model, "CURRENT_APPLICATION_PINNED_ROOT_AND_CURRENT_ROOT_SIGNED_REGISTRY_SNAPSHOT");
  assert.equal(contract.time_semantics.evidence_issued_at_historical_authorization, "NOT_INDEPENDENTLY_VERIFIABLE");
  assert.equal(contract.registry_payload.status_semantics.ACTIVE, "CURRENT_SIGNER_AUTHORIZATION_WHEN_SCOPE_AND_CURRENT_WINDOWS_MATCH");
  assert.equal(contract.registry_payload.status_semantics.VERIFY_ONLY, "SIGNATURE_INTEGRITY_CHECK_ONLY_NO_CURRENT_SIGNER_AUTHORIZATION");
  assert.equal(contract.registry_payload.status_semantics.RETIRED, "SIGNATURE_INTEGRITY_CHECK_ONLY_NO_CURRENT_SIGNER_AUTHORIZATION");
  assert.equal(contract.registry_payload.status_semantics.REVOKED, "REJECT_SIGNATURE_VERIFICATION_FAIL_CLOSED");
  assert.equal(contract.registry_payload.status_is_current_lifecycle_state_not_transition_history, true);
  assert.equal(contract.registry_payload.historical_registry_lookup, "NOT_IMPLEMENTED");
  assert.equal(contract.registry_payload.all_key_entries_import_as_ed25519_spki, true);
  assert.equal(contract.registry_payload.all_key_entries_require_canonical_spki_der_round_trip, true);
  assert.equal(contract.evidence_digest_semantics.classification, "AUTHORITY_SIGNED_OPAQUE_COMMITMENT");
  assert.equal(contract.evidence_digest_semantics.referenced_artifact_loaded, false);
  assert.equal(contract.evidence_digest_semantics.digest_recomputed, false);
  assert.equal(Object.hasOwn(contract.binary_identity, "current_binary_authenticator_implemented"), false);
  assert.deepEqual(contract.binary_identity.current_process_image_authority, {
    classification: "OUT_OF_SCOPE",
    readiness_required: false,
    reason: "The project guarantees communication integrity and verifiable TLS evidence, not independent authenticity of the local APP process image.",
    operator_supplied_json_authenticates_source: false,
    builder_provenance_alone_authenticates_current_process: false,
    runtime_attestation_authenticates_app_binary: false,
  });
  assert.equal(contract.inputs.CURRENT_BINARY_IDENTITY.readiness_required, false);
  assert.equal(contract.inputs.CURRENT_BINARY_IDENTITY.authentication, "OPERATOR_INPUT_IS_UNVERIFIED_METADATA_ONLY");
  assert.equal(contract.time_semantics.low_level_signature_verifier_candidate_readiness, "NOT_EVALUATED");
  for (const inputName of authorityNames) {
    const inputContract = contract.inputs[inputName];
    const evidence = sampleEvidence(inputName);
    const payload = canonicalCandidateConfigurationSignedPayload(inputName, evidence);
    const parsed = JSON.parse(payload.toString("utf8"));
    assert.equal(parsed.canonicalization, "FUSOU-CANONICAL-JSON-V1");
    assert.equal(parsed.scope, inputContract.signed_payload_scope);
    assert.equal(inputContract.signature_time_field, "issued_at");
    assert.ok(inputContract.evidence_validity_fields.includes("valid_from"));
    assert.ok(inputContract.evidence_validity_fields.includes("valid_until"));
    assert.deepEqual(
      Object.keys(parsed.signed_fields).sort(),
      inputContract.required_fields.filter((field) => field !== "signature").sort(),
    );
    assert.equal(inputContract.signature_time_field in parsed.signed_fields, true);
  }
  assert.equal(new Set(authorityNames.map((name) => contract.inputs[name].signed_payload_scope)).size, 3);
});

test("changing any authority-domain security field invalidates its original signature", () => {
  const mutations = {
    APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT: [
      (evidence) => { evidence.candidate_artifact_id = hash(Buffer.from("other-candidate")); },
      (evidence) => { evidence.candidate_capture_id = "capture-other"; },
      (evidence) => { evidence.combined_sha256 = hash(Buffer.from("other-fingerprint")); },
      (evidence) => { evidence.issued_at = "2026-10-02T00:00:00.000Z"; },
      (evidence) => { evidence.valid_from = "2026-10-02T00:00:00.000Z"; },
      (evidence) => { evidence.valid_until = "2026-10-06T00:00:00.000Z"; },
      (evidence) => { evidence.evidence_sha256 = hash(Buffer.from("other-evidence")); },
      (evidence) => { evidence.authority_identity.authority_id = "other-authority"; },
      (evidence) => { evidence.authority_identity.key_id = "other-key"; },
    ],
    AUTHENTICATED_BUILDER_PROVENANCE: [
      (evidence) => { evidence.candidate_artifact_id = hash(Buffer.from("other-candidate")); },
      (evidence) => { evidence.binary_sha256 = hash(Buffer.from("other-binary")); },
      (evidence) => { evidence.source_commit = "b".repeat(40); },
      (evidence) => { evidence.build_workflow_identity = "owner/other-workflow.yml"; },
      (evidence) => { evidence.toolchain_identity = "other-toolchain"; },
      (evidence) => { evidence.builder_identity = "other-builder"; },
      (evidence) => { evidence.builder_signing_key_id = "other-key"; },
      (evidence) => { evidence.issued_at = "2026-10-02T00:00:00.000Z"; },
      (evidence) => { evidence.valid_from = "2026-10-02T00:00:00.000Z"; },
      (evidence) => { evidence.valid_until = "2026-10-06T00:00:00.000Z"; },
      (evidence) => { evidence.evidence_sha256 = hash(Buffer.from("other-evidence")); },
    ],
    INDEPENDENT_AUTHORITY_RECEIPT: [
      (evidence) => { evidence.candidate_artifact_id = hash(Buffer.from("other-candidate")); },
      (evidence) => { evidence.app_configuration_fingerprint.combined_sha256 = hash(Buffer.from("other-fingerprint")); },
      (evidence) => { evidence.binary_sha256 = hash(Buffer.from("other-binary")); },
      (evidence) => { evidence.deployment_identity.deployment_id = "other-deployment"; },
      (evidence) => { evidence.capture_identity.request_id = "other-request"; },
      (evidence) => { evidence.authority_identity.authority_id = "other-authority"; },
      (evidence) => { evidence.authority_identity.key_id = "other-key"; },
      (evidence) => { evidence.issued_at = "2026-10-02T00:00:00.000Z"; },
      (evidence) => { evidence.valid_from = "2026-10-02T00:00:00.000Z"; },
      (evidence) => { evidence.valid_until = "2026-10-06T00:00:00.000Z"; },
      (evidence) => { evidence.evidence_sha256 = hash(Buffer.from("other-evidence")); },
    ],
  };

  for (const inputName of authorityNames) {
    for (const mutate of mutations[inputName]) {
      const signer = keyPair();
      const evidence = signedEvidence(inputName, signer);
      const { bundle } = trustBundle(inputName, signer);
      const changed = structuredClone(evidence);
      mutate(changed);
      changed.signature.payload_sha256 = hash(canonicalCandidateConfigurationSignedPayload(inputName, changed));
      assert.throws(() => verify(inputName, changed, bundle), undefined, `${inputName} mutation must not reuse the original signature`);
    }
  }
});

test("evidence schema version and scope cannot be changed outside their signed domain", () => {
  for (const inputName of authorityNames) {
    const evidence = sampleEvidence(inputName);
    assert.throws(
      () => canonicalCandidateConfigurationSignedPayload(inputName, { ...evidence, schema_version: 99 }),
      /schema version or scope is invalid/,
    );
    assert.throws(
      () => canonicalCandidateConfigurationSignedPayload(inputName, { ...evidence, scope: "other-domain" }),
      /schema version or scope is invalid/,
    );
  }
});

test("registry payload changes fail root signature verification even with a refreshed digest", () => {
  const inputName = authorityNames[0];
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle } = trustBundle(inputName, signer);
  const registry = JSON.parse(Buffer.from(bundle.registry_payload_base64url, "base64url").toString("utf8"));
  registry.signed_fields.registry_version = "tampered-registry-version";
  const changedBytes = Buffer.from(canonicalJson(registry), "utf8");
  const changedDigest = hash(changedBytes);
  const changedBundle = {
    ...bundle,
    registry_payload_base64url: changedBytes.toString("base64url"),
    registry_sha256: changedDigest,
    registry_signature: { ...bundle.registry_signature, payload_sha256: changedDigest },
  };
  assert.throws(() => verify(inputName, evidence, changedBundle), /registry Ed25519 signature is invalid/);
});

test("authority registries reject duplicate key IDs and duplicate public keys", () => {
  const inputName = authorityNames[0];
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle, rootPrivateKey } = trustBundle(inputName, signer);
  const original = JSON.parse(Buffer.from(bundle.registry_payload_base64url, "base64url").toString("utf8"));

  const duplicateId = structuredClone(original);
  duplicateId.signed_fields.keys.push({ ...duplicateId.signed_fields.keys[0], public_key_spki: keyPair().publicKeySpki });
  assert.throws(() => verify(inputName, evidence, replaceRegistryPayload(bundle, rootPrivateKey, duplicateId)), /identity is invalid or duplicated/);

  const duplicateKey = structuredClone(original);
  duplicateKey.signed_fields.keys.push({ ...duplicateKey.signed_fields.keys[0], key_id: "another-key-id" });
  assert.throws(() => verify(inputName, evidence, replaceRegistryPayload(bundle, rootPrivateKey, duplicateKey)), /reuses a public key/);

  const rootAsSigner = structuredClone(original);
  rootAsSigner.signed_fields.keys[0].public_key_spki = bundle.trust_root.public_key_spki;
  assert.throws(() => verify(inputName, evidence, replaceRegistryPayload(bundle, rootPrivateKey, rootAsSigner)), /reuses a public key/);
});

test("all registry keys require canonical validity windows and scopes", () => {
  const inputName = authorityNames[0];
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle, rootPrivateKey } = trustBundle(inputName, signer);
  const original = JSON.parse(Buffer.from(bundle.registry_payload_base64url, "base64url").toString("utf8"));
  const unusedSigner = keyPair();
  const unusedKey = {
    ...original.signed_fields.keys[0],
    key_id: "unused-key",
    public_key_spki: unusedSigner.publicKeySpki,
    status: "RETIRED",
    scopes: [],
  };
  const rejectsUnusedKeyMutation = (mutate, expectedError) => {
    const changed = structuredClone(original);
    const key = { ...unusedKey };
    mutate(key);
    changed.signed_fields.keys.push(key);
    assert.throws(() => verify(inputName, evidence, replaceRegistryPayload(bundle, rootPrivateKey, changed)), expectedError);
  };

  rejectsUnusedKeyMutation((key) => { key.not_before = "2026-1-1T00:00:00.000Z"; }, /unused-key not_before is invalid/);
  rejectsUnusedKeyMutation((key) => { key.not_after = "2027-13-01T00:00:00.000Z"; }, /unused-key not_after is invalid/);
  rejectsUnusedKeyMutation((key) => { key.not_after = "2025-12-31T00:00:00.000Z"; }, /unused-key validity interval is invalid/);
  rejectsUnusedKeyMutation((key) => {
    key.public_key_spki = Buffer.concat([
      Buffer.from(key.public_key_spki, "base64url"),
      Buffer.from([0]),
    ]).toString("base64url");
  }, /unused-key public key is not canonical Ed25519 SPKI/);
  rejectsUnusedKeyMutation((key) => { key.scopes = ["not a scope"]; }, /unused-key scopes are invalid/);
  rejectsUnusedKeyMutation((key) => { key.scopes = ["scope-a", "scope-a"]; }, /unused-key scopes are invalid/);
});

test("registry declared validity must fit within the current trust root window", () => {
  const inputName = authorityNames[0];
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle, rootPrivateKey } = trustBundle(inputName, signer);
  const registry = JSON.parse(Buffer.from(bundle.registry_payload_base64url, "base64url").toString("utf8"));
  for (const [field, value] of [
    ["valid_from", "2025-12-31T23:59:59.999Z"],
    ["valid_until", "2027-01-02T00:00:00.000Z"],
  ]) {
    const changed = structuredClone(registry);
    changed.signed_fields[field] = value;
    assert.throws(
      () => verify(inputName, evidence, replaceRegistryPayload(bundle, rootPrivateKey, changed)),
      /registry validity interval exceeds trust root validity interval/,
      `registry ${field} must remain within the root validity window`,
    );
  }
});

test("key lifecycle separates signature verification from current authorization", () => {
  const inputName = authorityNames[0];
  for (const [status, authorized] of [["ACTIVE", true], ["VERIFY_ONLY", false], ["RETIRED", false]]) {
    const signer = keyPair();
    const evidence = signedEvidence(inputName, signer);
    const { bundle, rootPrivateKey } = trustBundle(inputName, signer);
    const registry = JSON.parse(Buffer.from(bundle.registry_payload_base64url, "base64url").toString("utf8"));
    registry.signed_fields.keys[0].status = status;
    const changedBundle = replaceRegistryPayload(bundle, rootPrivateKey, registry);
    assert.ok(Date.parse(evidence.issued_at) < now.getTime(), "fixture evidence carries a past issuer assertion");
    const result = verify(inputName, evidence, changedBundle, {
      pinnedTrustRoot: { ...bundle.trust_root, source: contract.trust_root.application_pin_source },
    });
    assert.equal(result.signature_verified, true);
    assert.equal(result.registry_signer_authorized, authorized);
    assert.equal(result.registry_signer_authorization_status, authorized ? "AUTHORIZED_CURRENTLY" : "NOT_AUTHORIZED_CURRENTLY");
    assert.equal(result.historical_signer_authorization, "NOT_INDEPENDENTLY_VERIFIABLE");
    assert.equal(result.authority_trusted, authorized);
  }

  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle, rootPrivateKey } = trustBundle(inputName, signer);
  const registry = JSON.parse(Buffer.from(bundle.registry_payload_base64url, "base64url").toString("utf8"));
  registry.signed_fields.keys[0].status = "REVOKED";
  assert.throws(
    () => verify(inputName, evidence, replaceRegistryPayload(bundle, rootPrivateKey, registry)),
    /signer key is REVOKED/,
  );
});

test("current VERIFY_ONLY registry permits signature-integrity check but cannot prove historical ACTIVE status", () => {
  const inputName = authorityNames[0];
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle, rootPrivateKey } = trustBundle(inputName, signer);
  const registry = JSON.parse(Buffer.from(bundle.registry_payload_base64url, "base64url").toString("utf8"));
  registry.signed_fields.keys[0].status = "VERIFY_ONLY";
  const currentRegistry = replaceRegistryPayload(bundle, rootPrivateKey, registry);
  const result = verify(inputName, evidence, currentRegistry, {
    pinnedTrustRoot: { ...bundle.trust_root, source: contract.trust_root.application_pin_source },
  });

  assert.ok(Date.parse(evidence.issued_at) < now.getTime());
  assert.equal(result.signature_verified, true);
  assert.equal(result.evidence_issued_at_basis, "SIGNED_ISSUER_ASSERTION_NOT_INDEPENDENT_TIMESTAMP");
  assert.equal(result.registry_signer_authorized, false);
  assert.equal(result.authority_trusted, false);
  assert.equal(result.historical_signer_authorization, "NOT_INDEPENDENTLY_VERIFIABLE");
});

test("valid fixture signature verifies cryptographically but fixture root is not trusted", () => {
  for (const inputName of authorityNames) {
    const signer = keyPair();
    const evidence = signedEvidence(inputName, signer);
    const { bundle } = trustBundle(inputName, signer);
    const result = verify(inputName, evidence, bundle);
    assert.equal(result.signature_verified, true);
    assert.equal(result.registry_signer_authorized, true);
    assert.equal(result.authority_trusted, false);
    assert.equal(result.evidence_current_validity, "NOT_EVALUATED");
    assert.equal(result.candidate_readiness, "NOT_EVALUATED");
    assert.equal(result.trust_root_pinned, false);
    assert.match(result.signed_payload_sha256, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(result.registry_sha256, result.registry_fingerprint);
  }
});

test("temporal Frankenstein evidence is rejected across all authority domains", () => {
  for (const inputName of authorityNames) {
    const signer = keyPair();
    const setTimeline = (evidence, issuedAt, validFrom = issuedAt, validUntil = "2026-10-05T00:00:00.000Z") => {
      evidence.issued_at = issuedAt;
      evidence.valid_from = validFrom;
      evidence.valid_until = validUntil;
      return signEvidence(inputName, evidence, signer);
    };
    const { bundle, rootPrivateKey } = trustBundle(inputName, signer);
    const registryWindowBundle = (validFrom, validUntil, keyNotBefore = "2026-01-01T00:00:00.000Z", keyNotAfter = "2027-01-01T00:00:00.000Z") => {
      const registry = JSON.parse(Buffer.from(bundle.registry_payload_base64url, "base64url").toString("utf8"));
      registry.signed_fields.valid_from = validFrom;
      registry.signed_fields.valid_until = validUntil;
      registry.signed_fields.keys[0].not_before = keyNotBefore;
      registry.signed_fields.keys[0].not_after = keyNotAfter;
      return replaceRegistryPayload(bundle, rootPrivateKey, registry);
    };

    const currentRegistry = registryWindowBundle("2026-10-03T11:30:00.000Z", "2026-10-03T12:30:00.000Z");
    const currentEvidence = setTimeline(sampleEvidence(inputName), "2026-10-03T11:45:00.000Z");
    const validResult = verify(inputName, currentEvidence, currentRegistry);
    assert.equal(validResult.signature_verified, true, `${inputName} issued in the current registry window`);
    assert.equal(validResult.evidence_issued_at, currentEvidence.issued_at);
    assert.equal(validResult.evidence_issued_at_basis, "SIGNED_ISSUER_ASSERTION_NOT_INDEPENDENT_TIMESTAMP");

    const beforeActivation = setTimeline(sampleEvidence(inputName), "2026-10-03T11:15:00.000Z");
    assert.throws(
      () => verify(inputName, beforeActivation, currentRegistry),
      /evidence issued_at is outside authority registry validity interval/,
      `${inputName} issuer timestamp before registry activation must fail`,
    );

    const futureEvidence = setTimeline(
      sampleEvidence(inputName),
      "2026-10-03T11:45:00.000Z",
      "2026-10-04T00:00:00.000Z",
    );
    assert.equal(verify(inputName, futureEvidence, currentRegistry).signature_verified, true);
    const retroactiveEvidence = setTimeline(
      sampleEvidence(inputName),
      "2026-10-03T11:45:00.000Z",
      "2026-10-03T11:30:00.000Z",
    );
    assert.throws(() => verify(inputName, retroactiveEvidence, currentRegistry), /issued_at is after valid_from/);
    const emptyEvidenceWindow = setTimeline(
      sampleEvidence(inputName),
      "2026-10-03T11:45:00.000Z",
      "2026-10-03T11:45:00.000Z",
      "2026-10-03T11:45:00.000Z",
    );
    assert.throws(() => verify(inputName, emptyEvidenceWindow, currentRegistry), /evidence validity interval is invalid/);
    const futureIssuedEvidence = setTimeline(sampleEvidence(inputName), "2026-10-03T12:00:00.001Z");
    assert.throws(
      () => verify(inputName, futureIssuedEvidence, currentRegistry),
      /issued_at is after verification time/,
      `${inputName} cannot claim issuance after verification time`,
    );

    const inclusiveStart = setTimeline(sampleEvidence(inputName), "2026-10-03T11:30:00.000Z");
    assert.equal(verify(inputName, inclusiveStart, currentRegistry).signature_verified, true);
    const exclusiveEnd = setTimeline(sampleEvidence(inputName), "2026-10-03T12:30:00.000Z");
    assert.throws(
      () => verify(inputName, exclusiveEnd, registryWindowBundle("2026-10-03T11:30:00.000Z", "2026-10-03T12:30:00.000Z"), {
        now: new Date("2026-10-03T12:30:00.000Z"),
      }),
      /authority registry is outside its validity interval/,
      `${inputName} registry valid_until is exclusive`,
    );

    const keyNotValidAtIssue = registryWindowBundle(
      "2026-10-03T10:00:00.000Z",
      "2026-10-03T13:00:00.000Z",
      "2026-10-03T11:50:00.000Z",
    );
    assert.throws(() => verify(inputName, currentEvidence, keyNotValidAtIssue), /signer key is not valid at evidence issued_at/);

    const keyInclusiveStart = registryWindowBundle(
      "2026-10-03T10:00:00.000Z",
      "2026-10-03T13:00:00.000Z",
      currentEvidence.issued_at,
    );
    assert.equal(verify(inputName, currentEvidence, keyInclusiveStart).signature_verified, true);
    const keyExclusiveEnd = registryWindowBundle(
      "2026-10-03T10:00:00.000Z",
      "2026-10-03T13:00:00.000Z",
      "2026-10-03T11:00:00.000Z",
      currentEvidence.issued_at,
    );
    assert.throws(() => verify(inputName, currentEvidence, keyExclusiveEnd), /signer key is not valid at evidence issued_at/);

    const keyExpiredNow = registryWindowBundle(
      "2026-10-03T10:00:00.000Z",
      "2026-10-03T13:00:00.000Z",
      "2026-10-03T11:00:00.000Z",
      "2026-10-03T11:59:59.999Z",
    );
    const expiredKeyResult = verify(inputName, currentEvidence, keyExpiredNow);
    assert.equal(expiredKeyResult.signature_verified, true);
    assert.equal(expiredKeyResult.registry_signer_authorized, false);
    assert.equal(expiredKeyResult.registry_signer_authorization_status, "NOT_AUTHORIZED_CURRENTLY");

    const registryExpiredNow = registryWindowBundle("2026-10-03T11:30:00.000Z", "2026-10-03T11:59:59.999Z");
    assert.throws(() => verify(inputName, currentEvidence, registryExpiredNow), /authority registry is outside its validity interval/);
  }
});

test("registry and signer key time failures are distinct", () => {
  const inputName = authorityNames[0];
  const signer = keyPair();
  const evidence = signEvidence(inputName, {
    ...sampleEvidence(inputName),
    issued_at: "2026-10-03T11:00:00.000Z",
    valid_from: "2026-10-03T11:00:00.000Z",
    valid_until: "2026-10-05T00:00:00.000Z",
  }, signer);
  const { bundle, rootPrivateKey } = trustBundle(inputName, signer);
  const registry = JSON.parse(Buffer.from(bundle.registry_payload_base64url, "base64url").toString("utf8"));
  registry.signed_fields.valid_from = "2026-10-03T10:00:00.000Z";
  registry.signed_fields.valid_until = "2026-10-03T13:00:00.000Z";
  registry.signed_fields.keys[0].not_before = "2026-10-03T11:30:00.000Z";
  registry.signed_fields.keys[0].not_after = "2026-10-04T00:00:00.000Z";
  const registryCurrentButKeyNotValidAtSignedAt = replaceRegistryPayload(bundle, rootPrivateKey, registry);
  assert.throws(
    () => verify(inputName, evidence, registryCurrentButKeyNotValidAtSignedAt),
    /signer key is not valid at evidence issued_at/,
  );

  registry.signed_fields.keys[0].not_before = "2026-10-01T00:00:00.000Z";
  registry.signed_fields.keys[0].not_after = "2026-10-04T00:00:00.000Z";
  const signerKeyCurrentButRegistryNotValidAtSignedAt = replaceRegistryPayload(bundle, rootPrivateKey, registry);
  registry.signed_fields.valid_from = "2026-10-03T11:15:00.000Z";
  const registryActivationAfterSignedAt = replaceRegistryPayload(bundle, rootPrivateKey, registry);
  assert.throws(
    () => verify(inputName, evidence, registryActivationAfterSignedAt),
    /evidence issued_at is outside authority registry validity interval/,
  );
  assert.equal(verify(inputName, evidence, signerKeyCurrentButRegistryNotValidAtSignedAt).signature_verified, true);
});

test("low-level signature verification does not claim expired evidence is current", () => {
  const inputName = authorityNames[0];
  const signer = keyPair();
  const expiredApproval = signEvidence(inputName, {
    ...sampleEvidence(inputName),
    valid_until: "2026-10-02T00:00:00.000Z",
  }, signer);
  const { bundle } = trustBundle(inputName, signer);
  const result = verify(inputName, expiredApproval, bundle);
  assert.equal(result.signature_verified, true);
  assert.equal(result.authority_trusted, false);
  assert.equal(result.evidence_current_validity, "NOT_EVALUATED");
  assert.equal(result.candidate_readiness, "NOT_EVALUATED");
});

test("altered payload and altered signature are rejected", () => {
  const inputName = authorityNames[0];
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle } = trustBundle(inputName, signer);

  assert.throws(() => verify(inputName, { ...evidence, approval_id: "changed" }, bundle), /payload digest mismatch/);
  const alteredWithRecomputedDigest = { ...evidence, approval_id: "changed" };
  const alteredPayload = canonicalCandidateConfigurationSignedPayload(inputName, alteredWithRecomputedDigest);
  alteredWithRecomputedDigest.signature = {
    ...evidence.signature,
    payload_sha256: hash(alteredPayload),
  };
  assert.throws(() => verify(inputName, alteredWithRecomputedDigest, bundle), /signature is invalid/);
  assert.throws(() => verify(inputName, {
    ...evidence,
    signature: { ...evidence.signature, value: Buffer.alloc(64, 9).toString("base64url") },
  }, bundle), /signature is invalid/);
});

test("wrong signer, key ID, scope, algorithm, revoked key, and invalid key windows fail closed", () => {
  const inputName = authorityNames[0];
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle } = trustBundle(inputName, signer);

  const wrongSigner = keyPair();
  assert.throws(() => verify(inputName, evidence, trustBundle(inputName, wrongSigner).bundle), /signature is invalid/);
  assert.throws(() => verify(inputName, {
    ...evidence,
    signature: { ...evidence.signature, key_id: "other-key" },
  }, bundle), /signature key ID does not match/);
  assert.throws(() => verify(inputName, {
    ...evidence,
    signature: { ...evidence.signature, algorithm: "RSA-SHA256" },
  }, bundle), /algorithm is invalid/);
  assert.throws(() => verify(inputName, evidence, { ...bundle, authority_type: "TRUSTED_BUILDER" }), /type mismatch/);

  const revoked = trustBundle(inputName, signer);
  const registry = JSON.parse(Buffer.from(revoked.bundle.registry_payload_base64url, "base64url").toString("utf8"));
  registry.signed_fields.keys[0].status = "REVOKED";
  assert.throws(() => verify(inputName, evidence, replaceRegistryPayload(
    revoked.bundle,
    revoked.rootPrivateKey,
    registry,
  )), /signer key is REVOKED/);
});

test("wrong root, invalid registry digest, and expired or future root/key are rejected", () => {
  const inputName = authorityNames[1];
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle } = trustBundle(inputName, signer);
  const wrongRoot = keyPair();
  const changedRoot = {
    ...bundle,
    trust_root: {
      ...bundle.trust_root,
      public_key_spki: wrongRoot.publicKeySpki,
    },
  };
  assert.throws(() => verify(inputName, evidence, changedRoot), /registry Ed25519 signature is invalid/);
  assert.throws(() => verify(inputName, evidence, { ...bundle, registry_sha256: hash(Buffer.from("wrong")) }), /registry hash mismatch/);
  assert.throws(() => verify(inputName, evidence, {
    ...bundle,
    trust_root: { ...bundle.trust_root, not_after: "2026-10-03T12:00:00.000Z" },
  }), /trust root is outside/);

  const pinMismatch = keyPair();
  const untrustedPinResult = verify(inputName, evidence, bundle, {
    pinnedTrustRoot: {
      ...bundle.trust_root,
      public_key_spki: pinMismatch.publicKeySpki,
      source: contract.trust_root.application_pin_source,
    },
  });
  assert.equal(untrustedPinResult.signature_verified, true);
  assert.equal(untrustedPinResult.authority_trusted, false);

  const futureSigner = keyPair();
  const futureEvidence = signedEvidence(inputName, futureSigner);
  const futureBundle = trustBundle(inputName, futureSigner);
  const registry = JSON.parse(Buffer.from(futureBundle.bundle.registry_payload_base64url, "base64url").toString("utf8"));
  registry.signed_fields.keys[0].not_before = "2026-10-04T00:00:00.000Z";
  const registryBytes = Buffer.from(canonicalJson(registry), "utf8");
  const root = keyPair();
  const rootIdentity = {
    ...futureBundle.bundle.trust_root,
    public_key_spki: root.publicKeySpki,
  };
  const sigPayloadHash = hash(registryBytes);
  const resignedRegistry = {
    ...futureBundle.bundle,
    trust_root: rootIdentity,
    registry_payload_base64url: registryBytes.toString("base64url"),
    registry_sha256: sigPayloadHash,
    registry_signature: {
      algorithm: "Ed25519",
      key_id: rootIdentity.key_id,
      payload_sha256: sigPayloadHash,
      value: sign(null, registryBytes, root.privateKey).toString("base64url"),
    },
  };
  assert.throws(() => verify(inputName, futureEvidence, resignedRegistry), /signer key is not valid at evidence issued_at/);

  const expiredSigner = keyPair();
  const expiredEvidence = signedEvidence(inputName, expiredSigner);
  const expiredBundle = trustBundle(inputName, expiredSigner);
  const expiredRegistry = JSON.parse(Buffer.from(expiredBundle.bundle.registry_payload_base64url, "base64url").toString("utf8"));
  expiredRegistry.signed_fields.keys[0].not_after = "2026-10-03T11:59:59.999Z";
  const expiredSignerResult = verify(inputName, expiredEvidence, replaceRegistryPayload(
    expiredBundle.bundle,
    expiredBundle.rootPrivateKey,
    expiredRegistry,
  ));
  assert.equal(expiredSignerResult.signature_verified, true);
  assert.equal(expiredSignerResult.registry_signer_authorized, false);
});

test("registry key scope must authorize exactly the evidence domain", () => {
  const inputName = authorityNames[2];
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle, rootPrivateKey } = trustBundle(inputName, signer);
  const registry = JSON.parse(Buffer.from(bundle.registry_payload_base64url, "base64url").toString("utf8"));
  registry.signed_fields.keys[0].scopes = [contract.inputs[authorityNames[0]].signed_payload_scope];
  const result = verify(inputName, evidence, replaceRegistryPayload(bundle, rootPrivateKey, registry));
  assert.equal(result.signature_verified, true);
  assert.equal(result.registry_signer_authorized, false);
  assert.equal(result.authority_trusted, false);
});

test("builder workflow and authority capture fields are covered by their signatures", () => {
  for (const inputName of authorityNames.slice(1)) {
    const signer = keyPair();
    const evidence = signedEvidence(inputName, signer);
    const { bundle } = trustBundle(inputName, signer);
    const changed = inputName === "AUTHENTICATED_BUILDER_PROVENANCE"
      ? { ...evidence, build_workflow_identity: "owner/other-workflow.yml" }
      : { ...evidence, capture_identity: { ...evidence.capture_identity, request_id: "request-B" } };
    changed.signature = {
      ...evidence.signature,
      payload_sha256: hash(canonicalCandidateConfigurationSignedPayload(inputName, changed)),
    };
    assert.throws(() => verify(inputName, changed, bundle), /signature is invalid/);
  }
});

test("cross-authority signature transplantation is rejected for all authority pairs", async (t) => {
  const evidenceByType = new Map();
  const bundleByType = new Map();
  for (const inputName of authorityNames) {
    const signer = keyPair();
    evidenceByType.set(inputName, signedEvidence(inputName, signer));
    bundleByType.set(inputName, trustBundle(inputName, signer).bundle);
  }
  for (const sourceName of authorityNames) {
    for (const targetName of authorityNames) {
      if (sourceName === targetName) continue;
      await t.test(`${sourceName} signature cannot authenticate ${targetName}`, () => {
        const target = evidenceByType.get(targetName);
        const payload = canonicalCandidateConfigurationSignedPayload(targetName, target);
        const transplanted = {
          ...target,
          signature: {
            ...evidenceByType.get(sourceName).signature,
            key_id: signerIdentity(targetName).key_id,
            payload_sha256: hash(payload),
          },
        };
        assert.throws(() => verify(targetName, transplanted, bundleByType.get(targetName)), /signature is invalid/);
      });
    }
  }
});

test("TEST_FIXTURE_ONLY root pin never establishes authority trust", () => {
  const inputName = authorityNames[2];
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle, rootIdentity } = trustBundle(inputName, signer);
  const result = verify(inputName, evidence, bundle, {
    pinnedTrustRoot: { ...rootIdentity, source: contract.trust_root.test_pin_source },
  });
  assert.equal(result.signature_verified, true);
  assert.equal(result.trust_root_pinned, true);
  assert.equal(result.authority_trusted, false);
  assert.equal(result.trust_source, "UNPINNED_OR_TEST_FIXTURE_OR_UNAUTHORIZED_SIGNER");
});

test("only a matching application-configuration root pin establishes authority trust", () => {
  const inputName = authorityNames[0];
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle, rootIdentity } = trustBundle(inputName, signer);
  const result = verify(inputName, evidence, bundle, {
    pinnedTrustRoot: {
      ...rootIdentity,
      source: contract.trust_root.application_pin_source,
    },
  });
  assert.equal(result.signature_verified, true);
  assert.equal(result.registry_signer_authorized, true);
  assert.equal(result.authority_trusted, true);
  assert.equal(result.trust_source, "APPLICATION_TRUSTED_CONFIGURATION");
  assert.equal(result.candidate_readiness, "NOT_EVALUATED");
});

test("assessment separates valid signature verification from authority trust", () => {
  const signer = keyPair();
  const assessmentTargets = {
    APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT: {
      evidence: "approvedExpectedConfigurationFingerprint",
      report: "approved_expected_fingerprint",
    },
    AUTHENTICATED_BUILDER_PROVENANCE: {
      evidence: "trustedBuilderProvenance",
      report: "trusted_builder_provenance",
    },
    INDEPENDENT_AUTHORITY_RECEIPT: {
      evidence: "independentAuthorityReceipt",
      report: "independent_authority_receipt",
    },
  };
  for (const inputName of authorityNames) {
    const signed = signedEvidence(inputName, signer);
    const { bundle } = trustBundle(inputName, signer);
    const evidenceKey = assessmentTargets[inputName].evidence;
    const reportKey = assessmentTargets[inputName].report;
    const assessment = candidateConfigurationBindingAssessment({
      [evidenceKey]: signed,
      authorityTrustBundles: { [contract.inputs[inputName].authority_type]: bundle },
      now,
    });
    assert.equal(assessment.status, "UNVERIFIED");
    assert.equal(assessment[reportKey].signature_verification, "VALID");
    assert.equal(assessment[reportKey].registry_signer_authorization, "AUTHORIZED_CURRENTLY");
    assert.equal(assessment[reportKey].historical_signer_authorization, "NOT_INDEPENDENTLY_VERIFIABLE");
    assert.equal(assessment[reportKey].authority_trusted, false);
  }
});

test("VERIFY_ONLY evidence cannot promote application-pinned assessment authority", () => {
  const inputName = "APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT";
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle, rootPrivateKey } = trustBundle(inputName, signer);
  const registry = JSON.parse(Buffer.from(bundle.registry_payload_base64url, "base64url").toString("utf8"));
  registry.signed_fields.keys[0].status = "VERIFY_ONLY";
  const verifyOnlyBundle = replaceRegistryPayload(bundle, rootPrivateKey, registry);
  const assessment = candidateConfigurationBindingAssessment({
    approvedExpectedConfigurationFingerprint: evidence,
    authorityTrustBundles: { CONFIGURATION_APPROVAL: verifyOnlyBundle },
    trustedAuthorityTrustRoots: {
      CONFIGURATION_APPROVAL: { ...bundle.trust_root, source: contract.trust_root.application_pin_source },
    },
    now,
  });

  assert.equal(assessment.status, "UNVERIFIED");
  assert.equal(assessment.readiness_gate, "BLOCKED");
  assert.equal(assessment.approved_expected_fingerprint.signature_verification, "VALID");
  assert.equal(assessment.approved_expected_fingerprint.registry_signer_authorization, "NOT_AUTHORIZED_CURRENTLY");
  assert.equal(assessment.approved_expected_fingerprint.authority_trusted, false);
  assert.equal(assessment.approved_expected_fingerprint.historical_signer_authorization, "NOT_INDEPENDENTLY_VERIFIABLE");
});

test("Configuration Approval VERIFY_ONLY key transplanted into Builder scope cannot authorize Builder evidence", () => {
  const approvalName = "APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT";
  const builderName = "AUTHENTICATED_BUILDER_PROVENANCE";
  const signer = keyPair();
  const { bundle: approvalBundle, rootPrivateKey: approvalRootPrivateKey } = trustBundle(approvalName, signer);
  const approvalRegistry = JSON.parse(Buffer.from(approvalBundle.registry_payload_base64url, "base64url").toString("utf8"));
  approvalRegistry.signed_fields.keys[0].status = "VERIFY_ONLY";
  const signedApprovalBundle = replaceRegistryPayload(approvalBundle, approvalRootPrivateKey, approvalRegistry);
  const approvalKey = JSON.parse(Buffer.from(signedApprovalBundle.registry_payload_base64url, "base64url").toString("utf8"))
    .signed_fields.keys[0];

  const builderEvidence = sampleEvidence(builderName);
  builderEvidence.builder_identity = approvalKey.authority_id;
  builderEvidence.builder_signing_key_id = approvalKey.key_id;
  const builderPayload = canonicalCandidateConfigurationSignedPayload(builderName, builderEvidence);
  builderEvidence.signature = {
    algorithm: "Ed25519",
    key_id: approvalKey.key_id,
    payload_sha256: hash(builderPayload),
    value: sign(null, builderPayload, signer.privateKey).toString("base64url"),
  };

  const { bundle: builderBundle, rootPrivateKey: builderRootPrivateKey } = trustBundle(builderName, signer);
  const builderRegistry = JSON.parse(Buffer.from(builderBundle.registry_payload_base64url, "base64url").toString("utf8"));
  builderRegistry.signed_fields.authority_id = approvalKey.authority_id;
  builderRegistry.signed_fields.keys = [{ ...approvalKey }];
  const transplantedBundle = replaceRegistryPayload(builderBundle, builderRootPrivateKey, builderRegistry);
  const result = verify(builderName, builderEvidence, transplantedBundle, {
    pinnedTrustRoot: { ...builderBundle.trust_root, source: contract.trust_root.application_pin_source },
  });

  assert.equal(result.signature_verified, true);
  assert.equal(result.registry_signer_authorized, false);
  assert.equal(result.authority_trusted, false);
});

test("same public key cannot cross authority domains by changing VERIFY_ONLY to ACTIVE", () => {
  const sharedSigner = keyPair();
  const approvalEvidence = signedEvidence(authorityNames[0], sharedSigner);
  const builderEvidence = signedEvidence(authorityNames[1], sharedSigner);
  const approval = trustBundle(authorityNames[0], sharedSigner);
  const approvalRegistry = JSON.parse(Buffer.from(approval.bundle.registry_payload_base64url, "base64url").toString("utf8"));
  approvalRegistry.signed_fields.keys[0].status = "VERIFY_ONLY";
  const approvalBundle = replaceRegistryPayload(approval.bundle, approval.rootPrivateKey, approvalRegistry);
  const builderBundle = trustBundle(authorityNames[1], sharedSigner).bundle;
  const assessment = candidateConfigurationBindingAssessment({
    approvedExpectedConfigurationFingerprint: approvalEvidence,
    trustedBuilderProvenance: builderEvidence,
    authorityTrustBundles: {
      CONFIGURATION_APPROVAL: approvalBundle,
      TRUSTED_BUILDER: builderBundle,
    },
    now,
  });

  assert.equal(approvalRegistry.signed_fields.keys[0].status, "VERIFY_ONLY");
  assert.equal(JSON.parse(Buffer.from(builderBundle.registry_payload_base64url, "base64url").toString("utf8"))
    .signed_fields.keys[0].status, "ACTIVE");
  assert.equal(assessment.approved_expected_fingerprint.signature_verification, "INVALID");
  assert.equal(assessment.trusted_builder_provenance.signature_verification, "INVALID");
  assert.equal(assessment.status, "UNVERIFIED");
});

test("a signer key reused across authority registries invalidates every affected domain", () => {
  const sharedSigner = keyPair();
  const evidenceByInput = Object.fromEntries(authorityNames.map((inputName) => [
    inputName,
    signedEvidence(inputName, sharedSigner),
  ]));
  const trustBundles = Object.fromEntries(authorityNames.map((inputName) => [
    contract.inputs[inputName].authority_type,
    trustBundle(inputName, sharedSigner).bundle,
  ]));
  const assessment = candidateConfigurationBindingAssessment({
    approvedExpectedConfigurationFingerprint: evidenceByInput.APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT,
    trustedBuilderProvenance: evidenceByInput.AUTHENTICATED_BUILDER_PROVENANCE,
    independentAuthorityReceipt: evidenceByInput.INDEPENDENT_AUTHORITY_RECEIPT,
    authorityTrustBundles: trustBundles,
    now,
  });
  assert.equal(assessment.approved_expected_fingerprint.signature_verification, "INVALID");
  assert.equal(assessment.trusted_builder_provenance.signature_verification, "INVALID");
  assert.equal(assessment.independent_authority_receipt.signature_verification, "INVALID");
  assert.equal(assessment.status, "UNVERIFIED");
});