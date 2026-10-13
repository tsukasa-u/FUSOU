import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import {
  createTlsnRuntimeConfigEnvelopeRaw,
  createTlsnRuntimeConfigPublicationObjects,
  tlsnRuntimeConfigSigningBytes,
  verifyTlsnRuntimeConfigProductionEnvelope,
} from "./tlsn-runtime-config-manifest.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";
import { acquireAppWorkerReference } from "./app-worker-deployment-reference.mjs";

function assertSignerProvider(signerProvider, trustedSigner) {
  if (
    !signerProvider ||
    typeof signerProvider !== "object" ||
    typeof signerProvider.sign !== "function" ||
    signerProvider.key_id !== trustedSigner?.key_id ||
    signerProvider.public_key_spki !== trustedSigner?.public_key_spki
  ) {
    throw new Error("manifest signer provider does not match the independent signer pin");
  }
}

function assertObjectStore(objectStore) {
  if (
    !objectStore ||
    typeof objectStore.getManifestETag !== "function" ||
    typeof objectStore.putImmutable !== "function" ||
    typeof objectStore.getObject !== "function" ||
    typeof objectStore.compareAndSwapManifest !== "function"
  ) {
    throw new Error("Runtime Config object store must implement immutable writes, readback, and atomic manifest CAS");
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

export async function signTlsnRuntimeConfigManifest({
  prepared,
  signerProvider,
  trustedSigner,
  policy,
  independentInputs,
}) {
  assertSignerProvider(signerProvider, trustedSigner);
  if (
    !prepared ||
    typeof prepared.payload !== "object" ||
    typeof prepared.payload_base64url !== "string" ||
    Buffer.from(canonicalJson(prepared.payload), "utf8").toString("base64url") !==
      prepared.payload_base64url
  ) {
    throw new Error("prepared Runtime Config payload bytes are inconsistent");
  }

  const bytesToSign = tlsnRuntimeConfigSigningBytes(trustedSigner.key_id, prepared.payload);
  const signature = await signerProvider.sign(Buffer.from(bytesToSign));
  if (!(signature instanceof Uint8Array) || signature.byteLength !== 64) {
    throw new Error("Runtime Config signer returned an invalid Ed25519 signature");
  }
  const rawEnvelope = createTlsnRuntimeConfigEnvelopeRaw({
    signerKeyId: trustedSigner.key_id,
    payloadBase64Url: prepared.payload_base64url,
    signatureBase64Url: Buffer.from(signature).toString("base64url"),
  });
  const verification = verifyTlsnRuntimeConfigProductionEnvelope(rawEnvelope, {
    trustedSigner,
    policy,
    independentInputs,
  });
  return Object.freeze({ raw_envelope: rawEnvelope, verification });
}

export async function publishTlsnRuntimeConfig({
  prepared,
  signerProvider,
  trustedSigner,
  policy,
  independentInputs,
  workerReferenceRevalidation,
  objectStore,
}) {
  assertObjectStore(objectStore);
  const { raw_envelope: rawEnvelope, verification } =
    await signTlsnRuntimeConfigManifest({
      prepared,
      signerProvider,
      trustedSigner,
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
  const expectedETag = await objectStore.getManifestETag();
  if (expectedETag !== null && (typeof expectedETag !== "string" || !expectedETag)) {
    throw new Error("Runtime Config manifest pointer ETag is invalid");
  }

  for (const object of objects.slice(0, -1)) {
    const expectedBody = Buffer.from(object.body);
    await objectStore.putImmutable({
      ...object,
      body: Buffer.from(expectedBody),
    });
    const actualBody = asBytes(
      await objectStore.getObject(object.key),
      "immutable Runtime Config artifact",
    );
    if (!actualBody.equals(expectedBody)) {
      throw new Error(`immutable Runtime Config artifact readback mismatch: ${object.key}`);
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

  const committedETag = await objectStore.compareAndSwapManifest(expectedETag, {
    ...manifest,
    body: Buffer.from(expectedManifestBytes),
  });
  if (typeof committedETag !== "string" || !committedETag) {
    throw new Error("Runtime Config manifest CAS did not return the committed ETag");
  }
  const publishedManifest = asBytes(
    await objectStore.getObject(manifest.key),
    "Runtime Config manifest",
  );
  if (!publishedManifest.equals(expectedManifestBytes)) {
    throw new Error("Runtime Config manifest pointer readback mismatch after CAS");
  }
  if (await objectStore.getManifestETag() !== committedETag) {
    throw new Error("Runtime Config manifest pointer changed after CAS readback");
  }

  return Object.freeze({
    state: "PUBLISHED_TO_OBJECT_STORE",
    manifest_sha256: createHash("sha256").update(expectedManifestBytes).digest("base64url"),
    object_keys: Object.freeze(objects.map(({ key }) => key)),
    verification,
  });
}
