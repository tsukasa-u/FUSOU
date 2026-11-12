#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { canonicalJson } from "./production-trust-contract.mjs";
import {
  createTlsnRuntimeConfigDelegatedEnvelopeRaw,
  tlsnRuntimeConfigApprovedConfigurationSha256,
  tlsnRuntimeConfigDelegatedSigningBytes,
} from "./tlsn-runtime-config-manifest.mjs";

const sourcePath = new URL(
  "./fixtures/tlsn-runtime-config-independent-v2-vector.json",
  import.meta.url,
);
const targetPath = new URL(
  "./fixtures/tlsn-runtime-config-manifest-delegation-v1-golden.json",
  import.meta.url,
);
const manifestDelegationDomain = Buffer.from(
  "FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-DELEGATION-V1\0",
  "ascii",
);
const delegatedManifestDomain = Buffer.from(
  "FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V3\0",
  "ascii",
);
const manifestUrl = "https://runtime-config.example.com/tlsn/runtime-config/v2/manifest.json";
const rootKeyId = "manifest-golden-root";
const childKeyId = "manifest-golden-child";

function testOnlyKeyPair(label) {
  const seed = createHash("sha256").update(`FUSOU test-only ${label} v1`).digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed,
    ]),
    format: "der",
    type: "pkcs8",
  });
  return {
    privateKey,
    publicKey: createPublicKey(privateKey),
  };
}

function signatureBytes(domain, keyId, payloadBytes) {
  const keyIdBytes = Buffer.from(keyId, "ascii");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(keyIdBytes.length);
  return Buffer.concat([domain, length, keyIdBytes, payloadBytes]);
}

function signDelegation(payload, root) {
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  const signature = sign(
    null,
    signatureBytes(manifestDelegationDomain, rootKeyId, payloadBytes),
    root.privateKey,
  );
  return Buffer.from(canonicalJson({
    schema_version: 1,
    scope: "fusou-tlsn-runtime-config-manifest-delegation-v1",
    signature_algorithm: "Ed25519",
    root_key_id: rootKeyId,
    payload_base64url: payloadBytes.toString("base64url"),
    signature_base64url: signature.toString("base64url"),
  }));
}

function envelopeWithDelegation(payload, delegationRaw, child) {
  const policyNowMs = source.policy.now_ms;
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  const signature = sign(
    null,
    tlsnRuntimeConfigDelegatedSigningBytes(
      childKeyId,
      payload,
      new Date(policyNowMs),
    ),
    child.privateKey,
  );
  return createTlsnRuntimeConfigDelegatedEnvelopeRaw({
    signerKeyId: childKeyId,
    payloadBase64Url: payloadBytes.toString("base64url"),
    signatureBase64Url: signature.toString("base64url"),
    manifestAuthorityDelegationRaw: delegationRaw,
  });
}

function envelopeWithUncheckedPayload(payload, delegationRaw, child) {
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  const signature = sign(
    null,
    signatureBytes(delegatedManifestDomain, childKeyId, payloadBytes),
    child.privateKey,
  );
  return createTlsnRuntimeConfigDelegatedEnvelopeRaw({
    signerKeyId: childKeyId,
    payloadBase64Url: payloadBytes.toString("base64url"),
    signatureBase64Url: signature.toString("base64url"),
    manifestAuthorityDelegationRaw: delegationRaw,
  });
}

function outerEnvelopeWith(rawEnvelope, mutate) {
  const envelope = JSON.parse(rawEnvelope.toString("utf8"));
  mutate(envelope);
  return Buffer.from(canonicalJson(envelope), "utf8");
}

