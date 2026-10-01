import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  consumeReceiptSigningBytes,
  sessionReceiptSigningBytes,
  tlsnDeviceProofSigningBytes,
} from "./device-evidence.mjs";
import {
  canaryVerifierIdentityKeyRegistrySha256,
  CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE,
  CANARY_VERIFIER_WORKER_NAME,
  createCanaryVerifierExecutionReceipt,
} from "./canary-verifier-identity.mjs";
import { canonicalJson } from "./deployment-attestation.mjs";
import { resultSigningBytes } from "./production-evidence.mjs";
import { createSignedResultRegistryEnvelope } from "./result-registry-envelope.mjs";
import { verifyProductionPresentation } from "./production-evidence-semantic.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const USER_ID = "a73fded7-d9af-4f0a-b87b-c626d30d55bd";
const DEVICE_ID = "b73fded7-d9af-4f0a-b87b-c626d30d55bd";
const JOB_ID = "f73fded7-d9af-4f0a-b87b-c626d30d55bd";
const ATTEMPT_ID = "5f289198-7361-4a92-9d03-c4e506385130";
const NOW = new Date();
const atOffset = (milliseconds) => new Date(NOW.getTime() + milliseconds).toISOString();
const CAPTURED_AT = atOffset(-10 * 60 * 1000);
const EXPIRES_AT = atOffset(20 * 60 * 1000);
const ISSUED_AT = atOffset(-5 * 60 * 1000);
const PROFILE_SHA256 = Buffer.alloc(32, 0x31).toString("base64url");
const NOTARY_KEY_ID = "synthetic-notary-key";
const VERIFIER_KEY_ID = "synthetic-verifier-key";
const RESULT_KEY_ID = "synthetic-result-key";
const RESULT_ROOT_KEY_ID = "synthetic-result-root";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("base64url");
const jsonBytes = (value) => Buffer.from(JSON.stringify(value), "utf8");
const keyPair = () => generateKeyPairSync("ed25519");
const publicSpki = (key) => key.export({ format: "der", type: "spki" }).toString("base64url");
const privatePkcs8 = (key) => key.export({ format: "der", type: "pkcs8" }).toString("base64url");

function bindingValue() {
  const session = Buffer.from(SESSION_ID.replaceAll("-", ""), "hex");
  return Buffer.concat([
    Buffer.from("FUSOU-ATTESTATION-BINDING-V1\0"),
    Buffer.from([0, 16]),
    session,
    Buffer.from([0, 32]),
    Buffer.alloc(32, 0x42),
  ]).toString("base64url");
}

function authority(scope, signerKeyId, publicKey) {
  const keySpki = publicSpki(publicKey);
  return {
    publicKeySpki: keySpki,
    signerKeyId,
    keyRegistry: {
      schema_version: 1,
      scope,
      keys: [{
        key_id: signerKeyId,
        public_key_spki: keySpki,
        status: "ACTIVE",
        not_before: "2026-01-01T00:00:00.000Z",
        not_after: null,
      }],
    },
  };
}

function signedResultAuthority() {
  const signer = keyPair();
  const root = keyPair();
  const publicKeySpki = publicSpki(signer.publicKey);
  const rootPublicKeySpki = publicSpki(root.publicKey);
  const keyRegistry = {
    schema_version: 1,
    scope: "tlsn-result-signing-key-registry",
    keys: [{
      key_id: RESULT_KEY_ID,
      public_key_spki: publicKeySpki,
      status: "ACTIVE",
      not_before: "2026-01-01T00:00:00.000Z",
      not_after: null,
    }],
  };
  const keyRegistryRawBytes = jsonBytes(keyRegistry);
  const registryEnvelope = createSignedResultRegistryEnvelope({
    registry: keyRegistry,
    registryRaw: keyRegistryRawBytes,
    rootKeyId: RESULT_ROOT_KEY_ID,
    rootPublicKeySpki,
    rootPrivateKeyPkcs8: privatePkcs8(root.privateKey),
  });
  const registryEnvelopeRawBytes = jsonBytes(registryEnvelope);
  return {
    signer,
    authority: {
      publicKeySpki,
      signerKeyId: RESULT_KEY_ID,
      keyRegistry,
      keyRegistryRawBytes,
      registryEnvelope,
      registryEnvelopeRawBytes,
      trustedRootKeyId: RESULT_ROOT_KEY_ID,
      trustedRootPublicKeySpki: rootPublicKeySpki,
    },
  };
}

