import assert from "node:assert/strict";
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { tlsnDeviceProofSigningBytes } from "../../FUSOU-TLSN-VERIFICATION-WORKER/src/device-proof-framing.ts";
import {
  assertSignedResultRegistryEnvelope,
  createSignedResultRegistryEnvelope,
} from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/result-registry-envelope.mjs";
import { readAndValidateTestplayBuiltConfig } from "../../FUSOU-WEB/scripts/tlsn-testplay-build-profile.mjs";
import {
  assertAlpha15NotaryVerifyingKey,
  canonicalJson,
  PROFILE_CONTRACT_SPEC,
  productionSecurityRegistrySetPayload,
  sha256Base64Url,
} from "../../FUSOU-TLSN-VERIFICATION-WORKER/src/origin-trust-contract.mjs";
import { resolvePinnedProductionTargets } from "../../FUSOU-TLSN-VERIFICATION-WORKER/src/production-result-contract.mjs";
import { serializeTargetApprovalRecord } from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/target-approval-contract.mjs";
import { profilesForServerIdentity } from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/profile-canonical-contract.mjs";
import { verificationQueueMessageSchema } from "../../FUSOU-TLSN-VERIFICATION-WORKER/src/verification_jobs.ts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const coordinatorRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(coordinatorRoot, "../..");
const workerRoot = resolve(coordinatorRoot, "../FUSOU-TLSN-VERIFICATION-WORKER");
const proxyRoot = resolve(coordinatorRoot, "../FUSOU-PROXY/proxy-https");
const workerName = "fusou-tlsn-local-production-queue";
const queueName = "fusou-tlsn-local-production-queue";
const dispatcherName = "fusou-tlsn-local-production-queue-dispatch";
const serverIdentity = "capture.fusou.internal";
const notaryId = "fusou-production-notary";
const notaryKeyId = "alpha15-k256-v1";