function changedSignature(signatureBase64Url) {
  const signature = Buffer.from(signatureBase64Url, "base64url");
  signature[0] ^= 1;
  return signature.toString("base64url");
}

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const sourceEnvelope = JSON.parse(source.manifest_envelope_utf8);
const payload = JSON.parse(
  Buffer.from(sourceEnvelope.payload_base64url, "base64url").toString("utf8"),
);
const nowMs = source.policy.now_ms;
const root = testOnlyKeyPair("Manifest delegation root");
const child = testOnlyKeyPair("Manifest delegation child");
const trustedSigner = {
  scope: "fusou-tlsn-runtime-config-signing-root-v2",
  key_id: rootKeyId,
  public_key_spki: root.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64url"),
};
const childPublicKeySpki = child.publicKey
  .export({ format: "der", type: "spki" })
  .toString("base64url");
const issuedAt = new Date(Date.parse(payload.issued_at)).toISOString();
const delegationPayload = {
  schema_version: 1,
  scope: "fusou-tlsn-runtime-config-manifest-delegation-v1",
  purpose: "runtime-config-manifest-v1",
  environment: "production",
  key_id: childKeyId,
  public_key_spki: childPublicKeySpki,
  signature_algorithm: "Ed25519",
  audience_manifest_url_sha256: createHash("sha256")
    .update(manifestUrl, "utf8")
    .digest("base64url"),
  manifest_envelope_schema_version: 3,
  manifest_payload_schema_version: 2,
  approved_config_sha256: tlsnRuntimeConfigApprovedConfigurationSha256(
    payload,
    manifestUrl,
  ),
  delegation_generation: "1",
  issued_at: issuedAt,
  not_before: issuedAt,
  not_after: new Date(Date.parse(issuedAt) + 86_400_000).toISOString(),
  max_validity_seconds: 86_400,
  revocation_mode: "expiry-and-client-high-water-v1",
};
const delegationRaw = signDelegation(delegationPayload, root);
const validEnvelope = envelopeWithDelegation(payload, delegationRaw, child);
const generationFourDelegationPayload = {
  ...delegationPayload,
  delegation_generation: "4",
};
const generationFourDelegationRaw = signDelegation(generationFourDelegationPayload, root);
const generationFourEnvelope = envelopeWithDelegation(
  payload,
  generationFourDelegationRaw,
  child,
);
const delegationDigest = createHash("sha256").update(delegationRaw).digest("base64url");
const updatedWorkerObservedAt = new Date(nowMs - 30_000).toISOString();
const updatedWorkerReferenceRaw = Buffer.from(
  canonicalJson({
    ...JSON.parse(Buffer.from(
      source.inputs_base64url.worker_reference_raw,
      "base64url",
    ).toString("utf8")),
    observed_at: updatedWorkerObservedAt,
  }),
  "utf8",
);
const updatedPayload = {
  ...payload,
  epoch: (BigInt(payload.epoch) + 1n).toString(10),
  issued_at: new Date(nowMs).toISOString(),
  not_before: new Date(nowMs).toISOString(),
  expires_at: new Date(nowMs + 3_600_000).toISOString(),
  source: {
    ...payload.source,
    worker_reference_sha256: createHash("sha256")
      .update(updatedWorkerReferenceRaw)
      .digest("base64url"),
    observed_at: updatedWorkerObservedAt,
  },
};
const updatedEnvelope = envelopeWithDelegation(updatedPayload, delegationRaw, child);
const updatedEnvelopeDigest = createHash("sha256")
  .update(updatedEnvelope)
  .digest("base64url");