function verifierRuntime() {
  const verifier = keyPair();
  const verifierPublicKeySpki = publicSpki(verifier.publicKey);
  const deploymentId = "synthetic-canary-verifier-deployment";
  const runtimeVersionId = "4b064508-1cdb-453c-826b-bdea36a8b1e5";
  const verifierIdentityKeyRegistry = {
    schema_version: 1,
    scope: CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE,
    keys: [{
      key_id: VERIFIER_KEY_ID,
      public_key_spki: verifierPublicKeySpki,
      status: "ACTIVE",
      not_before: atOffset(-60 * 60 * 1000),
      not_after: atOffset(60 * 60 * 1000),
      deployment_id: deploymentId,
      worker_name: CANARY_VERIFIER_WORKER_NAME,
    }],
  };
  const trustedRuntimeIdentity = {
    status: "VALID",
    signature_valid: true,
    cross_binding: { attestation_fresh: true },
    git_commit_sha: "a".repeat(40),
    workflow_run_id: "123456",
    workflow_run_attempt: "2",
    deployment_id: "synthetic-main-deployment",
    worker_name: "fusou-tlsn-verification-canary",
    version_id: "6b064508-1cdb-453c-826b-bdea36a8b1e5",
    platform_deployment_id: "7b064508-1cdb-453c-826b-bdea36a8b1e5",
    verifier_identity: {
      status: "VALID",
      deployment_id: deploymentId,
      worker_name: CANARY_VERIFIER_WORKER_NAME,
      version_id: runtimeVersionId,
      verifier_key_id: VERIFIER_KEY_ID,
      public_key_spki_sha256: sha256(Buffer.from(verifierPublicKeySpki, "base64url")),
      key_registry_sha256: canaryVerifierIdentityKeyRegistrySha256(verifierIdentityKeyRegistry),
      attestation_captured_at: CAPTURED_AT,
      attestation_expires_at: EXPIRES_AT,
    },
  };
  return {
    verifier,
    verifierPublicKeySpki,
    deploymentId,
    runtimeVersionId,
    verifierIdentityKeyRegistry,
    trustedRuntimeIdentity,
  };
}