function runDirectory() {
  const value = process.env.FUSOU_LOCAL_TEST_RUN_DIR;
  if (!value) throw new Error("FUSOU_LOCAL_TEST_RUN_DIR is required");
  return resolve(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

const safeQueueObservationFields = {
  "local-production-queue-handler": ["attempts", "delivery", "event", "job_id"],
  "local-production-queue-wasm-call-failure": [
    "diagnostic_code",
    "event",
    "exception_kind",
    "job_id",
    "wasm_call",
  ],
  "local-production-queue-verification-failure": [
    "event",
    "failure_code",
    "job_id",
    "stage",
  ],
};

function hasExactFields(value, expectedFields) {
  return value !== null &&
    typeof value === "object" &&
    Object.keys(value).sort().join("\0") === expectedFields.join("\0");
}

function isSafeQueueObservationEvent(event) {
  const expectedFields = safeQueueObservationFields[event?.event];
  if (!expectedFields || !hasExactFields(event, expectedFields)) return false;
  if (event.event === "local-production-queue-handler") {
    return ["actual_queue", "controlled_dispatch"].includes(event.delivery) &&
      typeof event.job_id === "string" &&
      Number.isInteger(event.attempts) &&
      event.attempts >= 1;
  }
  if (event.event === "local-production-queue-wasm-call-failure") {
    return [
      "inspect_alpha15_server_identity",
      "result_generation_verification",
    ].includes(event.wasm_call) &&
      ["wasm_string", "javascript_error", "other_value"].includes(event.exception_kind) &&
      ["certificate_path_invalid", "server_name_invalid", "unknown"].includes(event.diagnostic_code) &&
      typeof event.job_id === "string";
  }
  return event.event === "local-production-queue-verification-failure" &&
    event.stage === "wasm_verification" &&
    event.failure_code === "verifier_failed" &&
    typeof event.job_id === "string";
}

function startQueueObservationLogCapture(run) {
  const logPath = join(run, "production-worker.log");
  writeFileSync(logPath, "", { mode: 0o600 });
  let pending = "";
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  const captureLine = (line) => {
    const start = line.indexOf('{"event":"local-production-queue-');
    if (start < 0) return;
    let event;
    try {
      event = JSON.parse(line.slice(start));
    } catch {
      return;
    }
    if (!isSafeQueueObservationEvent(event)) return;
    appendFileSync(logPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  };

  const capture = (chunk) => {
    pending += typeof chunk === "string"
      ? chunk
      : Buffer.from(chunk).toString("utf8");
    let lineEnd;
    while ((lineEnd = pending.indexOf("\n")) >= 0) {
      captureLine(pending.slice(0, lineEnd).replace(/\r$/, ""));
      pending = pending.slice(lineEnd + 1);
    }
  };

  process.stdout.write = function (...args) {
    capture(args[0]);
    return Reflect.apply(originalStdoutWrite, this, args);
  };
  process.stderr.write = function (...args) {
    capture(args[0]);
    return Reflect.apply(originalStderrWrite, this, args);
  };

  return () => {
    if (pending) captureLine(pending);
    pending = "";
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  };
}

function classifyWasmException(error) {
  let exceptionKind = "other_value";
  let message;
  if (typeof error === "string") {
    exceptionKind = "wasm_string";
    message = error;
  } else if (error instanceof Error) {
    exceptionKind = "javascript_error";
    message = error.message;
  }
  let diagnosticCode = "unknown";
  if (typeof message === "string") {
    if (message.endsWith("failed to verify certificate path to provided trust anchors")) {
      diagnosticCode = "certificate_path_invalid";
    } else if (message.endsWith("failed to verify certificate is valid for provided server name")) {
      diagnosticCode = "server_name_invalid";
    }
  }
  return { exception_kind: exceptionKind, diagnostic_code: diagnosticCode };
}

function replaceSourceExactlyOnce(source, marker, replacement, description) {
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error(`Worker observation seam is not unique: ${description}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

async function testWasmExceptionClassification() {
  const pathError =
    "alpha.15 Presentation verification failed: server certificate verification failed: server certificate verification failed: failed to verify certificate path to provided trust anchors";
  const nameError =
    "alpha.15 Presentation verification failed: server certificate verification failed: server certificate verification failed: failed to verify certificate is valid for provided server name";
  const cases = [
    [
      "wasm string with InvalidPath diagnostic",
      pathError,
      { exception_kind: "wasm_string", diagnostic_code: "certificate_path_invalid" },
    ],
    [
      "JavaScript Error with InvalidPath diagnostic",
      new Error(pathError),
      { exception_kind: "javascript_error", diagnostic_code: "certificate_path_invalid" },
    ],
    [
      "different certificate validation diagnostic",
      nameError,
      { exception_kind: "wasm_string", diagnostic_code: "server_name_invalid" },
    ],
    [
      "generic certificate wording",
      "certificate identity validation failed",
      { exception_kind: "wasm_string", diagnostic_code: "unknown" },
    ],
    [
      "unknown non-Error value",
      Object.create(null),
      { exception_kind: "other_value", diagnostic_code: "unknown" },
    ],
  ];
  for (const [label, input, expected] of cases) {
    assert.deepEqual(classifyWasmException(input), expected, label);
  }
  process.stdout.write(JSON.stringify({ wasm_exception_classification_cases: cases.length, passed: true }) + "\n");
}

function parseEnvFile(raw) {
  const entries = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) throw new Error("private environment file is malformed");
    entries[line.slice(0, equals)] = line.slice(equals + 1).replace(/^["']|["']$/g, "");
  }
  return entries;
}

function envText(entries) {
  return `${Object.entries(entries).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

async function writePrivateFile(path, contents) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function writeJsonPrivate(path, value) {
  await writePrivateFile(path, `${JSON.stringify(value)}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function generateEd25519Key() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKeyPkcs8: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    publicKeySpki: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

function authorityRegistry(scope, keyId, publicKeySpki, notBefore) {
  return JSON.stringify({
    schema_version: 1,
    scope,
    keys: [{
      key_id: keyId,
      public_key_spki: publicKeySpki,
      status: "ACTIVE",
      not_before: notBefore,
      not_after: null,
    }],
  });
}

function safeCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with ${result.status ?? result.signal ?? "unknown status"}`);
  }
  return result;
}

function cargoEnvironment(directory) {
  const env = {};
  for (const key of ["HOME", "PATH", "TMP", "TEMP", "TMPDIR", "RUSTUP_HOME", "CARGO_HOME"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.CARGO_TARGET_DIR = join(directory, "proxy-cargo-target");
  return env;
}

async function configure() {
  const run = runDirectory();
  const configPath = join(run, "local-test-config.json");
  const config = await readJson(configPath);
  const supabaseUrl = new URL(config.supabase_url);
  const databaseUrl = new URL(config.database_url);
  if (
    !["127.0.0.1", "localhost"].includes(supabaseUrl.hostname) ||
    !["127.0.0.1", "localhost"].includes(databaseUrl.hostname) ||
    config.worker_url !== "http://127.0.0.1:8787" ||
    config.web_url !== "http://127.0.0.1:8788"
  ) {
    throw new Error("local Auth, WEB, Worker, and database endpoints must remain on loopback");
  }

  const credentialsDirectory = join(run, "tlsn-credentials");
  const originRoot = await readFile(join(credentialsDirectory, "origin-root.der"));
  const notaryKey = await readFile(join(run, "notary-key.bin"));
  if (originRoot.length === 0 || notaryKey.length === 0) {
    throw new Error("the existing Rust fixture CA and Notary key must be prepared first");
  }
  const notaryPublicKey = notaryKey.toString("base64url");
  assertAlpha15NotaryVerifyingKey(notaryPublicKey, "local normal Notary public key");

  const targets = Array.from({ length: 20 }, (_, index) => ({
    server_index: index + 1,
    server_identity: index === 0
      ? serverIdentity
      : `queue-origin-${String(index + 1).padStart(2, "0")}.fusou.internal`,
    port: 443,
  }));
  const inventoryRaw = JSON.stringify({
    schema_version: 1,
    source: "packages/configs/configs.toml:[app.connect_kc_server.server_list]",
    targets,
  }, null, 2);
  const originInventorySha256 = sha256(Buffer.from(inventoryRaw));
  const approvalRaw = serializeTargetApprovalRecord({
    schema_version: 1,
    authority_model: "FUSOU_DEPLOYMENT_OPERATOR",
    environment: "production",
    status: "APPROVED",
    inventory_sha256: originInventorySha256,
    targets: [serverIdentity],
    approved_at: new Date().toISOString(),
  });
  const targetApprovalArtifactSha256 = sha256(Buffer.from(approvalRaw));
  const pinnedTargets = await resolvePinnedProductionTargets({
    inventoryRaw,
    approvalRaw,
    inventoryPin: originInventorySha256,
    approvalPin: targetApprovalArtifactSha256,
  });
  assert.deepEqual(pinnedTargets.targets, [serverIdentity]);

  const resultSigner = generateEd25519Key();
  const resultRegistryRoot = generateEd25519Key();
  const sessionAuthority = generateEd25519Key();
  const bindingAuthority = generateEd25519Key();
  const executionReceiptKey = generateEd25519Key();
  const notBefore = new Date(Date.now() - 60_000).toISOString();
  const resultSignerKeyId = "result-signing-v1";
  const resultRegistryRootKeyId = "result-registry-root-v1";
  const sessionAuthorityKeyId = "session-authority-v1";
  const bindingAuthorityKeyId = "binding-authority-v1";
  const resultRegistry = {
    schema_version: 1,
    scope: "tlsn-result-signing-key-registry",
    keys: [{
      key_id: resultSignerKeyId,
      public_key_spki: resultSigner.publicKeySpki,
      status: "ACTIVE",
      not_before: notBefore,
      not_after: null,
    }],
  };
  const resultRegistryRaw = JSON.stringify(resultRegistry);
  const resultRegistryEnvelope = createSignedResultRegistryEnvelope({
    registry: resultRegistry,
    registryRaw: resultRegistryRaw,
    rootKeyId: resultRegistryRootKeyId,
    rootPublicKeySpki: resultRegistryRoot.publicKeySpki,
    rootPrivateKeyPkcs8: resultRegistryRoot.privateKeyPkcs8,
  });
  assertSignedResultRegistryEnvelope(resultRegistryEnvelope, {
    registry: resultRegistry,
    registryRaw: resultRegistryRaw,
    trustedRootKeyId: resultRegistryRootKeyId,
    trustedRootPublicKeySpki: resultRegistryRoot.publicKeySpki,
  });

  const notaryRegistryRaw = canonicalJson({ [notaryKeyId]: notaryPublicKey });
  const profilePolicySha256 = sha256(Buffer.from(canonicalJson(PROFILE_CONTRACT_SPEC)));
  const securityRegistrySetRaw = canonicalJson(productionSecurityRegistrySetPayload({
    notaryId,
    notaryKeyId,
    notaryRegistryRaw,
    originInventorySha256,
    targetApprovalArtifactSha256,
    profilePolicySha256,
  }));
  const securityRegistrySetSha256 = sha256(Buffer.from(securityRegistrySetRaw));
  const profile = profilesForServerIdentity(serverIdentity);
  const gitResult = safeCommand("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot });
  const commitSha = gitResult.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) throw new Error("current source commit SHA is invalid");

  const workerEnvironment = {
    TLSN_ENVIRONMENT: "production",
    TLSN_DEPLOYMENT_ROLE: "production",
    TLSN_PRODUCTION_EXECUTION_MODE: "queue",
    TLSN_PRODUCTION_QUEUE_EXECUTION_KEY_ID: "local-queue-execution-signing-v1",
    TLSN_PRODUCTION_QUEUE_EXECUTION_PUBLIC_KEY_SPKI: executionReceiptKey.publicKeySpki,
    TLSN_PRODUCTION_QUEUE_EXECUTION_PRIVATE_KEY_PKCS8: executionReceiptKey.privateKeyPkcs8,
    TLSN_PRODUCTION_DEPLOYMENT_ID: `queue-${randomUUID()}`,
    TLSN_PRODUCTION_WORKER_NAME: "fusou-production-queue-worker",
    TLSN_GIT_COMMIT_SHA: commitSha,
    TLSN_PRODUCTION_NOTARY_ID: notaryId,
    TLSN_CANDIDATE_VERIFIER_KEY_ID: "alpha15-verifier-v1",
    TLSN_CANDIDATE_NOTARY_KEY_ID: notaryKeyId,
    TLSN_PRODUCTION_NOTARY_REGISTRY: notaryRegistryRaw,
    TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8: resultSigner.privateKeyPkcs8,
    TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: resultSigner.publicKeySpki,
    TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID: resultSignerKeyId,
    TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY: resultRegistryRaw,
    TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE: JSON.stringify(resultRegistryEnvelope),
    TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID: resultRegistryRootKeyId,
    TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI: resultRegistryRoot.publicKeySpki,
    TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: sessionAuthority.privateKeyPkcs8,
    TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: sessionAuthority.publicKeySpki,
    TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID: sessionAuthorityKeyId,
    TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY: authorityRegistry(
      "tlsn-session-authority-key-registry",
      sessionAuthorityKeyId,
      sessionAuthority.publicKeySpki,
      notBefore,
    ),
    TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: bindingAuthority.privateKeyPkcs8,
    TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: bindingAuthority.publicKeySpki,
    TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID: bindingAuthorityKeyId,
    TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY: authorityRegistry(
      "tlsn-binding-authority-key-registry",
      bindingAuthorityKeyId,
      bindingAuthority.publicKeySpki,
      notBefore,
    ),
    TLSN_BINDING_TTL_SECONDS: "1800",
    TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS: "tlsn-web.fusou.test",
    TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS: "supabase.fusou.test",
    TLSN_CANDIDATE_SUPABASE_URL: "https://supabase.fusou.test/",
    TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY: config.supabase_publishable_key,
    TLSN_CANDIDATE_DEVICE_AUTH_URL: "https://tlsn-web.fusou.test/api/auth/anonymous-sync/v2/device-proof",
    TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL: "https://tlsn-web.fusou.test/api/auth/anonymous-sync/v2/tlsn-device-proof",
    TLSN_PRODUCTION_ORIGIN_INVENTORY_SHA256: originInventorySha256,
    TLSN_PRODUCTION_TARGET_APPROVAL_ARTIFACT_SHA256: targetApprovalArtifactSha256,
    TLSN_SECURITY_REGISTRY_SET_SHA256: securityRegistrySetSha256,
  };

  const inputsDirectory = join(run, "production-inputs");
  await writePrivateFile(join(inputsDirectory, "origin-inventory.json.txt"), inventoryRaw);
  await writePrivateFile(join(inputsDirectory, "target-approval.json.txt"), approvalRaw);
  await writePrivateFile(join(run, "worker.env"), envText(workerEnvironment));

  Object.assign(config, {
    session_authority_key_id: sessionAuthorityKeyId,
    session_authority_public_key_spki: sessionAuthority.publicKeySpki,
    binding_authority_key_id: bindingAuthorityKeyId,
    binding_authority_public_key_spki: bindingAuthority.publicKeySpki,
    result_signer_key_id: resultSignerKeyId,
    result_public_key_spki: resultSigner.publicKeySpki,
    result_registry_root_key_id: resultRegistryRootKeyId,
    result_registry_root_public_key_spki: resultRegistryRoot.publicKeySpki,
    result_registry_envelope: resultRegistryEnvelope,
    notary_key_id: notaryKeyId,
    notary_key_sha256: sha256(notaryKey),
    server_identity: serverIdentity,
    profile_id: profile.complete.profile.id,
    profile_sha256: profile.complete.sha256,
  });
  await writeJsonPrivate(configPath, config);
  await writeJsonPrivate(join(run, "production-trust-summary.json"), {
    schema_version: 1,
    environment: "production",
    deployment_role: "production",
    execution_mode: "queue",
    origin_inventory_sha256: originInventorySha256,
    target_approval_artifact_sha256: targetApprovalArtifactSha256,
    security_registry_set_sha256: securityRegistrySetSha256,
    profile_policy_sha256: profilePolicySha256,
    notary_registry_sha256: sha256(Buffer.from(notaryRegistryRaw)),
    approved_target_identities: pinnedTargets.targets,
    inventory_target_count: targets.length,
    origin_identity: serverIdentity,
    notary_id: notaryId,
    notary_key_id: notaryKeyId,
    production_trust_root_bound: false,
    source_commit_sha: commitSha,
  });
  await createServiceCertificate(run);
  process.stdout.write(JSON.stringify({
    configured: true,
    environment: "production",
    deployment_role: "production",
    execution_mode: "queue",
    target_count: targets.length,
    approved_target_count: pinnedTargets.targets.length,
    origin_identity: serverIdentity,
    origin_inventory_sha256: originInventorySha256,
    target_approval_artifact_sha256: targetApprovalArtifactSha256,
    security_registry_set_sha256: securityRegistrySetSha256,
    result_registry_envelope_verified: true,
    production_trust_root_bound: false,
  }) + "\n");
}

async function createServiceCertificate(run) {
  const keyPath = join(run, "service-relay.key");
  const certificatePath = join(run, "service-relay.crt");
  safeCommand("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "2",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
    "-subj",
    "/CN=supabase.fusou.test",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "subjectAltName=DNS:supabase.fusou.test,DNS:tlsn-web.fusou.test",
    "-addext",
    "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign,cRLSign",
    "-addext",
    "extendedKeyUsage=serverAuth",
  ], { stdio: "ignore" });
  await chmod(keyPath, 0o600);
  await chmod(certificatePath, 0o600);
}

async function buildNotary() {
  const run = runDirectory();
  const env = cargoEnvironment(run);
  safeCommand("cargo", [
    "build",
    "--locked",
    "--release",
    "--manifest-path",
    join(proxyRoot, "Cargo.toml"),
    "--features",
    "operational-notary",
    "--bin",
    "fusou-notary",
  ], { cwd: proxyRoot, env, stdio: "inherit", timeout: 15 * 60 * 1000 });
  const binary = join(env.CARGO_TARGET_DIR, "release", "fusou-notary");
  process.stdout.write(JSON.stringify({
    normal_operational_notary: true,
    fault_injection_features: false,
    binary,
    sha256: sha256(await readFile(binary)),
  }) + "\n");
}

async function cargoFixtureTest(run, name, extraEnvironment = {}) {
  const env = {
    ...cargoEnvironment(run),
    ...extraEnvironment,
  };
  safeCommand("cargo", [
    "test",
    "--locked",
    "--manifest-path",
    join(proxyRoot, "Cargo.toml"),
    "--features",
    "operational-notary,local-test-notary-fault-injection",
    "--test",
    "local_notary_interop",
    name,
    "--",
    "--exact",
  ], {
    cwd: proxyRoot,
    env,
    stdio: "inherit",
    timeout: 15 * 60 * 1000,
  });
}

async function prepareFixtureCredentials() {
  const run = runDirectory();
  const credentialsDirectory = join(run, "tlsn-credentials");
  const notaryKeyPath = join(run, "notary-key.bin");
  await mkdir(credentialsDirectory, { recursive: true, mode: 0o700 });
  const fixtureEnvironment = {
    FUSOU_TEST_TLSN_CREDENTIALS_DIR: credentialsDirectory,
    FUSOU_TEST_ORIGIN_IDENTITY: serverIdentity,
  };
  await cargoFixtureTest(run, "operational::prepare_worker_session_fixture_credentials", fixtureEnvironment);
  await cargoFixtureTest(run, "operational::export_worker_session_fixture_notary_key", {
    ...fixtureEnvironment,
    FUSOU_TEST_NOTARY_KEY_OUTPUT: notaryKeyPath,
  });
  const root = await readFile(join(credentialsDirectory, "origin-root.der"));
  const notaryKey = await readFile(notaryKeyPath);
  if (!root.length || !notaryKey.length) throw new Error("Rust TLSN fixture credentials were not created");
  process.stdout.write(JSON.stringify({
    credentials_prepared: true,
    origin_identity: serverIdentity,
    origin_root_sha256: sha256(root),
    notary_verifying_key_sha256: sha256(notaryKey),
  }) + "\n");
}

async function prepareFixture() {
  const run = runDirectory();
  const config = await readJson(join(run, "local-test-config.json"));
  const credentialsDirectory = join(run, "tlsn-credentials");
  const notaryKeyPath = join(run, "notary-key.bin");
  await readFile(join(credentialsDirectory, "origin-root.der"));
  await readFile(notaryKeyPath);
  const sessionFiles = (await readdir(config.sessions_directory))
    .filter((name) => name.endsWith(".json"));
  if (sessionFiles.length !== 1) {
    throw new Error("exactly one fresh Worker Session must be present before creating its Presentation");
  }
  const sessionInput = join(config.sessions_directory, sessionFiles[0]);
  const session = await readJson(sessionInput);
  const presentationPath = join(run, "production-local-ca-presentation.bin");
  const fixtureDirectory = join(run, "production-presentation-fixture");
  await mkdir(fixtureDirectory, { recursive: true, mode: 0o700 });
  const operationalBinary = join(cargoEnvironment(run).CARGO_TARGET_DIR, "release", "fusou-notary");
  const environment = {
    ...cargoEnvironment(run),
    FUSOU_OPERATIONAL_NOTARY_BIN: operationalBinary,
    FUSOU_TEST_TLSN_CREDENTIALS_DIR: credentialsDirectory,
    FUSOU_TEST_SESSION_INPUT: sessionInput,
    FUSOU_TEST_SESSION_AUTHORITY_KEY_ID: config.session_authority_key_id,
    FUSOU_TEST_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: config.session_authority_public_key_spki,
    FUSOU_TEST_NOTARY_KEY_OUTPUT: notaryKeyPath,
    FUSOU_TEST_NOTARY_ID: notaryId,
    FUSOU_TEST_NOTARY_KEY_ID: notaryKeyId,
    FUSOU_TEST_NOTARY_ENVIRONMENT: "production",
    FUSOU_TEST_ORIGIN_IDENTITY: serverIdentity,
    FUSOU_TEST_PRESENTATION_OUTPUT: presentationPath,
    FUSOU_TEST_PRESENTATION_METADATA_OUTPUT: join(fixtureDirectory, "metadata.json"),
    FUSOU_TEST_ORIGIN_REQUEST_OUTPUT: join(fixtureDirectory, "origin-request.bin"),
    FUSOU_TEST_ORIGIN_RESPONSE_OUTPUT: join(fixtureDirectory, "origin-response.bin"),
  };
  safeCommand("cargo", [
    "test",
    "--locked",
    "--manifest-path",
    join(proxyRoot, "Cargo.toml"),
    "--features",
    "operational-notary,local-test-notary-fault-injection",
    "--test",
    "local_notary_interop",
    "operational::worker_session_grant_produces_independently_verified_complete_presentation",
    "--",
    "--exact",
  ], { cwd: proxyRoot, env: environment, stdio: "inherit", timeout: 15 * 60 * 1000 });
  const metadata = await readJson(join(fixtureDirectory, "metadata.json"));
  const presentation = await readFile(presentationPath);
  if (
    metadata.independent_verification !== "PASS" ||
    metadata.session_id !== session.session_id ||
    metadata.device_id !== session.device_id ||
    metadata.binding !== session.binding ||
    metadata.server_identity !== serverIdentity ||
    metadata.notary_id !== notaryId ||
    metadata.environment !== "production" ||
    metadata.presentation_bytes !== presentation.length ||
    metadata.presentation_sha256 !== sha256(presentation)
  ) {
    throw new Error("the Rust fixture did not independently verify the fresh Production Session Presentation");
  }
  process.stdout.write(JSON.stringify({
    fixture: "normal-operational-notary",
    test: "worker_session_grant_produces_independently_verified_complete_presentation",
    session_id: metadata.session_id,
    server_identity: metadata.server_identity,
    notary_id: metadata.notary_id,
    environment: metadata.environment,
    presentation_bytes: presentation.length,
    presentation_sha256: metadata.presentation_sha256,
    independent_verification: metadata.independent_verification,
    result_path: presentationPath,
  }) + "\n");
}

async function inspectPresentationWithProductionWasm() {
  const run = runDirectory();
  const config = await readJson(join(run, "local-test-config.json"));
  const presentationPath = join(run, "production-local-ca-presentation.bin");
  const presentationBefore = await readFile(presentationPath);
  const notaryKey = await readFile(join(run, "notary-key.bin"));
  if (sha256(notaryKey) !== config.notary_key_sha256) {
    throw new Error("the local Presentation Notary key does not match the configured pin");
  }
  const wasmDirectory = join(workerRoot, "src/wasm");
  const wasmBytes = await readFile(join(wasmDirectory, "fusou_tlsn_verifier_bg.wasm"));
  const wasmApi = await import(pathToFileURL(join(wasmDirectory, "fusou_tlsn_verifier.js")).href);
  if (typeof wasmApi.default !== "function" || typeof wasmApi.inspect_alpha15_server_identity !== "function") {
    throw new Error("the generated Worker WASM does not expose the Production identity inspection API");
  }
  await wasmApi.default(wasmBytes);
  let result = "accepted";
  let classification = null;
  try {
    wasmApi.inspect_alpha15_server_identity(
      new Uint8Array(presentationBefore),
      new Uint8Array(notaryKey),
    );
  } catch (error) {
    result = "rejected";
    classification = classifyWasmException(error);
  }
  const presentationAfter = await readFile(presentationPath);
  const presentationSha256 = sha256(presentationBefore);
  if (
    presentationBefore.length !== presentationAfter.length ||
    presentationSha256 !== sha256(presentationAfter)
  ) {
    throw new Error("the Presentation bytes changed during Production WASM inspection");
  }
  process.stdout.write(JSON.stringify({
    wasm_call: "inspect_alpha15_server_identity",
    result,
    exception_kind: classification?.exception_kind ?? null,
    diagnostic_code: classification?.diagnostic_code ?? null,
    production_default_trust_store: true,
    custom_trust_root_supplied: false,
    notary_key_sha256: sha256(notaryKey),
    presentation_bytes: presentationBefore.length,
    presentation_sha256_before: presentationSha256,
    presentation_sha256_after: sha256(presentationAfter),
    wasm_sha256: sha256(wasmBytes),
  }) + "\n");
}

async function startServiceRelay(run, supabaseOrigin, serviceCertificate) {
  const destinations = {
    "supabase.fusou.test": new URL(supabaseOrigin),
    "tlsn-web.fusou.test": new URL("http://127.0.0.1:8788"),
  };
  const server = https.createServer({
    key: await readFile(join(run, "service-relay.key")),
    cert: serviceCertificate,
  }, (incoming, outgoing) => {
    const hostname = String(incoming.headers.host ?? "").split(":")[0].toLowerCase();
    const destination = destinations[hostname];
    if (!destination) {
      outgoing.writeHead(421).end();
      return;
    }
    const headers = { ...incoming.headers };
    delete headers.host;
    const proxy = http.request({
      hostname: destination.hostname,
      port: Number(destination.port || 80),
      path: incoming.url,
      method: incoming.method,
      headers,
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    proxy.once("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(proxy);
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(9443, "127.0.0.1", resolveListen);
  });
  return server;
}

function outboundOverVerifiedTls(request, allowedOrigins, serviceCertificate) {
  const url = new URL(request.url);
  if (!allowedOrigins.has(url.origin)) {
    console.warn(JSON.stringify({
      event: "local-production-outbound-blocked",
      host: url.hostname,
      path: url.pathname,
    }));
    return Promise.resolve(new Response("local Production outbound request blocked", { status: 502 }));
  }
  return new Promise(async (resolveResponse, rejectResponse) => {
    try {
      const body = request.method === "GET" || request.method === "HEAD"
        ? undefined
        : Buffer.from(await request.arrayBuffer());
      const headers = Object.fromEntries(request.headers.entries());
      delete headers.host;
      const upstream = https.request({
        hostname: "127.0.0.1",
        port: 9443,
        path: `${url.pathname}${url.search}`,
        method: request.method,
        headers: { ...headers, host: url.hostname },
        ca: serviceCertificate,
        servername: url.hostname,
        rejectUnauthorized: true,
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => {
          const bytes = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          const status = response.statusCode ?? 502;
          console.log(JSON.stringify({
            event: "local-production-outbound",
            host: url.hostname,
            path: url.pathname,
            status,
            tls_verified: true,
          }));
          resolveResponse(new Response(status === 204 || status === 304 ? null : bytes, {
            status,
            headers: responseHeaders,
          }));
        });
      });
      upstream.once("error", (error) => {
        console.error(JSON.stringify({
          event: "local-production-outbound-error",
          host: url.hostname,
          path: url.pathname,
          code: error.code ?? "connection_error",
        }));
        rejectResponse(error);
      });
      if (body?.length) upstream.write(body);
      upstream.end();
    } catch (error) {
      rejectResponse(error);
    }
  });
}

function createQueueBarrier() {
  const held = new Set();
  const waiters = new Map();
  return {
    fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const jobId = url.searchParams.get("job_id");
      if (!jobId) return new Response("job_id is required", { status: 400 });
      if (request.method === "POST" && url.pathname === "/hold") {
        if (held.has(jobId)) return new Response("already held", { status: 409 });
        held.add(jobId);
        return new Promise((resolveResponse) => {
          const timeout = setTimeout(() => {
            held.delete(jobId);
            waiters.delete(jobId);
            resolveResponse(new Response("barrier timed out", { status: 504 }));
          }, 20_000);
          waiters.set(jobId, (response) => {
            clearTimeout(timeout);
            held.delete(jobId);
            resolveResponse(response);
          });
        });
      }
      if (request.method === "GET" && url.pathname === "/status") {
        return Response.json({ held: held.has(jobId) });
      }
      if (request.method === "POST" && url.pathname === "/release") {
        const release = waiters.get(jobId);
        if (!release) return Response.json({ released: false }, { status: 404 });
        waiters.delete(jobId);
        release(new Response("released", { status: 200 }));
        return Response.json({ released: true });
      }
      return new Response("not found", { status: 404 });
    },
  };
}

async function buildWorkerBundle(run) {
  const runtimeRoot = join(run, "production-queue-runtime");
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const bundlePath = join(runtimeRoot, "worker.mjs");
  const dispatcherSourcePath = join(runtimeRoot, "dispatcher-entry.mjs");
  const dispatcherPath = join(runtimeRoot, "dispatcher.mjs");
  const inventoryRaw = await readFile(join(run, "production-inputs", "origin-inventory.json.txt"), "utf8");
  const approvalRaw = await readFile(join(run, "production-inputs", "target-approval.json.txt"), "utf8");
  const dispatchToken = randomBytes(32).toString("base64url");
  await writePrivateFile(dispatcherSourcePath, [
    'import worker from "./worker.mjs";',
    "export default {",
    "  async fetch(request, env, ctx) {",
    '    if (request.headers.get("authorization") !== `Bearer ${env.TLSN_LOCAL_PRODUCTION_DISPATCH_TOKEN}`) {',
    '      return new Response("unauthorized", { status: 401 });',
    "    }",
    "    const input = await request.json();",
    '    if (!input.message || typeof input.message !== "object" || input.attempts !== 1) {',
    '      return Response.json({ error: "invalid delivery" }, { status: 400 });',
    "    }",
    '    let disposition = "unobserved";',
    "    let retryDelaySeconds = null;",
    "    const message = {",
    "      body: input.message,",
    "      id: crypto.randomUUID(),",
    "      timestamp: new Date(),",
    "      attempts: 1,",
    '      ack() { disposition = "ack"; },',
    '      retry(options = {}) { disposition = "retry"; retryDelaySeconds = options.delaySeconds ?? null; },',
    "    };",
    '    if (typeof worker.queue !== "function") throw new Error("Worker queue handler is unavailable");',
    `    await worker.queue({ queue: ${JSON.stringify(queueName)}, messages: [message] }, env, ctx);`,
    "    return Response.json({ disposition, retry_delay_seconds: retryDelaySeconds });",
    "  },",
    "};",
    "",
  ].join("\n"));
  let patchedIndexSource;
  const patchWorkerSource = async (path) => {
    let source = await readFile(path, "utf8");
    const deliveryMarker = 'benchmarkRecord(env, queueMessage.job_id, "queue_handler_entered");';
    if (source.split(deliveryMarker).length !== 2) throw new Error("Worker queue observation seam is ambiguous");
    source = source.replace(deliveryMarker, `${deliveryMarker}
    if (env.TLSN_LOCAL_PRODUCTION_QUEUE_TEST_OBSERVATIONS === "true") {
      console.info(JSON.stringify({
        event: "local-production-queue-handler",
        delivery: env.TLSN_LOCAL_PRODUCTION_QUEUE_TEST_DELIVERY_MODE ?? "unknown",
        job_id: queueMessage.job_id,
        attempts: message.attempts,
      }));
    }`);
    const barrierMarker = "  await delayTestCompletion(c.env);";
    if (source.split(barrierMarker).length !== 2) throw new Error("Worker lease synchronization seam is ambiguous");
    source = source.replace(barrierMarker, `${barrierMarker}
  if (
    c.env.TLSN_ENVIRONMENT === "production" &&
    c.env.TLSN_DEPLOYMENT_ROLE === "production" &&
    c.env.TLSN_LOCAL_PRODUCTION_QUEUE_BARRIER_ENABLED === "true"
  ) {
    const barrierResponse = await fetch(
      new Request(\`https://queue-barrier.invalid/hold?job_id=\${encodeURIComponent(callback.job_id)}\`, { method: "POST" }),
    );
    if (!barrierResponse.ok) throw new Error("local Production queue lease barrier failed");
  }`);
    const verifierFunctionMarker = "async function verifyPresentationToPreparedResult(";
    const classifierDeclaration = classifyWasmException.toString().replace(
      "function classifyWasmException",
      "function classifyLocalProductionQueueWasmException",
    );
    if (classifierDeclaration === classifyWasmException.toString()) {
      throw new Error("local WASM diagnostic classifier could not be injected");
    }
    source = replaceSourceExactlyOnce(
      source,
      verifierFunctionMarker,
      `${classifierDeclaration}

function observeLocalProductionQueueWasmCall<T>(
  wasmCall: "inspect_alpha15_server_identity" | "result_generation_verification",
  operation: () => T,
  onFailure?: (wasmCall: string, error: unknown) => void,
): T {
  try {
    return operation();
  } catch (error) {
    onFailure?.(wasmCall, error);
    throw error;
  }
}

${verifierFunctionMarker}`,
      "WASM call observer",
    );
    source = replaceSourceExactlyOnce(
      source,
      `  deviceChallengeBytes: Uint8Array,
): Promise<{`,
      `  deviceChallengeBytes: Uint8Array,
  onLocalWasmFailure?: (wasmCall: string, error: unknown) => void,
): Promise<{`,
      "WASM failure observer parameter",
    );
    source = replaceSourceExactlyOnce(
      source,
      `    const observedIdentity = inspect_alpha15_server_identity(
      presentationBytes,
      config.notaryKeyBytes,
    );`,
      `    const observedIdentity = observeLocalProductionQueueWasmCall(
      "inspect_alpha15_server_identity",
      () => inspect_alpha15_server_identity(presentationBytes, config.notaryKeyBytes),
      onLocalWasmFailure,
    );`,
      "Production identity inspection call",
    );
    const preparedJsonMarker = `  const preparedJson = profile === "sparse"\n`;
    const preparedResultMarker =
      "  const prepared = preparedResultSchema.parse(JSON.parse(preparedJson) as unknown);";
    const preparedJsonStart = source.indexOf(preparedJsonMarker);
    const preparedResultStart = source.indexOf(preparedResultMarker, preparedJsonStart);
    if (
      preparedJsonStart < 0 ||
      source.indexOf(preparedJsonMarker, preparedJsonStart + preparedJsonMarker.length) >= 0 ||
      preparedResultStart < 0
    ) {
      throw new Error("Worker result-generation WASM observation seam is ambiguous");
    }
    const expressionStart = preparedJsonStart + "  const preparedJson = ".length;
    const preparedExpression = source.slice(expressionStart, preparedResultStart).trimEnd();
    if (!preparedExpression.endsWith(";")) {
      throw new Error("Worker result-generation WASM expression is incomplete");
    }
    const preparedExpressionBody = preparedExpression.slice(0, -1).trimEnd();
    source = source.slice(0, preparedJsonStart) +
      `  const preparedJson = observeLocalProductionQueueWasmCall(
    "result_generation_verification",
    () => ${preparedExpressionBody},
    onLocalWasmFailure,
  );
` +
      source.slice(preparedResultStart);
    const verificationCallMarker = `      decodeBase64Url(completionRecord.tlsn_device_challenge, 32),
    );`;
    source = replaceSourceExactlyOnce(
      source,
      verificationCallMarker,
      `      decodeBase64Url(completionRecord.tlsn_device_challenge, 32),
      (wasmCall, error) => {
        console.info(JSON.stringify({
          event: "local-production-queue-wasm-call-failure",
          job_id: callback.job_id,
          wasm_call: wasmCall,
          ...classifyLocalProductionQueueWasmException(error),
        }));
      },
    );`,
      "queue verification call observer",
    );
    const failureMarker = `    await finalizeAttemptFailure(attemptFailureCode);
    return c.json({ error: "verification_failed" }, 422);`;
    if (source.split(failureMarker).length !== 2) throw new Error("Worker verification failure observation seam is ambiguous");
    source = source.replace(failureMarker, `    if (
      c.env.TLSN_ENVIRONMENT === "production" &&
      c.env.TLSN_DEPLOYMENT_ROLE === "production" &&
      c.env.TLSN_LOCAL_PRODUCTION_QUEUE_TEST_OBSERVATIONS === "true"
    ) {
      console.info(JSON.stringify({
        event: "local-production-queue-verification-failure",
        job_id: callback.job_id,
        stage: completionStage,
        failure_code: attemptFailureCode,
      }));
    }
${failureMarker}`);
    patchedIndexSource = source;
    return source;
  };

  await build({
    entryPoints: [join(workerRoot, "src/index.ts")],
    outfile: bundlePath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers", "./wasm/fusou_tlsn_verifier_bg.wasm"],
    loader: { ".txt": "text" },
    logLevel: "silent",
    plugins: [{
      name: "temporary-production-queue-trust-inputs",
      setup(builder) {
        builder.onResolve({ filter: /tlsn-origin-inventory\.json\.txt$/ }, () => ({
          path: "origin-inventory",
          namespace: "production-trust-fixture",
        }));
        builder.onResolve({ filter: /tlsn-target-approval\.json\.txt$/ }, () => ({
          path: "target-approval",
          namespace: "production-trust-fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "production-trust-fixture" }, (args) => ({
          contents: args.path === "origin-inventory" ? inventoryRaw : approvalRaw,
          loader: "text",
        }));
        builder.onLoad({ filter: /\/src\/index\.ts$/ }, async (args) => ({
          contents: await patchWorkerSource(args.path),
          resolveDir: dirname(args.path),
          loader: "ts",
        }));
      },
    }],
  });
  await build({
    entryPoints: [dispatcherSourcePath],
    outfile: dispatcherPath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers", "./wasm/fusou_tlsn_verifier_bg.wasm"],
    logLevel: "silent",
  });
  const wasmPath = join(workerRoot, "src/wasm/fusou_tlsn_verifier_bg.wasm");
  const wasmModule = {
    type: "CompiledWasm",
    path: "wasm/fusou_tlsn_verifier_bg.wasm",
    contents: await readFile(wasmPath),
  };
  const workerModules = [
    { type: "ESModule", path: bundlePath, contents: await readFile(bundlePath, "utf8") },
    wasmModule,
  ];
  const dispatcherModules = [
    { type: "ESModule", path: dispatcherPath, contents: await readFile(dispatcherPath, "utf8") },
    wasmModule,
  ];
  return {
    runtimeRoot,
    workerModules,
    dispatcherModules,
    dispatchToken,
    workerSourcePatched: typeof patchedIndexSource === "string",
    wasmSha256: sha256(await readFile(wasmPath)),
  };
}

async function startRuntime(run, serviceCertificate) {
  const config = await readJson(join(run, "local-test-config.json"));
  const workerEnvironment = parseEnvFile(await readFile(join(run, "worker.env"), "utf8"));
  const trustSummary = await readJson(join(run, "production-trust-summary.json"));
  if (
    workerEnvironment.TLSN_ENVIRONMENT !== "production" ||
    workerEnvironment.TLSN_DEPLOYMENT_ROLE !== "production" ||
    workerEnvironment.TLSN_PRODUCTION_EXECUTION_MODE !== "queue" ||
    workerEnvironment.TLSN_TRUST_ROOT_CERTIFICATE_DER !== undefined ||
    workerEnvironment.TLSN_CANDIDATE_SERVER_IDENTITY !== undefined ||
    !["127.0.0.1", "localhost"].includes(new URL(config.worker_url).hostname)
  ) {
    throw new Error("local Production runtime must use the Queue role without a trust-root or static target binding");
  }
  const workerUrl = new URL(config.worker_url);
  const workerPort = Number(workerUrl.port);
  const supabaseUrl = new URL(config.supabase_url);
  const allowedOrigins = new Set([
    "https://supabase.fusou.test",
    "https://tlsn-web.fusou.test",
  ]);
  if (!["127.0.0.1", "localhost"].includes(supabaseUrl.hostname)) {
    throw new Error("Worker outbound Supabase relay must use the loopback Supabase project");
  }
  const bundle = await buildWorkerBundle(run);
  const bindings = {
    ...workerEnvironment,
    CF_VERSION_METADATA: { id: randomUUID(), tag: "local-queue", timestamp: new Date().toISOString() },
    TLSN_LOCAL_PRODUCTION_QUEUE_TEST_OBSERVATIONS: "true",
    TLSN_LOCAL_PRODUCTION_QUEUE_TEST_DELIVERY_MODE: "actual_queue",
    TLSN_LOCAL_PRODUCTION_QUEUE_BARRIER_ENABLED: "true",
  };
  const queueBarrier = createQueueBarrier();
  const adminToken = randomBytes(32).toString("base64url");
  const outboundService = (request) => {
    const url = new URL(request.url);
    if (url.hostname === "queue-barrier.invalid") {
      return fetch("http://127.0.0.1:19004/barrier/hold", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ job_id: url.searchParams.get("job_id") }),
      });
    }
    return outboundOverVerifiedTls(request, allowedOrigins, serviceCertificate);
  };
  const workerOptions = {
    name: workerName,
    rootPath: bundle.runtimeRoot,
    modules: bundle.workerModules,
    modulesRoot: bundle.runtimeRoot,
    compatibilityDate: "2026-09-07",
    compatibilityFlags: ["nodejs_compat"],
    bindings,
    unsafeEphemeralDurableObjects: false,
    durableObjects: {
      TLSN_BINDINGS: {
        className: "TlsnBindingAuthorityDurableObject",
        scriptName: workerName,
        unsafeUniqueKey: "fusou-tlsn-local-production-queue-v1",
        useSQLite: true,
      },
    },
    r2Buckets: { TLSN_PRESENTATIONS: "fusou-tlsn-local-production-queue-r2" },
    queueProducers: { TLSN_VERIFICATION_QUEUE: queueName },
    queueConsumers: {
      [queueName]: {
        maxBatchSize: 10,
        maxBatchTimeout: 30,
        maxRetries: 3,
      },
    },
    serviceBindings: {
      TLSN_LOCAL_PRODUCTION_QUEUE_DISPATCHER: { name: dispatcherName },
    },
    outboundService,
  };
  const dispatcherOptions = {
    name: dispatcherName,
    rootPath: bundle.runtimeRoot,
    modules: bundle.dispatcherModules,
    modulesRoot: bundle.runtimeRoot,
    compatibilityDate: "2026-09-07",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      ...bindings,
      TLSN_LOCAL_PRODUCTION_DISPATCH_TOKEN: bundle.dispatchToken,
      TLSN_LOCAL_PRODUCTION_QUEUE_TEST_DELIVERY_MODE: "controlled_dispatch",
    },
    durableObjects: {
      TLSN_BINDINGS: {
        className: "TlsnBindingAuthorityDurableObject",
        scriptName: workerName,
      },
    },
    r2Buckets: { TLSN_PRESENTATIONS: "fusou-tlsn-local-production-queue-r2" },
    outboundService,
  };
  const options = convertV4MiniflareOptions({
    rootPath: bundle.runtimeRoot,
    host: "127.0.0.1",
    port: workerPort,
    resourcePersistencePath: join(bundle.runtimeRoot, "persistent"),
    isolatedResourcePersistencePath: join(bundle.runtimeRoot, "isolated"),
    resourceTmpPath: join(bundle.runtimeRoot, "resource-tmp"),
    telemetry: { enabled: false },
    workers: [workerOptions, dispatcherOptions],
  });
  const miniflare = new Miniflare(options);
  await miniflare.ready;
  const bindingsForAdmin = await miniflare.getBindings(workerName);
  if (
    !bindingsForAdmin.TLSN_VERIFICATION_QUEUE ||
    !bindingsForAdmin.TLSN_LOCAL_PRODUCTION_QUEUE_DISPATCHER
  ) {
    await miniflare.dispose();
    throw new Error("Miniflare did not create the Production Queue or test synchronization binding");
  }
  const queue = await miniflare.getQueueProducer("TLSN_VERIFICATION_QUEUE", workerName);
  const namespace = await miniflare.getDurableObjectNamespace("TLSN_BINDINGS", workerName);
  const bucket = await miniflare.getR2Bucket("TLSN_PRESENTATIONS", workerName);
  return {
    config,
    trustSummary,
    miniflare,
    queue,
    namespace,
    bucket,
    dispatcher: bindingsForAdmin.TLSN_LOCAL_PRODUCTION_QUEUE_DISPATCHER,
    barrier: queueBarrier,
    adminToken,
    dispatchToken: bundle.dispatchToken,
    wasmSha256: bundle.wasmSha256,
  };
}

async function readRequestBody(request, maximumBytes = 64 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBytes) throw new Error("local harness request exceeded its body limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function secureEqual(left, right) {
  const actual = Buffer.from(left ?? "");
  const expected = Buffer.from(right ?? "");
  return actual.length === expected.length && actual.length > 0 && timingSafeEqual(actual, expected);
}

async function r2Objects(bucket) {
  const listing = await bucket.list({ prefix: "tlsn-verification/", limit: 1000 });
  const objects = [];
  for (const entry of listing.objects) {
    const object = await bucket.get(entry.key);
    if (!object) continue;
    const bytes = Buffer.from(await object.arrayBuffer());
    objects.push({
      key: entry.key,
      size: bytes.length,
      sha256: sha256(bytes),
    });
  }
  return objects.sort((left, right) => left.key.localeCompare(right.key));
}

async function inspectJob(runtime, input) {
  const stub = runtime.namespace.getByName(input.binding_id);
  const response = await stub.fetch("https://binding.internal/job", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: input.session_id,
      canonical_user_id: input.canonical_user_id,
      device_id: input.device_id,
      verification_job_id: input.job_id,
      now: Date.now(),
    }),
  });
  const authorityBody = await response.json();
  if (!response.ok || authorityBody?.ok !== true) throw new Error("Production Binding Authority lookup failed");
  const record = authorityBody.record;
  return {
    job_id: input.job_id,
    status: record.status,
    verification_failure_code: record.verification_failure_code ?? null,
    verification_attempt_id: record.verification_attempt_id ?? null,
    verification_lease_expires_at: record.verification_lease_expires_at ?? null,
    presentation_id: record.presentation_id ?? null,
    verification_input_key: record.verification_input_key ?? null,
    verification_result_key: record.verification_result_key ?? null,
    result_sha256: record.result_sha256 ?? null,
    result_object_key: record.result_object_key ?? null,
    objects: await r2Objects(runtime.bucket),
  };
}

