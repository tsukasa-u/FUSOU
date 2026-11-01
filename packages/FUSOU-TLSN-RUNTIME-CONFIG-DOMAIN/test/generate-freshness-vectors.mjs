#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import {
  TLSN_RUNTIME_CONFIG_FRESHNESS as C,
  runtimeConfigFreshnessSigningBytes,
} from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness.mjs";

const NOW = Date.parse("2026-11-02T00:00:00.000Z");
const MANIFEST_URL =
  "https://runtime-config.example.com/tlsn/runtime-config/v2/manifest.json";
const PKCS8_ED25519_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

function testKey(seedStart) {
  const seed = Buffer.from(
    Array.from({ length: 32 }, (_, index) => (seedStart + index) & 0xff),
  );
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  return {
    privateKey,
    publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

function bytes(value) {
  return Buffer.from(value);
}

function encode(raw) {
  return bytes(raw).toString("base64url");
}

function hash(raw) {
  return createHash("sha256").update(raw).digest("base64url");
}

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function signedEnvelope({ scope, keyField, keyId, domain, payload, signer }) {
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  const signature = sign(
    null,
    runtimeConfigFreshnessSigningBytes(domain, keyId, payloadBytes),
    signer.privateKey,
  );
  return Buffer.from(
    canonicalJson({
      schema_version: 1,
      scope,
      signature_algorithm: "Ed25519",
      [keyField]: keyId,
      payload_base64url: payloadBytes.toString("base64url"),
      signature_base64url: signature.toString("base64url"),
    }),
    "utf8",
  );
}

function makeDelegation(payload, root) {
  return signedEnvelope({
    scope: C.delegationEnvelopeScope,
    keyField: "root_key_id",
    keyId: "p1-golden-root",
    domain: C.delegationDomain,
    payload,
    signer: root,
  });
}

function makeReleaseRecord(payload, releaseSigner) {
  return signedEnvelope({
    scope: C.releaseEnvelopeScope,
    keyField: "signer_key_id",
    keyId: "p1-golden-release",
    domain: C.releaseDomain,
    payload,
    signer: releaseSigner,
  });
}

function makeResponse(payload, {
  freshnessSigner,
  freshnessDelegationRaw,
  releaseDelegationRaw,
  releaseRecordRaw,
  domain = C.freshnessDomain,
  envelopeKeyId = "p1-golden-freshness",
} = {}) {
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  const signature = sign(
    null,
    runtimeConfigFreshnessSigningBytes(domain, "p1-golden-freshness", payloadBytes),
    freshnessSigner.privateKey,
  );
  return Buffer.from(
    canonicalJson({
      schema_version: 1,
      scope: C.responseEnvelopeScope,
      signature_algorithm: "Ed25519",
      signer_key_id: envelopeKeyId,
      freshness_delegation_base64url: encode(freshnessDelegationRaw),
      release_authority_delegation_base64url: encode(releaseDelegationRaw),
      release_commit_record_base64url: encode(releaseRecordRaw),
      payload_base64url: payloadBytes.toString("base64url"),
      signature_base64url: signature.toString("base64url"),
    }),
    "utf8",
  );
}

function responseEnvelope(raw) {
  return JSON.parse(Buffer.from(raw).toString("utf8"));
}

function responsePayload(raw) {
  return JSON.parse(
    Buffer.from(responseEnvelope(raw).payload_base64url, "base64url").toString("utf8"),
  );
}

function signedResponseWithChanges(validRaw, setup, changes, domain = C.freshnessDomain) {
  const payload = { ...responsePayload(validRaw), ...changes };
  return makeResponse(payload, {
    ...setup,
    domain,
  });
}

function requestWithChanges(request, changes) {
  return Buffer.from(canonicalJson({ ...request, ...changes }), "utf8");
}

const root = testKey(0x10);
const releaseSigner = testKey(0x40);
const freshnessSigner = testKey(0x70);
const requestNonce = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const audience = hash(Buffer.from(MANIFEST_URL, "utf8"));
const issuedAt = NOW - 60_000;
const freshnessDelegationPayload = {
  schema_version: 1,
  scope: C.delegationPayloadScope,
  delegation_id: "00000000-0000-4000-8000-000000000101",
  delegation_generation: "1",
  environment: "production",
  purpose: "freshness-response-v1",
  key_id: "p1-golden-freshness",
  public_key_spki: freshnessSigner.publicKeySpki,
  signature_algorithm: "Ed25519",
  audience,
  issued_at: iso(issuedAt),
  not_before: iso(issuedAt),
  not_after: iso(issuedAt + C.maxFreshnessDelegationLifetimeSeconds * 1_000),
  max_validity_seconds: C.maxFreshnessDelegationLifetimeSeconds,
  revocation_mode: "expiry-only-v1",
  previous_delegation_sha256: null,
};
const releaseDelegationPayload = {
  schema_version: 1,
  scope: C.delegationPayloadScope,
  delegation_id: "00000000-0000-4000-8000-000000000102",
  delegation_generation: "1",
  environment: "production",
  purpose: "release-commit-record-v1",
  key_id: "p1-golden-release",
  public_key_spki: releaseSigner.publicKeySpki,
  signature_algorithm: "Ed25519",
  audience: `${C.releaseAudiencePrefix}production`,
  issued_at: iso(issuedAt),
  not_before: iso(issuedAt),
  not_after: iso(issuedAt + C.maxReleaseDelegationLifetimeSeconds * 1_000),
  max_validity_seconds: C.maxReleaseDelegationLifetimeSeconds,
  revocation_mode: "expiry-only-v1",
  previous_delegation_sha256: null,
};
const freshnessDelegationRaw = makeDelegation(freshnessDelegationPayload, root);
const releaseDelegationRaw = makeDelegation(releaseDelegationPayload, root);
const freshnessDelegationDigest = hash(freshnessDelegationRaw);
const releaseDelegationDigest = hash(releaseDelegationRaw);
const manifestSha256 = hash(Buffer.from("p1-golden-manifest-v2"));
const previousManifestSha256 = hash(Buffer.from("p1-golden-prior-manifest-v2"));
const previousRecordRaw = makeReleaseRecord(
  {
    schema_version: 1,
    scope: C.releasePayloadScope,
    environment: "production",
    commit_authorization: "AUTHORIZE_JOURNAL_APPEND",
    commit_generation: "1",
    release_commit_id: "00000000-0000-4000-8000-000000000201",
    manifest_schema_version: 2,
    manifest_epoch: "42",
    manifest_sha256: previousManifestSha256,
    manifest_ref: `${C.immutableManifestPrefix}${previousManifestSha256}`,
    pointer_etag: "p1-prior-etag",
    previous_commit_generation: null,
    previous_commit_record_sha256: null,
    authorized_at: iso(NOW - 30_000),
    release_authority_delegation_id: releaseDelegationPayload.delegation_id,
    release_authority_delegation_sha256: releaseDelegationDigest,
  },
  releaseSigner,
);
const previousRecordSha256 = hash(previousRecordRaw);
const releaseCommitRecordAppendedAt = iso(NOW - 5_000);
const releasePayload = {
  schema_version: 1,
  scope: C.releasePayloadScope,
  environment: "production",
  commit_authorization: "AUTHORIZE_JOURNAL_APPEND",
  commit_generation: "2",
  release_commit_id: "00000000-0000-4000-8000-000000000202",
  manifest_schema_version: 2,
  manifest_epoch: "43",
  manifest_sha256: manifestSha256,
  manifest_ref: `${C.immutableManifestPrefix}${manifestSha256}`,
  pointer_etag: "etag-é-🌱",
  previous_commit_generation: "1",
  previous_commit_record_sha256: previousRecordSha256,
  authorized_at: iso(NOW - 10_000),
  release_authority_delegation_id: releaseDelegationPayload.delegation_id,
  release_authority_delegation_sha256: releaseDelegationDigest,
};
const releaseCommitRecordRaw = makeReleaseRecord(releasePayload, releaseSigner);
const request = {
  schema_version: 1,
  scope: C.requestScope,
  environment: "production",
  audience_manifest_url_sha256: audience,
  request_nonce: requestNonce.toString("base64url"),
};
const requestRaw = Buffer.from(canonicalJson(request), "utf8");
const responsePayloadBase = {
  schema_version: 1,
  scope: C.responsePayloadScope,
  freshness_semantics: "LATEST_AT_ISSUANCE",
  environment: "production",
  audience_manifest_url_sha256: audience,
  request_nonce: request.request_nonce,
  issued_at: iso(NOW),
  expires_at: iso(NOW + C.maxResponseLifetimeMs),
  latest_epoch: "43",
  manifest_schema_version: 2,
  manifest_sha256: manifestSha256,
  manifest_ref: `${C.immutableManifestPrefix}${manifestSha256}`,
  pointer_generation: "2",
  release_commit_id: releasePayload.release_commit_id,
  release_commit_record_sha256: hash(releaseCommitRecordRaw),
  release_commit_record_appended_at: releaseCommitRecordAppendedAt,
  freshness_signer_key_id: "p1-golden-freshness",
  freshness_delegation_id: freshnessDelegationPayload.delegation_id,
  freshness_delegation_sha256: freshnessDelegationDigest,
  release_authority_key_id: "p1-golden-release",
  release_authority_delegation_id: releaseDelegationPayload.delegation_id,
  release_authority_delegation_sha256: releaseDelegationDigest,
};
const responseSetup = {
  freshnessSigner,
  freshnessDelegationRaw,
  releaseDelegationRaw,
  releaseRecordRaw: releaseCommitRecordRaw,
};
const responseRaw = makeResponse(responsePayloadBase, responseSetup);

const invalidSignatureEnvelope = responseEnvelope(responseRaw);
const invalidSignature = Buffer.from(
  invalidSignatureEnvelope.signature_base64url,
  "base64url",
);
invalidSignature[0] ^= 0x80;
invalidSignatureEnvelope.signature_base64url = invalidSignature.toString("base64url");

const wrongKeyIdEnvelope = responseEnvelope(responseRaw);
wrongKeyIdEnvelope.signer_key_id = "p1-wrong-key";

const unknownResponseEnvelope = {
  ...responseEnvelope(responseRaw),
  unexpected_field: "must reject",
};

const unknownRequest = Buffer.from(
  canonicalJson({ ...request, unexpected_field: "must reject" }),
  "utf8",
);
const reorderedRequest = Buffer.from(
  JSON.stringify(Object.fromEntries(Object.entries(request).reverse())),
  "utf8",
);
const noncanonicalNumberRequest = Buffer.from(
  canonicalJson(request).replace('"schema_version":1', '"schema_version":1.0'),
  "utf8",
);
const paddedRequest = requestWithChanges(request, {
  request_nonce: `${request.request_nonce}=`,
});
const malformedRequest = requestWithChanges(request, { request_nonce: "A" });

const freshnessOverlongPayload = {
  ...freshnessDelegationPayload,
  not_after: iso(
    issuedAt + C.maxFreshnessDelegationLifetimeSeconds * 1_000 + 1_000,
  ),
};
const releaseOverlongPayload = {
  ...releaseDelegationPayload,
  not_after: iso(
    issuedAt + C.maxReleaseDelegationLifetimeSeconds * 1_000 + 1_000,
  ),
};

const recordWith = (changes) =>
  makeReleaseRecord({ ...releasePayload, ...changes }, releaseSigner);
const overflow = "18446744073709551616";
const mismatchedPreviousDigest = hash(Buffer.from("not-the-previous-record"));
const mismatchAttemptRecord = recordWith({
  previous_commit_record_sha256: mismatchedPreviousDigest,
});
const unpairedSurrogateRecord = recordWith({ pointer_etag: "\ud800" });

const responseCases = {
  invalid_signature_raw_base64url: encode(
    Buffer.from(canonicalJson(invalidSignatureEnvelope), "utf8"),
  ),
  wrong_domain_raw_base64url: encode(
    signedResponseWithChanges(responseRaw, responseSetup, {}, C.releaseDomain),
  ),
  wrong_key_id_raw_base64url: encode(
    Buffer.from(canonicalJson(wrongKeyIdEnvelope), "utf8"),
  ),
  wrong_delegation_digest_raw_base64url: encode(
    signedResponseWithChanges(responseRaw, responseSetup, {
      freshness_delegation_sha256: hash(Buffer.from("wrong-delegation")),
    }),
  ),
  wrong_nonce_raw_base64url: encode(
    signedResponseWithChanges(responseRaw, responseSetup, {
      request_nonce: Buffer.alloc(32, 0xee).toString("base64url"),
    }),
  ),
  wrong_audience_raw_base64url: encode(
    signedResponseWithChanges(responseRaw, responseSetup, {
      audience_manifest_url_sha256: hash(Buffer.from("wrong-audience")),
    }),
  ),
  wrong_environment_raw_base64url: encode(
    signedResponseWithChanges(responseRaw, responseSetup, {
      environment: "canary",
    }),
  ),
  invalid_timestamp_order_raw_base64url: encode(
    signedResponseWithChanges(responseRaw, responseSetup, {
      expires_at: iso(NOW - 1),
    }),
  ),
  response_lifetime_overflow_raw_base64url: encode(
    signedResponseWithChanges(responseRaw, responseSetup, {
      expires_at: iso(NOW + C.maxResponseLifetimeMs + 1),
    }),
  ),
  unknown_field_raw_base64url: encode(
    Buffer.from(canonicalJson(unknownResponseEnvelope), "utf8"),
  ),
  noncanonical_json_raw_base64url: encode(
    Buffer.concat([Buffer.from(" ", "utf8"), responseRaw]),
  ),
};

const delegationCases = {
  freshness_overlong_raw_base64url: encode(
    makeDelegation(freshnessOverlongPayload, root),
  ),
  release_overlong_raw_base64url: encode(
    makeDelegation(releaseOverlongPayload, root),
  ),
};

const releaseRecordCases = {
  generation_overflow_raw_base64url: encode(
    recordWith({
      commit_generation: overflow,
      previous_commit_generation: "18446744073709551615",
    }),
  ),
  epoch_overflow_raw_base64url: encode(
    recordWith({ manifest_epoch: overflow }),
  ),
  previous_generation_mismatch_raw_base64url: encode(
    recordWith({ previous_commit_generation: "0" }),
  ),
  previous_digest_mismatch_raw_base64url: encode(mismatchAttemptRecord),
  unpaired_surrogate_raw_base64url: encode(unpairedSurrogateRecord),
};

const vector = {
  schema_version: 1,
  test_only: true,
  manifest_url: MANIFEST_URL,
  now_ms: NOW,
  root_signer: {
    scope: "fusou-tlsn-runtime-config-signing-root-v2",
    key_id: "p1-golden-root",
    public_key_spki: root.publicKeySpki,
  },
  request_raw_base64url: encode(requestRaw),
  freshness_delegation_raw_base64url: encode(freshnessDelegationRaw),
  release_delegation_raw_base64url: encode(releaseDelegationRaw),
  release_commit_record_raw_base64url: encode(releaseCommitRecordRaw),
  release_commit_record_appended_at: releaseCommitRecordAppendedAt,
  previous_release_commit_record_raw_base64url: encode(previousRecordRaw),
  manifest_raw_base64url: encode(Buffer.from("p1-golden-manifest-v2")),
  previous_head: {
    generation: "1",
    record_sha256: previousRecordSha256,
    manifest_epoch: "42",
  },
  pending_attempt: {
    attempt_id: releasePayload.release_commit_id,
    environment: releasePayload.environment,
    commit_generation: releasePayload.commit_generation,
    release_commit_id: releasePayload.release_commit_id,
    manifest_schema_version: releasePayload.manifest_schema_version,
    manifest_epoch: releasePayload.manifest_epoch,
    manifest_sha256: releasePayload.manifest_sha256,
    manifest_ref: releasePayload.manifest_ref,
    pointer_etag: releasePayload.pointer_etag,
    previous_commit_generation: releasePayload.previous_commit_generation,
    previous_commit_record_sha256: releasePayload.previous_commit_record_sha256,
    release_authority_delegation_id: releasePayload.release_authority_delegation_id,
    release_authority_delegation_sha256:
      releasePayload.release_authority_delegation_sha256,
  },
  freshness_delegation_bounds: {
    not_before: freshnessDelegationPayload.not_before,
    not_after: freshnessDelegationPayload.not_after,
    lifetime_seconds: C.maxFreshnessDelegationLifetimeSeconds,
  },
  release_delegation_bounds: {
    not_before: releaseDelegationPayload.not_before,
    not_after: releaseDelegationPayload.not_after,
    lifetime_seconds: C.maxReleaseDelegationLifetimeSeconds,
  },
  response_raw_base64url: encode(responseRaw),
  cases: {
    request: {
      unknown_field_raw_base64url: encode(unknownRequest),
      noncanonical_json_raw_base64url: encode(
        Buffer.concat([Buffer.from(" ", "utf8"), requestRaw]),
      ),
      reordered_keys_raw_base64url: encode(reorderedRequest),
      noncanonical_number_raw_base64url: encode(noncanonicalNumberRequest),
      padded_base64url_raw_base64url: encode(paddedRequest),
      malformed_base64url_raw_base64url: encode(malformedRequest),
    },
    response: responseCases,
    delegation: delegationCases,
    release_record: releaseRecordCases,
    uint64_overflow: overflow,
  },
};

const outputPath = fileURLToPath(
  new URL("./fixtures/freshness-v1-golden.json", import.meta.url),
);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(vector, null, 2)}\n`);