const boundaryNotAfter = new Date(Date.parse(issuedAt) + 500_000).toISOString();
const boundaryDelegationPayload = {
  ...delegationPayload,
  delegation_generation: "5",
  not_after: boundaryNotAfter,
};
const boundaryDelegationRaw = signDelegation(boundaryDelegationPayload, root);
const boundaryManifestPayload = {
  ...payload,
  expires_at: boundaryNotAfter,
};
const boundaryEnvelope = envelopeWithDelegation(
  boundaryManifestPayload,
  boundaryDelegationRaw,
  child,
);
const parseDelegation = (raw) => {
  const envelope = JSON.parse(raw.toString("utf8"));
  return JSON.parse(Buffer.from(envelope.payload_base64url, "base64url").toString("utf8"));
};
const rewriteDelegation = (rawEnvelope, mutatePayload) => {
  const envelope = JSON.parse(rawEnvelope.toString("utf8"));
  const currentDelegation = Buffer.from(
    envelope.manifest_authority_delegation_base64url,
    "base64url",
  );
  const nextPayload = mutatePayload(parseDelegation(currentDelegation));
  const nextDelegation = signDelegation(nextPayload, root);
  return outerEnvelopeWith(rawEnvelope, (nextEnvelope) => {
    nextEnvelope.manifest_authority_delegation_base64url =
      nextDelegation.toString("base64url");
  });
};
const resignPayload = (rawEnvelope, mutatePayload) => {
  const envelope = JSON.parse(rawEnvelope.toString("utf8"));
  const changedPayload = mutatePayload(JSON.parse(
    Buffer.from(envelope.payload_base64url, "base64url").toString("utf8"),
  ));
  return envelopeWithDelegation(
    changedPayload,
    Buffer.from(envelope.manifest_authority_delegation_base64url, "base64url"),
    child,
  );
};
const policy = {
  ...source.policy,
  manifest_url: manifestUrl,
  last_accepted_manifest_authority_generation: "0",
  last_accepted_manifest_authority_delegation_sha256: null,
};
const cases = [
  {
    name: "delegated-root-and-child-signatures-valid",
    expected_accept: true,
    expected_authority_generation: "1",
    manifest_envelope_base64url: Buffer.from(validEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "child-signature-tampered",
    expected_accept: false,
    manifest_envelope_base64url: outerEnvelopeWith(validEnvelope, (envelope) => {
      envelope.signature_base64url = changedSignature(envelope.signature_base64url);
    }).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "root-delegation-signature-tampered",
    expected_accept: false,
    manifest_envelope_base64url: outerEnvelopeWith(validEnvelope, (envelope) => {
      const raw = Buffer.from(envelope.manifest_authority_delegation_base64url, "base64url");
      const delegation = JSON.parse(raw.toString("utf8"));
      delegation.signature_base64url = changedSignature(delegation.signature_base64url);
      envelope.manifest_authority_delegation_base64url =
        Buffer.from(canonicalJson(delegation), "utf8").toString("base64url");
    }).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "approved-worker-identity-changed-after-child-resigning",
    expected_accept: false,
    manifest_envelope_base64url: Buffer.from(resignPayload(
      validEnvelope,
      (changed) => {
        changed.compile_inputs.FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID = "session-tampered";
        return changed;
      },
    )).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "wrong-manifest-audience",
    expected_accept: false,
    manifest_envelope_base64url: Buffer.from(validEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {
      manifest_url: "https://other.example.com/tlsn/runtime-config/v2/manifest.json",
    },
  },
  {
    name: "delegation-purpose-changed-under-root-signature",
    expected_accept: false,
    manifest_envelope_base64url: rewriteDelegation(validEnvelope, (delegation) => ({
      ...delegation,
      purpose: "runtime-config-release-v1",
    })).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "unknown-delegation-field-under-root-signature",
    expected_accept: false,
    manifest_envelope_base64url: rewriteDelegation(validEnvelope, (delegation) => ({
      ...delegation,
      unknown_field: "must-not-be-ignored",
    })).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "delegation-expired-at-verification",
    expected_accept: false,
    manifest_envelope_base64url: Buffer.from(validEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {
      now_ms: Date.parse(delegationPayload.not_after) + 31_000,
    },
  },
  {
    name: "delegation-generation-below-high-water",
    expected_accept: false,
    manifest_envelope_base64url: Buffer.from(validEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {
      last_accepted_manifest_authority_generation: "2",
      last_accepted_manifest_authority_delegation_sha256: "A".repeat(43),
    },
  },
  {
    name: "same-generation-same-delegation-is-accepted",
    expected_accept: true,
    expected_authority_generation: "1",
    manifest_envelope_base64url: Buffer.from(validEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {
      last_accepted_manifest_authority_generation: "1",
      last_accepted_manifest_authority_delegation_sha256: delegationDigest,
    },
  },
  {
    name: "same-generation-different-delegation-is-rejected",
    expected_accept: false,
    manifest_envelope_base64url: Buffer.from(validEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {
      last_accepted_manifest_authority_generation: "1",
      last_accepted_manifest_authority_delegation_sha256: "C".repeat(43),
    },
  },
  {
    name: "same-epoch-exact-manifest-bytes-remain-accepted",
    expected_accept: true,
    expected_authority_generation: "1",
    manifest_envelope_base64url: Buffer.from(validEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {
      last_accepted_epoch: payload.epoch,
      last_accepted_manifest_sha256: createHash("sha256")
        .update(validEnvelope)
        .digest("base64url"),
      last_accepted_manifest_authority_generation: "1",
      last_accepted_manifest_authority_delegation_sha256: delegationDigest,
    },
  },
  {
    name: "same-epoch-different-manifest-bytes-are-rejected",
    expected_accept: false,
    manifest_envelope_base64url: Buffer.from(validEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {
      last_accepted_epoch: payload.epoch,
      last_accepted_manifest_sha256: "D".repeat(43),
      last_accepted_manifest_authority_generation: "1",
      last_accepted_manifest_authority_delegation_sha256: delegationDigest,
    },
  },
  {
    name: "manifest-epoch-rollback-is-rejected",
    expected_accept: false,
    manifest_envelope_base64url: Buffer.from(validEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {
      last_accepted_epoch: updatedPayload.epoch,
      last_accepted_manifest_sha256: updatedEnvelopeDigest,
      last_accepted_manifest_authority_generation: "1",
      last_accepted_manifest_authority_delegation_sha256: delegationDigest,
    },
  },
  {
    name: "approved-observation-and-time-refresh-remains-in-root-approved-config",
    expected_accept: true,
    expected_authority_generation: "1",
    expected_epoch: updatedPayload.epoch,
    manifest_envelope_base64url: Buffer.from(updatedEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    inputs_base64url: {
      worker_reference_raw: updatedWorkerReferenceRaw.toString("base64url"),
    },
    policy_overrides: {
      last_accepted_epoch: payload.epoch,
      last_accepted_manifest_sha256: createHash("sha256")
        .update(validEnvelope)
        .digest("base64url"),
      last_accepted_manifest_authority_generation: "1",
      last_accepted_manifest_authority_delegation_sha256: delegationDigest,
    },
  },
  {
    name: "higher-generation-gap-is-accepted",
    expected_accept: true,
    expected_authority_generation: "4",
    manifest_envelope_base64url: Buffer.from(generationFourEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {
      last_accepted_manifest_authority_generation: "1",
      last_accepted_manifest_authority_delegation_sha256: delegationDigest,
    },
  },
  {
    name: "wrong-delegation-environment",
    expected_accept: false,
    manifest_envelope_base64url: rewriteDelegation(validEnvelope, (delegation) => ({
      ...delegation,
      environment: "staging",
    })).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "wrong-manifest-schema-binding",
    expected_accept: false,
    manifest_envelope_base64url: rewriteDelegation(validEnvelope, (delegation) => ({
      ...delegation,
      manifest_payload_schema_version: 3,
    })).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "wrong-delegated-child-key-id",
    expected_accept: false,
    manifest_envelope_base64url: rewriteDelegation(validEnvelope, (delegation) => ({
      ...delegation,
      key_id: "different-child-key",
    })).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "delegated-child-public-key-mismatch",
    expected_accept: false,
    manifest_envelope_base64url: rewriteDelegation(validEnvelope, (delegation) => ({
      ...delegation,
      public_key_spki: trustedSigner.public_key_spki,
    })).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "wrong-bootstrap-root-key",
    expected_accept: false,
    manifest_envelope_base64url: Buffer.from(validEnvelope).toString("base64url"),
    trusted_signer: {
      ...trustedSigner,
      key_id: "manifest-golden-root",
      public_key_spki: childPublicKeySpki,
    },
    policy_overrides: {},
  },
  {
    name: "delegation-validity-exceeds-root-maximum",
    expected_accept: false,
    manifest_envelope_base64url: rewriteDelegation(validEnvelope, (delegation) => ({
      ...delegation,
      not_after: new Date(Date.parse(delegation.issued_at) + 86_401_000).toISOString(),
    })).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "delegation-expiry-before-skew-boundary-is-accepted",
    expected_accept: true,
    expected_authority_generation: "5",
    manifest_envelope_base64url: Buffer.from(boundaryEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {
      now_ms: Date.parse(boundaryNotAfter) + 29_999,
    },
  },
  {
    name: "delegation-expiry-at-skew-boundary-is-rejected",
    expected_accept: false,
    manifest_envelope_base64url: Buffer.from(boundaryEnvelope).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {
      now_ms: Date.parse(boundaryNotAfter) + 30_000,
    },
  },
  {
    name: "future-not-before-does-not-extend-authority",
    expected_accept: false,
    manifest_envelope_base64url: rewriteDelegation(validEnvelope, (delegation) => ({
      ...delegation,
      not_before: new Date(Date.parse(delegation.issued_at) + 60_000).toISOString(),
    })).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "future-root-issued-at-is-rejected",
    expected_accept: false,
    manifest_envelope_base64url: rewriteDelegation(validEnvelope, (delegation) => {
      const futureIssuedAt = new Date(Date.parse(delegation.issued_at) + 60_000).toISOString();
      return {
        ...delegation,
        issued_at: futureIssuedAt,
        not_before: futureIssuedAt,
        not_after: new Date(Date.parse(futureIssuedAt) + 86_400_000).toISOString(),
      };
    }).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "unknown-envelope-field-is-rejected",
    expected_accept: false,
    manifest_envelope_base64url: outerEnvelopeWith(validEnvelope, (envelope) => {
      envelope.unknown_field = "must-not-be-ignored";
    }).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "unknown-payload-field-is-rejected-after-child-resigning",
    expected_accept: false,
    manifest_envelope_base64url: Buffer.from(envelopeWithUncheckedPayload(
      {
        ...payload,
        unknown_field: "must-not-be-ignored",
      },
      delegationRaw,
      child,
    )).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "noncanonical-envelope-bytes-are-rejected",
    expected_accept: false,
    manifest_envelope_base64url: Buffer.concat([
      Buffer.from(" \n", "ascii"),
      Buffer.from(validEnvelope),
    ]).toString("base64url"),
    trusted_signer: trustedSigner,
    policy_overrides: {},
  },
  {
    name: "legacy-v2-downgrade-after-delegated-high-water",
    expected_accept: false,
    manifest_envelope_base64url: Buffer.from(source.manifest_envelope_utf8)
      .toString("base64url"),
    trusted_signer: source.trusted_signer,
    policy_overrides: {
      last_accepted_manifest_authority_generation: "1",
      last_accepted_manifest_authority_delegation_sha256: "B".repeat(43),
    },
  },
];

const vector = {
  schema_version: 1,
  test_only: true,
  manifest_url: manifestUrl,
  trusted_signer: trustedSigner,
  policy,
  inputs_base64url: source.inputs_base64url,
  vectors: cases,
};
const generated = `${JSON.stringify(vector, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const existing = await readFile(targetPath, "utf8");
  if (existing !== generated) {
    throw new Error("Manifest delegation golden vectors are stale; regenerate the fixture");
  }
} else {
  await writeFile(targetPath, generated);
}
