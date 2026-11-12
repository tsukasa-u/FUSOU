import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import {
  createTlsnRuntimeConfigDelegatedEnvelopeRaw,
  createTlsnRuntimeConfigPublicationObjects,
  tlsnRuntimeConfigDelegatedSigningBytes,
  tlsnRuntimeConfigApprovedConfigurationSha256,
  verifyTlsnRuntimeConfigEpochPointer,
  verifyTlsnRuntimeConfigEnvelope,
  verifyTlsnRuntimeConfigManifestDelegation,
  verifyTlsnRuntimeConfigProductionEnvelope,
} from "./tlsn-runtime-config-manifest.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";
import { acquireAppWorkerReference } from "./app-worker-deployment-reference.mjs";
import {
  RuntimeConfigPointerConflictError,
  RuntimeConfigPointerIntegrityError,
} from "./tlsn-runtime-config-r2-store.mjs";
import { verifyTlsnRuntimeConfigIndependentInputs } from "./tlsn-runtime-config-independent-verification.mjs";
import { assertRuntimeConfigProductionSigningRegistered } from "./tlsn-runtime-config-production-registration.mjs";
import { isTestOnlyRuntimeConfigObjectStore } from "./tlsn-runtime-config-test-only-store.mjs";

function assertSignerProvider(signerProvider, delegation, expectedMode) {
  if (
    !signerProvider ||
    typeof signerProvider !== "object" ||
    typeof signerProvider.sign !== "function" ||
    signerProvider.mode !== expectedMode ||
    signerProvider.key_id !== delegation?.key_id ||
    signerProvider.public_key_spki !== delegation?.public_key_spki
  ) {
    throw new Error(
      `${expectedMode} Manifest child signer provider does not match the root delegation`,
    );
  }
}

function assertObjectStore(objectStore) {
  if (
    !objectStore ||
    typeof objectStore.getManifestState !== "function" ||
    typeof objectStore.putImmutable !== "function" ||
    typeof objectStore.getObject !== "function" ||
    typeof objectStore.compareAndSwapManifest !== "function"
  ) {
    throw new Error("Runtime Config object store must implement immutable writes, manifest snapshots, readback, and conditional pointer writes");
  }
}

function asBytes(value, label) {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`${label} readback must be bytes`);
  }
  return Buffer.from(value);
}

function stableWorkerReference(raw, label) {
  let reference;
  try {
    reference = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new Error(`${label} is not valid Worker reference JSON`);
  }
  if (
    !reference ||
    typeof reference !== "object" ||
    Array.isArray(reference) ||
    typeof reference.observed_at !== "string"
  ) {
    throw new Error(`${label} has an invalid observation identity`);
  }
  const identity = { ...reference };
  delete identity.observed_at;
  return canonicalJson(identity);
}

async function verifyCompetingManifestState(objectStore, state, {
  expectedManifestBytes,
  trustedSigner,
  policy,
}) {
  if (typeof state.etag !== "string" || state.etag.length === 0) {
    throw new RuntimeConfigPointerIntegrityError(
      "Runtime Config manifest pointer readback has no ETag",
    );
  }
  const rawManifest = asBytes(state.body, "Runtime Config manifest pointer");
  if (rawManifest.equals(expectedManifestBytes)) {
    return state.etag;
  }

  let payload;
  try {
    payload = verifyTlsnRuntimeConfigEnvelope(rawManifest, { trustedSigner, policy });
  } catch (cause) {
    throw new RuntimeConfigPointerIntegrityError(
      "Runtime Config manifest pointer changed to an envelope that is not valid under the configured signer and policy",
      { cause },
    );
  }

  const artifacts = [
    ["worker_reference_raw", "worker-reference", payload.source.worker_reference_sha256],
    ["origin_inventory_raw", "origin-inventory", payload.production_authority_pins.origin_inventory_sha256],
    ["target_approval_raw", "target-approval", payload.production_authority_pins.target_approval_artifact_sha256],
    ["security_registry_set_raw", "security-registry-set", payload.production_authority_pins.security_registry_set_sha256],
    ["result_registry_envelope_raw", "result-registry-envelope", payload.result_registry_pins.result_registry_envelope_sha256],
  ];
  const independentInputs = {};
  for (const [inputName, artifactName, digest] of artifacts) {
    const key = `tlsn/runtime-config/v2/artifacts/${artifactName}/${digest}`;
    const value = await objectStore.getObject(key);
    if (!(value instanceof Uint8Array)) {
      throw new RuntimeConfigPointerIntegrityError(
        `competing Runtime Config manifest references a missing ${artifactName} artifact`,
      );
    }
    independentInputs[inputName] = Buffer.from(value);
  }

  try {
    verifyTlsnRuntimeConfigProductionEnvelope(rawManifest, {
      trustedSigner,
      policy,
      independentInputs,
    });
  } catch (cause) {
    throw new RuntimeConfigPointerIntegrityError(
      "competing Runtime Config manifest or referenced artifacts failed verification",
      { cause },
    );
  }
  return null;
}