function generatePresentation() {
  const proxyDirectory = resolve(SCRIPT_DIRECTORY, "../../FUSOU-PROXY/proxy-https");
  const binding = bindingValue();
  const stdout = execFileSync("cargo", [
    "run",
    "--quiet",
    "--offline",
    "--manifest-path",
    resolve(proxyDirectory, "Cargo.toml"),
    "--features",
    "synthetic-tlsn",
    "--example",
    "synthetic_tlsn_fixture",
  ], {
    cwd: proxyDirectory,
    env: {
      ...process.env,
      CARGO_NET_OFFLINE: "true",
      FUSOU_SYNTHETIC_BINDING_VALUE: binding,
    },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const fixture = JSON.parse(stdout);
  assert.equal(fixture.binding_value, binding);
  assert.equal(typeof fixture.presentation_base64, "string");
  assert.equal(typeof fixture.root_certificate_base64, "string");
  assert.equal(typeof fixture.notary_key_base64, "string");
  return {
    ...fixture,
    presentationBytes: Buffer.from(fixture.presentation_base64, "base64url"),
    trustAnchorBytes: Buffer.from(fixture.root_certificate_base64, "base64url"),
    notaryKeyBytes: Buffer.from(fixture.notary_key_base64, "base64url"),
  };
}

export async function createSyntheticCandidateBundle(rootDirectory) {
  const fixture = generatePresentation();
  const presentationBytes = fixture.presentationBytes;
  const trustAnchorDer = fixture.trustAnchorBytes.toString("base64url");
  const notaryRegistry = { [NOTARY_KEY_ID]: fixture.notaryKeyBytes.toString("base64url") };
  const notaryRegistrySha256 = sha256(Buffer.from(canonicalJson(notaryRegistry), "utf8"));
  const sessionAuthorityKey = keyPair();
  const bindingAuthorityKey = keyPair();
  const sessionAuthority = authority(
    "tlsn-session-authority-key-registry",
    "synthetic-session-authority",
    sessionAuthorityKey.publicKey,
  );
  const bindingAuthority = authority(
    "tlsn-binding-authority-key-registry",
    "synthetic-binding-authority",
    bindingAuthorityKey.publicKey,
  );
  const deviceKey = keyPair();
  const devicePublicKeyBytes = Buffer.from(deviceKey.publicKey.export({ format: "der", type: "spki" })).subarray(-32);
  const devicePublicKey = devicePublicKeyBytes.toString("base64url");
  const deviceAuthNonce = "a".repeat(64);
  const deviceChallenge = Buffer.alloc(32, 0x62).toString("base64url");
  const binding = fixture.binding_value;
  const sessionCreatedAt = CAPTURED_AT;
  const sessionExpiresAt = atOffset(30 * 60 * 1000);
  const session = {
    session_id: SESSION_ID,
    canonical_user_id: USER_ID,
    device_id: DEVICE_ID,
    challenge: Buffer.alloc(32, 0x42).toString("base64url"),
    device_challenge: deviceChallenge,
    binding,
    expires_at: sessionExpiresAt,
  };
  const sessionReceipt = {
    schema_version: 1,
    type: "attestation-session-issued",
    signature_algorithm: "Ed25519",
    signer_key_id: sessionAuthority.signerKeyId,
    session_id: SESSION_ID,
    canonical_user_id: USER_ID,
    device_id: DEVICE_ID,
    device_auth_nonce: deviceAuthNonce,
    nonce: session.challenge,
    device_challenge: deviceChallenge,
    binding_value: binding,
    created_at: sessionCreatedAt,
    expires_at: sessionExpiresAt,
  };
  sessionReceipt.signature = sign(
    null,
    sessionReceiptSigningBytes(sessionReceipt),
    sessionAuthorityKey.privateKey,
  ).toString("base64url");
  session.session_receipt = sessionReceipt;

  const deviceAuthentication = {
    request: {
      device_id: DEVICE_ID,
      nonce: deviceAuthNonce,
      sig: sign(null, Buffer.from(deviceAuthNonce, "utf8"), deviceKey.privateKey).toString("base64url"),
    },
    worker_acceptance: { status: 201, device_id: DEVICE_ID, session_id: SESSION_ID },
  };
  const deviceIdentity = {
    canonical_user_id: USER_ID,
    device_id: DEVICE_ID,
    device_public_key: devicePublicKey,
    device_public_key_sha256: sha256(devicePublicKeyBytes),
    authority_state: "UNVERIFIED",
  };
  const possessionMessage = tlsnDeviceProofSigningBytes(DEVICE_ID, SESSION_ID, binding, deviceChallenge);
  const possessionDigest = createHash("sha256").update(possessionMessage);
  const possessionProof = {
    device_id: DEVICE_ID,
    session_id: SESSION_ID,
    binding_value: binding,
    challenge: deviceChallenge,
    sig: sign(null, possessionMessage, deviceKey.privateKey).toString("base64url"),
    message_sha256: possessionDigest.copy().digest("base64url"),
    message_sha256_hex: possessionDigest.copy().digest("hex"),
    replay_digest: possessionDigest.copy().digest("base64url"),
    replay_digest_hex: possessionDigest.digest("hex"),
  };
  const consumeReceipt = {
    schema_version: 1,
    type: "attestation-binding-consumed",
    signature_algorithm: "Ed25519",
    signer_key_id: bindingAuthority.signerKeyId,
    session_id: SESSION_ID,
    canonical_user_id: USER_ID,
    device_id: DEVICE_ID,
    nonce: session.challenge,
    binding_value: binding,
    presentation_id: sha256(presentationBytes),
    used_at: atOffset(-60 * 1000),
  };
  consumeReceipt.signature = sign(
    null,
    consumeReceiptSigningBytes(consumeReceipt),
    bindingAuthorityKey.privateKey,
  ).toString("base64url");

  const verifier = verifierRuntime();
  const semantic = await verifyProductionPresentation({
    presentationBytes,
    serverIdentity: "game.example.test",
    profileSha256: PROFILE_SHA256,
    verifierKeyId: VERIFIER_KEY_ID,
    notaryKeyId: NOTARY_KEY_ID,
    canonicalUserId: USER_ID,
    canonicalDeviceId: DEVICE_ID,
    deviceChallenge,
    notaryRegistry,
    trustAnchorDer,
  });
  const resultAuthority = signedResultAuthority();
  const unsignedResult = semantic.result;
  const signedResult = {
    ...unsignedResult,
    signature: sign(null, resultSigningBytes(unsignedResult), resultAuthority.signer.privateKey).toString("base64url"),
  };
  const workerVerification = {
    verified: true,
    result: signedResult,
    signer_key_id: RESULT_KEY_ID,
    signature_algorithm: "Ed25519",
    consume_receipt: consumeReceipt,
  };
  const resultBytes = jsonBytes(workerVerification);
  const executionReceipt = createCanaryVerifierExecutionReceipt({
    jobId: JOB_ID,
    verificationAttemptId: ATTEMPT_ID,
    deploymentId: verifier.deploymentId,
    workerName: CANARY_VERIFIER_WORKER_NAME,
    runtimeVersionId: verifier.runtimeVersionId,
    verifierKeyId: VERIFIER_KEY_ID,
    verifierPublicKeySpki: verifier.verifierPublicKeySpki,
    verifierSigningPrivateKeyPkcs8: privatePkcs8(verifier.verifier.privateKey),
    presentationBytes,
    resultBytes,
    issuedAt: ISSUED_AT,
    receiptId: "394dc8cc-d4bc-4b8c-9813-7bc4a04a9603",
  });
  const executionReceiptBytes = jsonBytes(executionReceipt);
  const artifacts = {
    "session.json": jsonBytes(session),
    "device-authentication.json": jsonBytes(deviceAuthentication),
    "device-identity.json": jsonBytes(deviceIdentity),
    "possession-proof.json": jsonBytes(possessionProof),
    "result.json": jsonBytes(signedResult),
    "consume-receipt.json": jsonBytes(consumeReceipt),
    "worker-verification.json": jsonBytes(workerVerification),
    "result-exact.bin": resultBytes,
    "verifier-execution-receipt-header.txt": Buffer.from(executionReceiptBytes.toString("base64url"), "ascii"),
    "verifier-execution-receipt.bin": executionReceiptBytes,
    "presentation.bin": presentationBytes,
    "metadata.json": jsonBytes({ server_identity: "untrusted-config.invalid" }),
    "capture-provenance.json": jsonBytes({
      schema_version: 1,
      classification: "SYNTHETIC_FIXTURE",
      source: "synthetic-alpha15-test-fixture",
    }),
  };
  const candidateDirectory = resolve(rootDirectory, "candidate");
  await mkdir(candidateDirectory, { recursive: true, mode: 0o700 });
  for (const [name, bytes] of Object.entries(artifacts)) {
    await writeFile(resolve(candidateDirectory, name), bytes, { mode: 0o600, flag: "wx" });
  }
  const candidateManifest = {
    schema_version: 1,
    scope: "fusou-tlsn-human-test-play-candidate",
    candidate_status: "CAPTURED_PENDING_OFFLINE_VERIFICATION",
    approval_status: "UNAPPROVED",
    target_identity_status: "NOT_YET_OBSERVED",
    target_identity_source: "alpha15-verified-presentation-required",
    synthetic_fixture: true,
    capture_provenance: "synthetic-alpha15-test-fixture",
    presentation_sha256: sha256(presentationBytes),
    exact_result_sha256: sha256(resultBytes),
    verifier_execution_receipt_status: "CAPTURED",
    verifier_execution_receipt_sha256: sha256(executionReceiptBytes),
    worker_result_http_status: 200,
    connection_id: 5,
    readiness_effect: "NONE",
    gameplay_effect: "NONE",
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, bytes]) => [name, {
      size_bytes: bytes.length,
      sha256: sha256(bytes),
    }])),
  };
  await writeFile(resolve(candidateDirectory, "candidate-manifest.json"), jsonBytes(candidateManifest), {
    mode: 0o600,
    flag: "wx",
  });

  const notaryDescriptor = {
    key_id: NOTARY_KEY_ID,
    verifying_key: notaryRegistry[NOTARY_KEY_ID],
    registry_sha256: notaryRegistrySha256,
  };
  return {
    candidateDirectory,
    presentationBytes,
    resultBytes,
    candidateManifest,
    trustContext: {
      verifierIdentityKeyRegistry: verifier.verifierIdentityKeyRegistry,
      trustedRuntimeIdentity: verifier.trustedRuntimeIdentity,
      expectedJobId: JOB_ID,
      expectedVerificationAttemptId: ATTEMPT_ID,
      sessionAuthority,
      bindingAuthority,
      resultAuthority: resultAuthority.authority,
      deploymentManifest: {
        notary: notaryDescriptor,
        artifacts: [{ name: "profile", sha256: PROFILE_SHA256 }],
      },
      profileSha256: PROFILE_SHA256,
      notaryRegistry,
      trustAnchorDer,
    },
  };
}