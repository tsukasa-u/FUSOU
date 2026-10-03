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
  assert.equal(contract.evidence_digest_semantics.referenced_artifact_loaded, false);
  assert.equal(contract.evidence_digest_semantics.digest_recomputed, false);
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
    assert.throws(() => verify(inputName, currentEvidence, keyExpiredNow), /signer key is not currently valid/);

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
  )), /signer key is revoked or retired/);
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
  assert.throws(() => verify(inputName, expiredEvidence, replaceRegistryPayload(
    expiredBundle.bundle,
    expiredBundle.rootPrivateKey,
    expiredRegistry,
  )), /signer key is not currently valid/);
});

test("registry key scope must authorize exactly the evidence domain", () => {
  const inputName = authorityNames[2];
  const signer = keyPair();
  const evidence = signedEvidence(inputName, signer);
  const { bundle, rootPrivateKey } = trustBundle(inputName, signer);
  const registry = JSON.parse(Buffer.from(bundle.registry_payload_base64url, "base64url").toString("utf8"));
  registry.signed_fields.keys[0].scopes = [contract.inputs[authorityNames[0]].signed_payload_scope];
  assert.throws(() => verify(inputName, evidence, replaceRegistryPayload(bundle, rootPrivateKey, registry)), /not authorized for this payload scope/);
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
  assert.equal(result.trust_source, "UNPINNED_OR_TEST_FIXTURE");
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
    assert.equal(assessment[reportKey].registry_signer_authorization, "VALID");
    assert.equal(assessment[reportKey].authority_trusted, false);
  }
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