async function signTlsnRuntimeConfigManifestWithMode({
  prepared,
  signerProvider,
  trustedSigner,
  manifestAuthorityDelegationRaw,
  policy,
  independentInputs,
}, expectedMode) {
  if (
    !prepared ||
    typeof prepared.payload !== "object" ||
    typeof prepared.payload_base64url !== "string" ||
    Buffer.from(canonicalJson(prepared.payload), "utf8").toString("base64url") !==
      prepared.payload_base64url
  ) {
    throw new Error("prepared Runtime Config payload bytes are inconsistent");
  }
  if (
    !policy ||
    !Number.isSafeInteger(policy.now_ms) ||
    !Number.isSafeInteger(policy.max_clock_skew_seconds) ||
    typeof policy.manifest_url !== "string"
  ) {
    throw new Error("Manifest signing requires an explicit URL and verification time policy");
  }
  const manifestAuthority = verifyTlsnRuntimeConfigManifestDelegation({
    raw: manifestAuthorityDelegationRaw,
    trustedSigner,
    manifestUrl: policy.manifest_url,
    nowMs: policy.now_ms,
    maxClockSkewSeconds: policy.max_clock_skew_seconds,
    payload: prepared.payload,
  });
  assertSignerProvider(signerProvider, manifestAuthority.payload, expectedMode);
  const approvedConfigSha256 = tlsnRuntimeConfigApprovedConfigurationSha256(
    prepared.payload,
    policy.manifest_url,
  );
  if (approvedConfigSha256 !== manifestAuthority.payload.approved_config_sha256) {
    throw new Error("prepared Manifest is outside the root-approved configuration");
  }
  const issuedAt = Date.parse(prepared.payload.issued_at);
  const manifestNotBefore = Date.parse(prepared.payload.not_before);
  const manifestExpiresAt = Date.parse(prepared.payload.expires_at);
  if (
    issuedAt < manifestAuthority.notBeforeMs ||
    issuedAt >= manifestAuthority.notAfterMs ||
    manifestNotBefore < manifestAuthority.notBeforeMs ||
    manifestExpiresAt > manifestAuthority.notAfterMs
  ) {
    throw new Error("prepared Manifest validity exceeds the root delegation");
  }
  verifyTlsnRuntimeConfigIndependentInputs(
    prepared.payload,
    independentInputs,
    policy.now_ms,
  );

  const bytesToSign = tlsnRuntimeConfigDelegatedSigningBytes(
    signerProvider.key_id,
    prepared.payload,
    new Date(policy.now_ms),
  );
  const signature = await signerProvider.sign(Buffer.from(bytesToSign));
  if (!(signature instanceof Uint8Array) || signature.byteLength !== 64) {
    throw new Error("Runtime Config signer returned an invalid Ed25519 signature");
  }
  const rawEnvelope = createTlsnRuntimeConfigDelegatedEnvelopeRaw({
    signerKeyId: signerProvider.key_id,
    payloadBase64Url: prepared.payload_base64url,
    signatureBase64Url: Buffer.from(signature).toString("base64url"),
    manifestAuthorityDelegationRaw,
  });
  const verification = verifyTlsnRuntimeConfigProductionEnvelope(rawEnvelope, {
    trustedSigner,
    policy,
    independentInputs,
  });
  return Object.freeze({ raw_envelope: rawEnvelope, verification });
}

export async function signTlsnRuntimeConfigManifest(options) {
  assertRuntimeConfigProductionSigningRegistered();
  return signTlsnRuntimeConfigManifestWithMode(options, "production");
}