async function startAdminServer(run, runtime, token) {
  await writePrivateFile(join(run, "production-queue-admin-token"), `${token}\n`);
  const server = http.createServer((request, response) => {
    void (async () => {
      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, worker: workerName, queue: queueName }));
        return;
      }
      if (!secureEqual(request.headers.authorization?.replace(/^Bearer /, ""), token)) {
        response.writeHead(401).end();
        return;
      }
      const body = JSON.parse(await readRequestBody(request));
      if (request.method === "POST" && request.url === "/barrier/hold") {
        const barrierResponse = await runtime.barrier.fetch(
          `https://queue-barrier.invalid/hold?job_id=${encodeURIComponent(body.job_id)}`,
          { method: "POST" },
        );
        response.writeHead(barrierResponse.status, { "Content-Type": "text/plain" });
        response.end(await barrierResponse.text());
        return;
      }
      if (request.method === "POST" && request.url === "/dispatch") {
        if (!body.message || typeof body.message !== "object" || Array.isArray(body.message)) {
          response.writeHead(400).end();
          return;
        }
        const dispatched = await runtime.dispatcher.fetch("http://queue-dispatcher/dispatch", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${runtime.dispatchToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: body.message, attempts: 1 }),
        });
        response.writeHead(dispatched.status, { "Content-Type": "application/json" });
        response.end(await dispatched.text());
        return;
      }
      if (request.method === "POST" && request.url === "/inspect") {
        const snapshot = await inspectJob(runtime, body);
        const metrics = await runtime.queue.metrics();
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ...snapshot, queue_backlog_count: metrics.backlogCount }));
        return;
      }
      if (request.method === "POST" && request.url === "/barrier/status") {
        const barrierResponse = await runtime.barrier.fetch(
          `https://queue-barrier.invalid/status?job_id=${encodeURIComponent(body.job_id)}`,
        );
        response.writeHead(barrierResponse.status, { "Content-Type": "application/json" });
        response.end(await barrierResponse.text());
        return;
      }
      if (request.method === "POST" && request.url === "/barrier/release") {
        const barrierResponse = await runtime.barrier.fetch(
          `https://queue-barrier.invalid/release?job_id=${encodeURIComponent(body.job_id)}`,
          { method: "POST" },
        );
        response.writeHead(barrierResponse.status, { "Content-Type": "application/json" });
        response.end(await barrierResponse.text());
        return;
      }
      response.writeHead(404).end();
    })().catch((error) => {
      console.error(JSON.stringify({
        event: "local-production-queue-admin-error",
        error: error instanceof Error ? error.message : "unknown",
      }));
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(19004, "127.0.0.1", resolveListen);
  });
  return { server, token };
}