export async function signTlsnRuntimeConfigManifestForTest(options) {
  return signTlsnRuntimeConfigManifestWithMode(options, "test-only");
}

async function publishTlsnRuntimeConfigWithMode({
  prepared,
  signerProvider,
  trustedSigner,
  manifestAuthorityDelegationRaw,
  policy,
  independentInputs,
  workerReferenceRevalidation,
  objectStore,
}, { signManifest, resultState }) {
  assertObjectStore(objectStore);
  const { raw_envelope: rawEnvelope, verification: signedVerification } = await signManifest({
      prepared,
      signerProvider,
      trustedSigner,
      manifestAuthorityDelegationRaw,
      policy,
      independentInputs,
    });
  const objects = createTlsnRuntimeConfigPublicationObjects(rawEnvelope, {
    trustedSigner,
    policy,
    independentInputs,
  });
  const manifest = objects.at(-1);
  const expectedManifestBytes = Buffer.from(manifest.body);
  const nextEpoch = BigInt(signedVerification.payload.epoch);
  const nextAuthorityGeneration = BigInt(
    signedVerification.manifest_authority_generation ?? "0",
  );
  const nextAuthorityDigest =
    signedVerification.manifest_authority_delegation_sha256;
  const initialPointer = await objectStore.getManifestState();
  if (initialPointer !== null) {
    asBytes(initialPointer?.body, "current Runtime Config manifest");
    if (typeof initialPointer.etag !== "string" || !initialPointer.etag) {
      throw new Error("current Runtime Config manifest pointer ETag is invalid");
    }
  }
  const expectedETag = initialPointer?.etag ?? null;
  if (expectedETag !== null && (typeof expectedETag !== "string" || !expectedETag)) {
    throw new Error("Runtime Config manifest pointer ETag is invalid");
  }
  const policyEpoch = BigInt(policy.last_accepted_epoch);
  if (initialPointer === null) {
    if (policyEpoch !== 0n) {
      throw new Error("server Runtime Config manifest pointer is missing despite a nonzero epoch high-water");
    }
    if (nextEpoch <= policyEpoch) {
      throw new Error("initial Runtime Config manifest must advance the server epoch high-water");
    }
  } else {
    const currentPointer = verifyTlsnRuntimeConfigEpochPointer(initialPointer.body, {
      trustedSigner,
      maxEnvelopeBytes: policy.max_envelope_bytes,
      manifestUrl: policy.manifest_url,
      nowMs: policy.now_ms,
      maxClockSkewSeconds: policy.max_clock_skew_seconds,
      lastAcceptedEpoch: policy.last_accepted_epoch,
      lastAcceptedManifestSha256: policy.last_accepted_manifest_sha256,
      lastAcceptedManifestAuthorityGeneration:
        policy.last_accepted_manifest_authority_generation,
      lastAcceptedManifestAuthorityDelegationSha256:
        policy.last_accepted_manifest_authority_delegation_sha256,
    });
    const currentEpoch = BigInt(currentPointer.epoch);
    const currentAuthorityGeneration = BigInt(
      currentPointer.manifest_authority_generation ?? "0",
    );
    if (
      currentEpoch < policyEpoch ||
      (currentEpoch === policyEpoch &&
        policy.last_accepted_manifest_sha256 !== currentPointer.manifest_sha256)
    ) {
      throw new Error("server Runtime Config manifest pointer is behind the configured epoch high-water");
    }
    if (
      nextEpoch < currentEpoch ||
      (nextEpoch === currentEpoch &&
        createHash("sha256").update(expectedManifestBytes).digest("base64url") !==
          currentPointer.manifest_sha256)
    ) {
      throw new Error("Runtime Config publication cannot roll back or replace the current epoch");
    }
    if (
      nextAuthorityGeneration < currentAuthorityGeneration ||
      (nextAuthorityGeneration === currentAuthorityGeneration &&
        nextAuthorityDigest !== currentPointer.manifest_authority_delegation_sha256)
    ) {
      throw new Error("Runtime Config publication cannot roll back or replace the Manifest authority");
    }
  }

  for (const object of objects.slice(0, -1)) {
    const expectedBody = Buffer.from(object.body);
    await objectStore.putImmutable({
      ...object,
      body: Buffer.from(expectedBody),
    });
    const actualBody = asBytes(
      await objectStore.getObject(object.key),
      "immutable Runtime Config publication object",
    );
    if (!actualBody.equals(expectedBody)) {
      throw new Error(`immutable Runtime Config publication readback mismatch: ${object.key}`);
    }
  }

  if (
    !workerReferenceRevalidation ||
    typeof workerReferenceRevalidation !== "object" ||
    !workerReferenceRevalidation.environment ||
    !workerReferenceRevalidation.provenance ||
    !workerReferenceRevalidation.publicManifest
  ) {
    throw new Error("fresh approved Worker release inputs are required before manifest publication");
  }
  const latestReference = await acquireAppWorkerReference(workerReferenceRevalidation);
  const latestReferenceRaw = Buffer.from(`${JSON.stringify(latestReference, null, 2)}\n`);
  if (
    stableWorkerReference(latestReferenceRaw, "fresh Worker reference") !==
    stableWorkerReference(independentInputs.worker_reference_raw, "approved Worker reference")
  ) {
    throw new Error("active Worker deployment or endpoint mapping changed before manifest publication");
  }

  let committedETag;
  try {
    committedETag = await objectStore.compareAndSwapManifest(expectedETag, {
      ...manifest,
      body: Buffer.from(expectedManifestBytes),
    });
  } catch (error) {
    if (!(error instanceof RuntimeConfigPointerConflictError)) throw error;
    const currentPointer = await objectStore.getManifestState();
    if (!currentPointer) throw error;
    const reconciledETag = await verifyCompetingManifestState(objectStore, currentPointer, {
      expectedManifestBytes,
      trustedSigner,
      policy,
    });
    if (!reconciledETag) {
      throw new RuntimeConfigPointerConflictError(
        "a different fully verified Runtime Config release won the manifest pointer race",
        { cause: error },
      );
    }
    committedETag = reconciledETag;
  }
  if (typeof committedETag !== "string" || !committedETag) {
    throw new Error("Runtime Config manifest CAS did not return the committed ETag");
  }
  const finalPointer = await objectStore.getManifestState();
  if (!finalPointer) {
    throw new RuntimeConfigPointerConflictError(
      "Runtime Config manifest pointer disappeared after conditional publication",
    );
  }
  const publishedManifest = asBytes(finalPointer.body, "Runtime Config manifest");
  if (
    finalPointer.etag !== committedETag ||
    !publishedManifest.equals(expectedManifestBytes)
  ) {
    const reconciledETag = await verifyCompetingManifestState(objectStore, finalPointer, {
      expectedManifestBytes,
      trustedSigner,
      policy,
    });
    if (!reconciledETag || reconciledETag !== committedETag) {
      throw new RuntimeConfigPointerConflictError(
        "Runtime Config manifest pointer changed after conditional publication",
      );
    }
  }
  const readbackVerification = verifyTlsnRuntimeConfigProductionEnvelope(publishedManifest, {
    trustedSigner,
    policy,
    independentInputs,
  });

  return Object.freeze({
    state: resultState,
    manifest_sha256: createHash("sha256").update(expectedManifestBytes).digest("base64url"),
    object_keys: Object.freeze(objects.map(({ key }) => key)),
    verification: readbackVerification,
  });
}

export async function publishTlsnRuntimeConfig(options) {
  assertRuntimeConfigProductionSigningRegistered();
  if (isTestOnlyRuntimeConfigObjectStore(options?.objectStore)) {
    throw new Error("Production Runtime Config publisher cannot use a test-only object store");
  }
  return publishTlsnRuntimeConfigWithMode(options, {
    signManifest: signTlsnRuntimeConfigManifest,
    resultState: "PUBLISHED_TO_OBJECT_STORE",
  });
}

export async function publishTlsnRuntimeConfigForTest(options) {
  if (!isTestOnlyRuntimeConfigObjectStore(options?.objectStore)) {
    throw new Error("test-only Runtime Config publication requires an in-memory test-only object store");
  }
  return publishTlsnRuntimeConfigWithMode(options, {
    signManifest: signTlsnRuntimeConfigManifestForTest,
    resultState: "TEST_ONLY_PUBLISHED_TO_FAKE_STORE",
  });
}