async function serve() {
  const run = runDirectory();
  const serviceCertificate = await readFile(join(run, "service-relay.crt"));
  const config = await readJson(join(run, "local-test-config.json"));
  const serviceRelay = await startServiceRelay(run, config.supabase_url, serviceCertificate);
  const stopObservationLogCapture = startQueueObservationLogCapture(run);
  let runtime;
  let admin;
  try {
    runtime = await startRuntime(run, serviceCertificate);
    admin = await startAdminServer(run, runtime, runtime.adminToken);
    process.stdout.write(JSON.stringify({
      event: "local-production-queue-worker-ready",
      worker_url: runtime.config.worker_url,
      admin_url: "http://127.0.0.1:19004",
      execution_mode: "queue",
      outbound_origins: "loopback-only-over-verified-local-tls",
      wasm_sha256: runtime.wasmSha256,
    }) + "\n");
    await new Promise((resolveClose) => {
      let closing = false;
      const close = async () => {
        if (closing) return;
        closing = true;
        if (admin) await new Promise((resolveServer) => admin.server.close(resolveServer));
        serviceRelay.close();
        await runtime.miniflare.dispose();
        stopObservationLogCapture();
        resolveClose();
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    });
  } catch (error) {
    serviceRelay.close();
    if (runtime) await runtime.miniflare.dispose();
    stopObservationLogCapture();
    throw error;
  }
}

async function serveWeb() {
  const run = runDirectory();
  const webRoot = resolve(coordinatorRoot, "../FUSOU-WEB");
  const webEnvironment = parseEnvFile(await readFile(join(run, "web.env"), "utf8"));
  if (!webEnvironment.SUPABASE_URL || !webEnvironment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("the task-owned WEB environment is incomplete");
  }
  webEnvironment.PUBLIC_SITE_URL = "https://tlsn-web.fusou.test";
  const webEnvironmentFile = join(run, "web-local-production.env");
  await writePrivateFile(webEnvironmentFile, envText(webEnvironment));
  const generatedConfig = readAndValidateTestplayBuiltConfig();
  const serverDirectory = resolve(webRoot, "dist-tlsn-testplay/server");
  const localConfig = {
    ...generatedConfig,
    main: resolve(serverDirectory, generatedConfig.main),
    assets: {
      ...generatedConfig.assets,
      directory: resolve(serverDirectory, generatedConfig.assets.directory),
    },
    workers_dev: true,
    vars: {
      ...generatedConfig.vars,
      PUBLIC_SITE_URL: webEnvironment.PUBLIC_SITE_URL,
    },
  };
  delete localConfig.routes;
  const localConfigPath = join(run, "wrangler.local-production-queue.json");
  await writePrivateFile(localConfigPath, `${JSON.stringify(localConfig)}\n`);
  const wranglerCwd = join(run, "wrangler-cwd");
  const persistPath = join(run, "web-wrangler-persist");
  await mkdir(wranglerCwd, { recursive: true, mode: 0o700 });
  await mkdir(persistPath, { recursive: true, mode: 0o700 });
  const safeEnvironment = {};
  for (const key of ["HOME", "PATH", "TMP", "TEMP", "TMPDIR", "PNPM_HOME", "COREPACK_HOME"]) {
    if (process.env[key]) safeEnvironment[key] = process.env[key];
  }
  Object.assign(safeEnvironment, {
    CI: "true",
    NO_COLOR: "1",
    WRANGLER_SEND_METRICS: "false",
    CLOUDFLARE_CF_FETCH_ENABLED: "false",
  });
  const args = [
    "exec",
    "wrangler",
    "dev",
    "--config",
    localConfigPath,
    "--cwd",
    wranglerCwd,
    "--env-file",
    webEnvironmentFile,
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    "8788",
    "--persist-to",
    persistPath,
    "--log-level",
    "warn",
    "--show-interactive-dev-session=false",
  ];
  const child = spawn("pnpm", args, { cwd: webRoot, env: safeEnvironment, stdio: "inherit" });
  process.stdout.write(JSON.stringify({
    event: "local-isolated-web-starting",
    listen: "127.0.0.1:8788",
    wrangler_config: localConfigPath,
    private_env_file: webEnvironmentFile,
    dotenv_search_directory: wranglerCwd,
    remote_bindings: false,
    cloudflare_cf_fetch_enabled:
      safeEnvironment.CLOUDFLARE_CF_FETCH_ENABLED !== "false",
  }) + "\n");
  await new Promise((resolveExit, rejectExit) => {
    let shuttingDown = false;
    const stop = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      if (shuttingDown || code === 0) resolveExit();
      else rejectExit(new Error(`local WEB exited with ${code ?? signal ?? "unknown status"}`));
    });
  });
}

async function requireIdentity(config) {
  const identity = await readJson(config.identity_file);
  if (!identity?.access_token || !identity?.device_private_key_pkcs8) {
    throw new Error("a signed-in local Auth user and registered device are required");
  }
  return identity;
}

async function requireSession(config, sessionId) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId ?? "")) throw new Error("a fresh Worker Session ID is required");
  const session = await readJson(join(config.sessions_directory, `${sessionId}.json`));
  if (Date.parse(session.expires_at) <= Date.now()) throw new Error("Worker Session has expired");
  return session;
}

async function submitPresentation(sessionId) {
  const run = runDirectory();
  const config = await readJson(join(run, "local-test-config.json"));
  const identity = await requireIdentity(config);
  const session = await requireSession(config, sessionId);
  const presentationPath = join(run, "production-local-ca-presentation.bin");
  const presentation = await readFile(presentationPath);
  if (!presentation.length) throw new Error("Complete Presentation is empty");
  const challenge = Buffer.from(session.device_challenge, "base64url");
  const privateKey = createPrivateKey({
    key: Buffer.from(identity.device_private_key_pkcs8, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  const possessionBytes = tlsnDeviceProofSigningBytes({
    device_id: identity.device_id,
    session_id: session.session_id,
    binding_value: session.binding,
  }, challenge);
  const deviceProof = {
    challenge: session.device_challenge,
    sig: sign(null, Buffer.from(possessionBytes), privateKey).toString("base64"),
  };
  const response = await fetch(`${config.worker_url}/verify/tlsn`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${identity.access_token}`,
      apikey: config.supabase_anon_key,
      "Content-Type": "application/json",
      "X-FUSOU-TLSN-Response-Mode": "async",
    },
    body: JSON.stringify({
      presentation_base64: presentation.toString("base64url"),
      session_id: session.session_id,
      binding: session.binding,
      device_id: identity.device_id,
      device_proof: deviceProof,
    }),
    redirect: "manual",
  });
  const body = await response.json();
  if (response.status !== 202 || body?.status !== "queued" || typeof body.job_id !== "string") {
    throw new Error(`/verify/tlsn returned HTTP ${response.status}${body?.error ? ` (${body.error})` : ""}`);
  }
  const bindingId = sha256(Buffer.from(session.binding));
  await writeJsonPrivate(join(run, "production-queue-job.json"), {
    schema_version: 1,
    job_id: body.job_id,
    session_id: session.session_id,
    canonical_user_id: identity.user_id,
    device_id: identity.device_id,
    binding_id: bindingId,
    presentation_sha256: sha256(presentation),
    presentation_bytes: presentation.length,
    session_file: join(config.sessions_directory, `${session.session_id}.json`),
  });
  process.stdout.write(JSON.stringify({
    http_status: response.status,
    status: body.status,
    job_id: body.job_id,
    presentation_bytes: presentation.length,
    presentation_sha256: sha256(presentation),
    same_session_as_fixture: true,
  }) + "\n");
}

async function adminRequest(run, path, body) {
  const token = (await readFile(join(run, "production-queue-admin-token"), "utf8")).trim();
  const response = await fetch(`http://127.0.0.1:19004${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`local Production Queue admin returned HTTP ${response.status}`);
  return result;
}

async function loadJobInputs(run) {
  const config = await readJson(join(run, "local-test-config.json"));
  const job = await readJson(join(run, "production-queue-job.json"));
  const session = await readJson(job.session_file);
  const trust = await readJson(join(run, "production-trust-summary.json"));
  return { config, job, session, trust };
}

function queueMessage(job, session, trust, record) {
  return {
    job_id: job.job_id,
    binding_id: job.binding_id,
    session_id: job.session_id,
    canonical_user_id: job.canonical_user_id,
    device_id: job.device_id,
    device_challenge: session.device_challenge,
    verification_input_source: "r2",
    verification_input_key: record.verification_input_key,
    verification_result_key: record.verification_result_key,
    origin_policy: "inventory",
    deployment_role: "production",
    origin_inventory_sha256: trust.origin_inventory_sha256,
    target_approval_artifact_sha256: trust.target_approval_artifact_sha256,
    security_registry_set_sha256: trust.security_registry_set_sha256,
    profile: "complete",
    disclosure_mode: "full",
    message_type: "tlsn-verification-v1",
    presentation_id: record.presentation_id,
  };
}

async function inspectFromAdmin(run, job) {
  return adminRequest(run, "/inspect", job);
}

function comparableState(snapshot) {
  return JSON.stringify({
    status: snapshot.status,
    verification_failure_code: snapshot.verification_failure_code,
    verification_attempt_id: snapshot.verification_attempt_id,
    verification_lease_expires_at: snapshot.verification_lease_expires_at,
    presentation_id: snapshot.presentation_id,
    verification_input_key: snapshot.verification_input_key,
    verification_result_key: snapshot.verification_result_key,
    result_sha256: snapshot.result_sha256,
    result_object_key: snapshot.result_object_key,
    objects: snapshot.objects,
  });
}

async function dispatchMessage(run, message) {
  const response = await adminRequest(run, "/dispatch", { message });
  if (response.disposition !== "ack") {
    throw new Error(`mismatched Queue delivery was not acknowledged: ${response.disposition}`);
  }
  return response;
}

function mismatchedMessages(message) {
  const wrongDigest = sha256(Buffer.from(randomUUID()));
  const otherJob = randomUUID();
  const otherBinding = sha256(Buffer.from(randomUUID()));
  const otherPathJob = randomUUID();
  const roleMismatch = { ...message };
  delete roleMismatch.origin_inventory_sha256;
  delete roleMismatch.target_approval_artifact_sha256;
  roleMismatch.deployment_role = "canary";
  roleMismatch.origin_policy = "fixed";
  const wrongSchemaOrigin = { ...message, origin_policy: "fixed" };
  return [
    ["deployment-role", roleMismatch],
    ["origin-policy", wrongSchemaOrigin],
    ["origin-inventory-digest", { ...message, origin_inventory_sha256: wrongDigest }],
    ["target-approval-digest", { ...message, target_approval_artifact_sha256: wrongDigest }],
    ["security-registry-set-digest", { ...message, security_registry_set_sha256: wrongDigest }],
    ["binding-id", { ...message, binding_id: otherBinding }],
    ["session-id", { ...message, session_id: randomUUID() }],
    ["owner-id", { ...message, canonical_user_id: randomUUID() }],
    ["device-id", { ...message, device_id: randomUUID() }],
    ["job-id", {
      ...message,
      job_id: otherJob,
      verification_input_key: `tlsn-verification/${otherJob}/presentation.bin`,
      verification_result_key: `tlsn-verification/${otherJob}/result.json`,
    }],
    ["presentation-id", { ...message, presentation_id: wrongDigest }],
    ["input-key", {
      ...message,
      verification_input_key: `tlsn-verification/${otherPathJob}/presentation.bin`,
    }],
    ["result-key", {
      ...message,
      verification_result_key: `tlsn-verification/${otherPathJob}/result.json`,
    }],
  ];
}

async function runMismatches(jobId, phase) {
  if (!["processing", "lease"].includes(phase)) {
    throw new Error("mismatch phase must be processing or lease");
  }
  const run = runDirectory();
  const { job, session, trust } = await loadJobInputs(run);
  if (job.job_id !== jobId) throw new Error("job ID does not match the saved fresh Session");

  if (phase === "lease") {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const barrier = await adminRequest(run, "/barrier/status", { job_id: jobId });
      if (barrier.held === true) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    const held = await adminRequest(run, "/barrier/status", { job_id: jobId });
    if (held.held !== true) throw new Error("actual Queue consumer did not reach the lease synchronization point");
  }

  let baseline = await inspectFromAdmin(run, job);
  if (phase === "processing") {
    if (
      baseline.status !== "processing" ||
      typeof baseline.queue_backlog_count !== "number" ||
      baseline.queue_backlog_count < 1
    ) {
      throw new Error("the real queue delivery was not held while the DO job was processing");
    }
  } else if (
    baseline.status !== "verifying" ||
    !baseline.verification_lease_expires_at ||
    Date.parse(baseline.verification_lease_expires_at) <= Date.now()
  ) {
    throw new Error("the real Queue consumer did not hold an active verification lease");
  }
  const message = queueMessage(job, session, trust, baseline);
  const validMessage = verificationQueueMessageSchema.safeParse(message);
  if (!validMessage.success) throw new Error("reconstructed Queue message does not satisfy the existing schema");
  const mismatchCases = mismatchedMessages(message);
  const casesForPhase = phase === "lease"
    ? mismatchCases.filter(([name]) => name === "job-id")
    : mismatchCases;
  const results = [];
  try {
    for (const [name, invalidMessage] of casesForPhase) {
      const delivery = await dispatchMessage(run, invalidMessage);
      const after = await inspectFromAdmin(run, job);
      if (comparableState(after) !== comparableState(baseline)) {
        throw new Error(`mismatched ${name} delivery changed the legitimate DO job or R2 objects`);
      }
      results.push({ mismatch: name, delivery: delivery.disposition, unchanged: true });
      baseline = after;
    }
  } finally {
    if (phase === "lease") await releaseBarrier(jobId);
  }
  process.stdout.write(JSON.stringify({
    phase,
    job_id: jobId,
    legitimate_job_status: baseline.status,
    active_lease_preserved: phase === "lease",
    mismatches: results,
    all_state_unchanged: results.every((result) => result.unchanged),
  }) + "\n");
}

async function health() {
  const run = runDirectory();
  const config = await readJson(join(run, "local-test-config.json"));
  const trust = await readJson(join(run, "production-trust-summary.json"));
  const response = await fetch(`${config.worker_url}/health`, { redirect: "manual" });
  const body = await response.json();
  if (
    response.status !== 200 ||
    body.ok !== true ||
    body.execution_mode !== "queue" ||
    body.execution_binding_configured !== true ||
    body.security_identity?.trust_contract_valid !== true ||
    body.origin_inventory_sha256 !== trust.origin_inventory_sha256 ||
    body.target_approval_artifact_sha256 !== trust.target_approval_artifact_sha256 ||
    body.security_registry_set_sha256 !== trust.security_registry_set_sha256
  ) {
    throw new Error("Production health did not validate the explicit Queue binding and pinned local trust contract");
  }
  process.stdout.write(JSON.stringify({
    http_status: response.status,
    ok: body.ok,
    execution_mode: body.execution_mode,
    execution_binding_configured: body.execution_binding_configured,
    trust_contract_valid: body.security_identity.trust_contract_valid,
    origin_inventory_sha256: body.origin_inventory_sha256,
    target_approval_artifact_sha256: body.target_approval_artifact_sha256,
    security_registry_set_sha256: body.security_registry_set_sha256,
    production_trust_root_bound: false,
  }) + "\n");
}

async function callbackProbe() {
  const run = runDirectory();
  const config = await readJson(join(run, "local-test-config.json"));
  const response = await fetch(`${config.worker_url}/internal/tlsn/verification-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    redirect: "manual",
  });
  const body = await response.json();
  if (response.status !== 404 || body?.error !== "not_found") {
    throw new Error("Queue-mode Worker did not reject the external completion callback route");
  }
  process.stdout.write(JSON.stringify({
    http_status: response.status,
    error: body.error,
    queue_mode_external_callback_rejected: true,
  }) + "\n");
}

async function status(jobId) {
  const run = runDirectory();
  const { config, job, session } = await loadJobInputs(run);
  if (job.job_id !== jobId) throw new Error("job ID does not match the saved Queue job");
  const identity = await requireIdentity(config);
  const deadline = Date.now() + 120_000;
  let response;
  let body;
  while (Date.now() < deadline) {
    response = await fetch(`${config.worker_url}/verify/tlsn/status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${identity.access_token}`,
        apikey: config.supabase_anon_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job_id: job.job_id,
        session_id: job.session_id,
        binding_id: job.binding_id,
        canonical_user_id: job.canonical_user_id,
        device_id: job.device_id,
        profile: "complete",
      }),
      redirect: "manual",
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    try {
      body = JSON.parse(bytes.toString("utf8"));
    } catch {
      body = null;
    }
    if (response.status === 200) break;
    if (response.status !== 202) throw new Error(`status endpoint returned unexpected HTTP ${response.status}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (response?.status !== 200 || body?.verified !== false || body?.status !== "not_verified") {
    throw new Error("Production Worker did not report the expected terminal unverified status");
  }
  const snapshot = await inspectFromAdmin(run, job);
  const successArchives = snapshot.objects.filter((object) => {
    const match = /^tlsn-verification\/([^/]+)\/(.+)$/.exec(object.key);
    return match !== null && (match[1] !== job.job_id || match[2] === "result.json");
  });
  if (
    snapshot.status !== "failed" ||
    snapshot.result_sha256 !== null ||
    successArchives.length > 0
  ) {
    throw new Error("Production certificate rejection created a Result or success archive");
  }
  await writeJsonPrivate(join(run, "production-queue-outcome.json"), {
    job_id: jobId,
    status_http_status: response.status,
    verified: body.verified,
    status: body.status,
    verification_failure_code: snapshot.verification_failure_code,
    result_sha256: snapshot.result_sha256,
    objects: snapshot.objects.map(({ key, size, sha256: digest }) => ({ key, size, sha256: digest })),
  });
  process.stdout.write(JSON.stringify({
    status_http_status: response.status,
    verified: body.verified,
    status: body.status,
    verification_failure_code: snapshot.verification_failure_code,
    result_committed: false,
    success_archive_object_count: successArchives.length,
    queue_backlog_count: snapshot.queue_backlog_count,
    r2_objects: snapshot.objects,
    session_matches: session.session_id === job.session_id,
  }) + "\n");
}

async function verifyLogs(jobId) {
  const run = runDirectory();
  const raw = await readFile(join(run, "production-worker.log"), "utf8");
  const observations = [];
  let unsafeObservationFound = false;
  for (const line of raw.split(/\r?\n/)) {
    const start = line.indexOf('{"event":"local-production-queue-');
    if (start < 0) continue;
    try {
      const event = JSON.parse(line.slice(start));
      if (!isSafeQueueObservationEvent(event)) {
        unsafeObservationFound = true;
        continue;
      }
      observations.push(event);
    } catch {
      unsafeObservationFound = true;
    }
  }
  const jobObservations = observations.filter((entry) => entry.job_id === jobId);
  const handlerObservations = observations.filter((entry) =>
    entry.event === "local-production-queue-handler"
  );
  const actualDeliveries = jobObservations.filter((entry) =>
    entry.event === "local-production-queue-handler" &&
    entry.delivery === "actual_queue"
  );
  const controlledDeliveries = handlerObservations.filter((entry) =>
    entry.delivery === "controlled_dispatch"
  );
  const failure = jobObservations.find((entry) =>
    entry.event === "local-production-queue-verification-failure"
  );
  const wasmCallFailures = jobObservations.filter((entry) =>
    entry.event === "local-production-queue-wasm-call-failure"
  );
  const wasmCallFailure = wasmCallFailures[0];
  if (
    unsafeObservationFound ||
    actualDeliveries.length < 1 ||
    controlledDeliveries.length < 13 ||
    failure?.stage !== "wasm_verification" ||
    !hasExactFields(
      failure,
      safeQueueObservationFields["local-production-queue-verification-failure"],
    ) ||
    wasmCallFailures.length !== 1 ||
    ![
      "inspect_alpha15_server_identity",
      "result_generation_verification",
    ].includes(wasmCallFailure?.wasm_call) ||
    !["wasm_string", "javascript_error", "other_value"].includes(wasmCallFailure?.exception_kind) ||
    !["certificate_path_invalid", "server_name_invalid", "unknown"].includes(wasmCallFailure?.diagnostic_code) ||
    !hasExactFields(
      wasmCallFailure,
      safeQueueObservationFields["local-production-queue-wasm-call-failure"],
    )
  ) {
    throw new Error("Worker log does not prove actual Queue delivery and a safely classified WASM call failure");
  }
  process.stdout.write(JSON.stringify({
    job_id: jobId,
    actual_queue_deliveries: actualDeliveries.length,
    controlled_queue_handler_deliveries: controlledDeliveries.length,
    failure_stage: failure.stage,
    failure_code: failure.failure_code,
    wasm_call: wasmCallFailure.wasm_call,
    exception_kind: wasmCallFailure.exception_kind,
    diagnostic_code: wasmCallFailure.diagnostic_code,
    wasm_stage_reached: true,
  }) + "\n");
}

async function releaseBarrier(jobId) {
  const run = runDirectory();
  const result = await adminRequest(run, "/barrier/release", { job_id: jobId });
  if (result.released !== true) throw new Error("Production Queue lease barrier was not held");
  process.stdout.write(JSON.stringify({ job_id: jobId, barrier_released: true }) + "\n");
}

const [command, firstArgument, secondArgument] = process.argv.slice(2);
try {
  if (command === "configure") {
    await configure();
  } else if (command === "build-notary") {
    await buildNotary();
  } else if (command === "prepare-fixture-credentials") {
    await prepareFixtureCredentials();
  } else if (command === "prepare-fixture") {
    await prepareFixture();
  } else if (command === "inspect-wasm") {
    await inspectPresentationWithProductionWasm();
  } else if (command === "diagnostic-tests") {
    await testWasmExceptionClassification();
  } else if (command === "serve-web") {
    await serveWeb();
  } else if (command === "serve") {
    await serve();
  } else if (command === "health") {
    await health();
  } else if (command === "callback-probe") {
    await callbackProbe();
  } else if (command === "submit" && firstArgument) {
    await submitPresentation(firstArgument);
  } else if (command === "mismatches" && firstArgument && secondArgument) {
    await runMismatches(firstArgument, secondArgument);
  } else if (command === "status" && firstArgument) {
    await status(firstArgument);
  } else if (command === "verify-logs" && firstArgument) {
    await verifyLogs(firstArgument);
  } else if (command === "release" && firstArgument) {
    await releaseBarrier(firstArgument);
  } else {
    console.error("Usage: local-production-queue-test.mjs <prepare-fixture-credentials|configure|build-notary|prepare-fixture|inspect-wasm|diagnostic-tests|serve-web|serve|health|callback-probe|submit SESSION_ID|mismatches JOB_ID processing|mismatches JOB_ID lease|status JOB_ID|verify-logs JOB_ID|release JOB_ID>");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(JSON.stringify({
    command: command ?? null,
    error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
  }));
  process.exitCode = 1;
}
