import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attestationConsumeReceiptSigningBytes,
  attestationSessionReceiptSigningBytes,
} from "../src/attestation_receipts.ts";
import { tlsnDeviceProofSigningBytes } from "../src/device-proof-framing.ts";
import {
  derive_verifier_result_signing_bytes,
  initSync as initVerifierWasm,
} from "../src/wasm/fusou_tlsn_verifier.js";
import {
  assertSignedResultRegistryEnvelope,
  createSignedResultRegistryEnvelope,
} from "./result-registry-envelope.mjs";
import { profilesForServerIdentity } from "./profile-canonical-contract.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const runDirectory = process.env.FUSOU_LOCAL_TEST_RUN_DIR;
const configPath = process.env.FUSOU_LOCAL_TEST_CONFIG ?? (
  runDirectory ? join(runDirectory, "local-test-config.json") : undefined
);
const identityPath = process.env.FUSOU_LOCAL_DEVICE_IDENTITY;
const expectationsPath = process.env.FUSOU_LOCAL_TRIGGER_EXPECTATIONS;
const triggerStatePath = process.env.FUSOU_LOCAL_TRIGGER_STATE;
const serverIdentity = "game.example.test";
const webBase = process.env.FUSOU_LOCAL_WEB_URL ?? "http://127.0.0.1:8788";
const workerBase = process.env.FUSOU_LOCAL_WORKER_URL ?? "http://127.0.0.1:8787";
const triggerTaskId = "tlsn-local-verify";
const notaryKeyId = "fixture-k256";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function parseEnvFile(raw) {
  const entries = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) throw new Error("Supabase status environment file is malformed");
    entries[line.slice(0, equals)] = line.slice(equals + 1).replace(/^['"]|['"]$/g, "");
  }
  return entries;
}

function generateEd25519Key() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKeyPkcs8: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    publicKeySpki: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

function signingKeyRegistry(scope, keyId, publicKeySpki, notBefore) {
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

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function requireConfigPath() {
  if (!configPath) throw new Error("FUSOU_LOCAL_TEST_CONFIG or FUSOU_LOCAL_TEST_RUN_DIR is required");
  return resolve(configPath);
}

async function configure() {
  if (!runDirectory || !process.env.FUSOU_SUPABASE_STATUS_ENV) {
    throw new Error("configure requires FUSOU_LOCAL_TEST_RUN_DIR and FUSOU_SUPABASE_STATUS_ENV");
  }
  const run = resolve(runDirectory);
  await mkdir(run, { recursive: true, mode: 0o700 });
  const status = parseEnvFile(await readFile(process.env.FUSOU_SUPABASE_STATUS_ENV, "utf8"));
  const apiUrl = status.API_URL;
  const databaseUrl = new URL(status.DB_URL);
  if (
    !apiUrl ||
    !["127.0.0.1", "localhost"].includes(new URL(apiUrl).hostname) ||
    !["127.0.0.1", "localhost"].includes(databaseUrl.hostname) ||
    !status.ANON_KEY ||
    !status.PUBLISHABLE_KEY ||
    !status.SERVICE_ROLE_KEY
  ) {
    throw new Error("Supabase status must provide loopback API/DB URLs and local Auth keys");
  }

  const credentialsDirectory = join(run, "tlsn-credentials");
  const rootDer = await readFile(join(credentialsDirectory, "origin-root.der"));
  const notaryKey = await readFile(join(run, "notary-key.bin"));
  if (rootDer.length === 0 || notaryKey.length === 0) {
    throw new Error("test CA and Notary public key must be prepared before configuration");
  }
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60_000).toISOString();
  const sessionAuthority = generateEd25519Key();
  const bindingAuthority = generateEd25519Key();
  const resultSigner = generateEd25519Key();
  const resultRegistryRoot = generateEd25519Key();
  const sessionAuthorityKeyId = "local-session-authority-v1";
  const bindingAuthorityKeyId = "local-binding-authority-v1";
  const resultSignerKeyId = "local-result-signer-v1";
  const resultRegistryRootKeyId = "local-result-registry-root-v1";
  const profile = profilesForServerIdentity(serverIdentity);
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

  const deviceAuthUrl = `${webBase}/api/auth/anonymous-sync/v2/device-proof`;
  const devicePossessionAuthUrl = `${webBase}/api/auth/anonymous-sync/v2/tlsn-device-proof`;
  const triggerSecret = randomBytes(32).toString("base64url");
  const callbackSecret = randomBytes(32).toString("base64url");
  const workerEnv = {
    TLSN_ENVIRONMENT: "test",
    TLSN_DEPLOYMENT_ROLE: "test",
    TLSN_EXECUTION_MODE: "trigger",
    TLSN_TRIGGER_API_URL: "http://127.0.0.1:19002",
    TLSN_TRIGGER_TASK_ID: triggerTaskId,
    TLSN_TRIGGER_SECRET_KEY: triggerSecret,
    TLSN_TRIGGER_CALLBACK_SECRET: callbackSecret,
    TLSN_SERVER_IDENTITY: serverIdentity,
    TLSN_PROFILE_SHA256: profile.complete.sha256,
    TLSN_VERIFIER_KEY_ID: "local-test-verifier-v1",
    TLSN_NOTARY_KEY_ID: notaryKeyId,
    TLSN_NOTARY_REGISTRY: JSON.stringify({
      [notaryKeyId]: notaryKey.toString("base64url"),
    }),
    TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8: resultSigner.privateKeyPkcs8,
    TLSN_RESULT_PUBLIC_KEY_SPKI: resultSigner.publicKeySpki,
    TLSN_RESULT_SIGNER_KEY_ID: resultSignerKeyId,
    TLSN_RESULT_SIGNING_KEY_REGISTRY: resultRegistryRaw,
    TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: sessionAuthority.privateKeyPkcs8,
    TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: sessionAuthority.publicKeySpki,
    TLSN_SESSION_AUTHORITY_KEY_ID: sessionAuthorityKeyId,
    TLSN_SESSION_AUTHORITY_KEY_REGISTRY: signingKeyRegistry(
      "tlsn-session-authority-key-registry",
      sessionAuthorityKeyId,
      sessionAuthority.publicKeySpki,
      notBefore,
    ),
    TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: bindingAuthority.privateKeyPkcs8,
    TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: bindingAuthority.publicKeySpki,
    TLSN_BINDING_AUTHORITY_KEY_ID: bindingAuthorityKeyId,
    TLSN_BINDING_AUTHORITY_KEY_REGISTRY: signingKeyRegistry(
      "tlsn-binding-authority-key-registry",
      bindingAuthorityKeyId,
      bindingAuthority.publicKeySpki,
      notBefore,
    ),
    TLSN_TRUST_ROOT_CERTIFICATE_DER: rootDer.toString("base64url"),
    TLSN_BINDING_TTL_SECONDS: "1800",
    TLSN_SUPABASE_URL: apiUrl,
    TLSN_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    TLSN_DEVICE_AUTH_URL: deviceAuthUrl,
    TLSN_DEVICE_POSSESSION_AUTH_URL: devicePossessionAuthUrl,
  };
  const webEnv = {
    SUPABASE_URL: apiUrl,
    SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    CHALLENGE_HMAC_SECRET: randomBytes(32).toString("base64url"),
    DATASET_TOKEN_SECRET: randomBytes(32).toString("base64url"),
    PUBLIC_SITE_URL: "https://tlsn-web.fusou.dev",
    PUBLIC_SUPABASE_URL: apiUrl,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  };
  const executorEnv = {
    FUSOU_LOCAL_WORKER_URL: workerBase,
    FUSOU_LOCAL_TRIGGER_HOST: "127.0.0.1",
    FUSOU_LOCAL_TRIGGER_PORT: "19002",
    FUSOU_LOCAL_TRIGGER_EXPECTATIONS: join(run, "trigger-expectations.json"),
    FUSOU_LOCAL_TRIGGER_STATE: join(run, "trigger-state.json"),
    FUSOU_LOCAL_TRIGGER_SECRET: triggerSecret,
    FUSOU_LOCAL_CALLBACK_SECRET: callbackSecret,
  };
  const clientConfig = {
    schema_version: 1,
    supabase_url: apiUrl,
    database_url: status.DB_URL,
    supabase_anon_key: status.ANON_KEY,
    supabase_publishable_key: status.PUBLISHABLE_KEY,
    supabase_service_role_key: status.SERVICE_ROLE_KEY,
    web_url: webBase,
    worker_url: workerBase,
    session_authority_key_id: sessionAuthorityKeyId,
    session_authority_public_key_spki: sessionAuthority.publicKeySpki,
    binding_authority_key_id: bindingAuthorityKeyId,
    binding_authority_public_key_spki: bindingAuthority.publicKeySpki,
    result_signer_key_id: resultSignerKeyId,
    result_public_key_spki: resultSigner.publicKeySpki,
    result_registry_root_key_id: resultRegistryRootKeyId,
    result_registry_root_public_key_spki: resultRegistryRoot.publicKeySpki,
    result_registry_envelope: resultRegistryEnvelope,
    profile_id: profile.complete.profile.id,
    profile_sha256: profile.complete.sha256,
    server_identity: serverIdentity,
    notary_key_id: notaryKeyId,
    notary_key_sha256: sha256(notaryKey),
    presentation_metadata_file: join(run, "presentation-metadata.json"),
    expected_file: executorEnv.FUSOU_LOCAL_TRIGGER_EXPECTATIONS,
    trigger_state_file: executorEnv.FUSOU_LOCAL_TRIGGER_STATE,
    r2_persist_path: join(run, "worker-persist"),
    r2_bucket_name: "fusou-tlsn-trigger-local",
    identity_file: join(run, "device-identity.json"),
    sessions_directory: join(run, "sessions"),
    jobs_directory: join(run, "jobs"),
  };
  const workerConfigDirectory = join(run, "worker-config");
  await mkdir(workerConfigDirectory, { recursive: true, mode: 0o700 });
  await symlink(resolve(scriptDirectory, "../src"), join(workerConfigDirectory, "src"), "dir");
  clientConfig.worker_config = join(workerConfigDirectory, "wrangler.local.toml");
  await writePrivateFile(clientConfig.worker_config, [
    'name = "fusou-tlsn-local-trigger-test"',
    'main = "src/index.ts"',
    'compatibility_date = "2026-09-07"',
    'compatibility_flags = ["nodejs_compat"]',
    "send_metrics = false",
    "",
    "[[rules]]",
    'type = "CompiledWasm"',
    'globs = ["**/*.wasm"]',
    "fallthrough = true",
    "",
    "[[durable_objects.bindings]]",
    'name = "TLSN_BINDINGS"',
    'class_name = "TlsnBindingAuthorityDurableObject"',
    "",
    "[[r2_buckets]]",
    'binding = "TLSN_PRESENTATIONS"',
    `bucket_name = "${clientConfig.r2_bucket_name}"`,
    "",
    "[[migrations]]",
    'tag = "v1"',
    'new_sqlite_classes = ["TlsnBindingAuthorityDurableObject"]',
    "",
  ].join("\n"));
  await writePrivateFile(join(run, "worker.env"), envText(workerEnv));
  await writePrivateFile(join(run, "web.env"), envText(webEnv));
  await writePrivateFile(join(run, "trigger.env"), envText(executorEnv));
  await writeJsonPrivate(requireConfigPath(), clientConfig);
  await writeJsonPrivate(executorEnv.FUSOU_LOCAL_TRIGGER_EXPECTATIONS, {});
  await writeJsonPrivate(executorEnv.FUSOU_LOCAL_TRIGGER_STATE, { schema_version: 1, jobs: {} });
  await mkdir(clientConfig.sessions_directory, { recursive: true, mode: 0o700 });
  await mkdir(clientConfig.jobs_directory, { recursive: true, mode: 0o700 });
  console.log(JSON.stringify({
    configured: true,
    web_url: webBase,
    worker_url: workerBase,
    environment: "test",
    execution_mode: "trigger",
    task_id: triggerTaskId,
    binding_mode: "random",
    notary_key_sha256: clientConfig.notary_key_sha256,
    result_registry_envelope_verified: true,
  }));
}

async function loadConfig() {
  const config = await readJson(requireConfigPath(), null);
  if (config?.schema_version !== 1) throw new Error("local test config is absent or invalid");
  return config;
}

function assertLoopbackUrl(value, label) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(`${label} must resolve to loopback`);
  }
  return url;
}

async function fetchJson(url, init, label) {
  const response = await fetch(url, { ...init, redirect: "manual" });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}${body?.error ? ` (${body.error})` : ""}`);
  }
  if (!body || typeof body !== "object") throw new Error(`${label} returned invalid JSON`);
  return { response, body, raw: Buffer.from(text) };
}

function pgPassEscape(value) {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function insertRegisteredDevice(config, userId, deviceId, publicKeyHex, apiMemberId) {
  const database = new URL(config.database_url);
  if (!["127.0.0.1", "localhost"].includes(database.hostname)) {
    throw new Error("test database connection is not loopback");
  }
  const passFile = join(dirname(identityPath ?? config.identity_file), "postgres.pgpass");
  const databaseName = decodeURIComponent(database.pathname.slice(1));
  const password = decodeURIComponent(database.password);
  await writePrivateFile(
    passFile,
    `${pgPassEscape(database.hostname)}:${database.port}:${pgPassEscape(databaseName)}:${pgPassEscape(decodeURIComponent(database.username))}:${pgPassEscape(password)}\n`,
  );
  const sql = `
WITH mapping AS (
  INSERT INTO public.member_id_mapping (api_member_id)
  VALUES (${sqlLiteral(apiMemberId)})
  RETURNING public_id
), user_mapping AS (
  INSERT INTO public.user_member_map (user_id, public_id)
  SELECT ${sqlLiteral(userId)}::uuid, public_id FROM mapping
  RETURNING public_id
), device AS (
  INSERT INTO public.user_devices (device_id, canonical_user_id, public_id, device_pubkey, pubkey_algo)
  SELECT ${sqlLiteral(deviceId)}::uuid, ${sqlLiteral(userId)}::uuid, public_id,
         decode(${sqlLiteral(publicKeyHex)}, 'hex'), 'ed25519'
  FROM user_mapping
  RETURNING device_id, canonical_user_id, public_id, device_pubkey, revoked_at
)
SELECT json_build_object(
  'device_id', device_id,
  'canonical_user_id', canonical_user_id,
  'public_id', public_id,
  'device_pubkey_hex', encode(device_pubkey, 'hex'),
  'active', revoked_at IS NULL
)::text
FROM device;
`;
  const result = spawnSync("psql", [
    "-h", database.hostname,
    "-p", database.port,
    "-U", decodeURIComponent(database.username),
    "-d", databaseName,
    "-X", "-A", "-t",
    "-v", "ON_ERROR_STOP=1",
  ], {
    encoding: "utf8",
    input: sql,
    env: { ...process.env, PGPASSFILE: passFile, PGCONNECT_TIMEOUT: "5" },
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 15_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`local test device registration failed${result.status === null ? "" : ` (${result.status})`}`);
  }
  const row = JSON.parse(result.stdout.trim());
  if (
    row.device_id !== deviceId ||
    row.canonical_user_id !== userId ||
    row.device_pubkey_hex !== publicKeyHex ||
    row.active !== true
  ) {
    throw new Error("registered local device row does not match the test user and key");
  }
  return row;
}

async function createUser() {
  const config = await loadConfig();
  assertLoopbackUrl(config.supabase_url, "Supabase URL");
  const email = `tlsn-trigger-${randomUUID()}@example.test`;
  const password = `${randomBytes(32).toString("base64url")}A9!`;
  const admin = await fetchJson(`${config.supabase_url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: config.supabase_service_role_key,
      Authorization: `Bearer ${config.supabase_service_role_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  }, "local Supabase Auth user creation");
  const userId = admin.body.id;
  if (
    typeof userId !== "string" ||
    admin.body.is_anonymous === true ||
    admin.body.email !== email
  ) {
    throw new Error("Supabase Auth did not create a non-anonymous test user");
  }
  const signedIn = await fetchJson(`${config.supabase_url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: config.supabase_anon_key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  }, "local Supabase Auth password sign-in");
  if (
    signedIn.body.user?.id !== userId ||
    signedIn.body.user?.is_anonymous !== false ||
    typeof signedIn.body.access_token !== "string"
  ) {
    throw new Error("Supabase Auth sign-in did not return the created non-anonymous user");
  }

  const devicePair = generateKeyPairSync("ed25519");
  const devicePrivateKeyPkcs8 = devicePair.privateKey.export({
    format: "der",
    type: "pkcs8",
  }).toString("base64url");
  const publicKeySpki = devicePair.publicKey.export({ format: "der", type: "spki" });
  const devicePublicKeyRaw = publicKeySpki.subarray(-32);
  const devicePublicKeyHex = devicePublicKeyRaw.toString("hex");
  const deviceId = randomUUID();
  const apiMemberId = String(100_000_000_000_000 + Math.floor(Math.random() * 899_999_999_999_999));
  await insertRegisteredDevice(config, userId, deviceId, devicePublicKeyHex, apiMemberId);
  await writeJsonPrivate(identityPath ?? config.identity_file, {
    schema_version: 1,
    email,
    password,
    access_token: signedIn.body.access_token,
    refresh_token: signedIn.body.refresh_token,
    user_id: userId,
    device_id: deviceId,
    device_private_key_pkcs8: devicePrivateKeyPkcs8,
    device_public_key_raw: devicePublicKeyRaw.toString("base64url"),
    api_member_id: apiMemberId,
    auth_signed_in: true,
  });
  console.log(JSON.stringify({
    auth_signed_in: true,
    anonymous: false,
    user_id: userId,
    device_id: deviceId,
    device_registered: true,
  }));
}

async function issueSession() {
  const config = await loadConfig();
  const identity = await readJson(identityPath ?? config.identity_file, null);
  if (!identity?.access_token || !identity?.device_private_key_pkcs8) {
    throw new Error("local test user and device must be prepared first");
  }
  const challengeResult = await fetchJson(
    `${config.web_url}/api/auth/anonymous-sync/v2/challenge?device_id=${encodeURIComponent(identity.device_id)}`,
    { method: "GET" },
    "WEB device challenge",
  );
  const nonce = challengeResult.body.nonce;
  if (typeof nonce !== "string" || !/^[a-f0-9]{64}$/.test(nonce)) {
    throw new Error("WEB returned an invalid device authentication nonce");
  }
  const devicePrivateKey = createPrivateKey({
    key: Buffer.from(identity.device_private_key_pkcs8, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  const authProof = {
    device_id: identity.device_id,
    nonce,
    sig: sign(null, Buffer.from(nonce, "utf8"), devicePrivateKey).toString("base64"),
  };
  const sessionResult = await fetchJson(`${config.worker_url}/attestation/session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${identity.access_token}`,
      apikey: config.supabase_anon_key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(authProof),
  }, "Worker Session issuance");
  if (sessionResult.response.status !== 201) {
    throw new Error(`Worker Session issuance returned HTTP ${sessionResult.response.status}`);
  }
  const session = sessionResult.body;
  const receipt = session.session_receipt;
  if (
    receipt?.signer_key_id !== config.session_authority_key_id ||
    receipt?.session_id !== session.session_id ||
    receipt?.canonical_user_id !== identity.user_id ||
    receipt?.device_id !== identity.device_id ||
    receipt?.device_auth_nonce !== nonce ||
    receipt?.nonce !== session.challenge ||
    receipt?.device_challenge !== session.device_challenge ||
    receipt?.binding_value !== session.binding
  ) {
    throw new Error("Worker Session receipt fields do not match the issued Session");
  }
  const receiptSigningBytes = attestationSessionReceiptSigningBytes({
    signerKeyId: receipt.signer_key_id,
    sessionId: receipt.session_id,
    canonicalUserId: receipt.canonical_user_id,
    deviceId: receipt.device_id,
    deviceAuthNonce: receipt.device_auth_nonce,
    nonce: receipt.nonce,
    deviceChallenge: receipt.device_challenge,
    bindingValue: receipt.binding_value,
    createdAt: receipt.created_at,
    expiresAt: receipt.expires_at,
  });
  const sessionAuthorityKey = createPublicKey({
    key: Buffer.from(config.session_authority_public_key_spki, "base64url"),
    format: "der",
    type: "spki",
  });
  if (!verify(
    null,
    Buffer.from(receiptSigningBytes),
    sessionAuthorityKey,
    Buffer.from(receipt.signature, "base64url"),
  )) {
    throw new Error("Worker Session receipt signature is invalid");
  }
  const sessionRecord = {
    ...session,
    canonical_user_id: identity.user_id,
    device_id: identity.device_id,
    device_auth_nonce: nonce,
    session_receipt_verified: true,
  };
  const sessionPath = join(config.sessions_directory, `${session.session_id}.json`);
  await writeJsonPrivate(sessionPath, sessionRecord);
  console.log(JSON.stringify({
    http_status: sessionResult.response.status,
    session_id: session.session_id,
    user_id: identity.user_id,
    device_id: identity.device_id,
    binding_sha256: sha256(Buffer.from(session.binding, "utf8")),
    grant_signature_verified_by_rust_fixture: false,
    session_receipt_signature_verified: true,
    expires_at: session.expires_at,
  }));
}

async function readTriggerState(config) {
  return readJson(config.trigger_state_file, { jobs: {} });
}

async function waitForTriggerJob(config, jobId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readTriggerState(config);
    if (state.jobs?.[jobId]) return state.jobs[jobId];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("local Trigger executor did not accept the Worker job");
}

async function postStatus(config, identity, session, jobId, bindingId) {
  return fetch(`${config.worker_url}/verify/tlsn/status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${identity.access_token}`,
      apikey: config.supabase_anon_key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      job_id: jobId,
      session_id: session.session_id,
      binding_id: bindingId,
      canonical_user_id: identity.user_id,
      device_id: identity.device_id,
      profile: "complete",
    }),
    redirect: "manual",
  });
}

async function submitPresentation(mode) {
  if (!["valid", "invalid-hmac", "corrupt"].includes(mode)) {
    throw new Error("submission mode must be valid, invalid-hmac, or corrupt");
  }
  const config = await loadConfig();
  const identity = await readJson(identityPath ?? config.identity_file, null);
  if (!identity?.access_token) throw new Error("local test user is absent");
  const sessionPath = process.env.FUSOU_LOCAL_SESSION_FILE;
  const session = await readJson(sessionPath, null);
  const sourcePath = process.env.FUSOU_LOCAL_PRESENTATION_FILE;
  if (!session?.session_id || !sourcePath) throw new Error("Session and Presentation files are required");
  if (Date.parse(session.expires_at) <= Date.now()) throw new Error("Worker Session has expired");
  const original = await readFile(sourcePath);
  if (original.length === 0) throw new Error("Complete Presentation is empty");
  const submitted = Buffer.from(original);
  if (mode === "corrupt") submitted[0] ^= 0x01;
  const presentationDigest = sha256(submitted);
  const sessionId = session.session_id;
  const expectations = await readJson(expectationsPath ?? config.expected_file, {});
  expectations[sessionId] = {
    sha256: presentationDigest,
    bytes: submitted.length,
    completion: mode === "invalid-hmac" ? "invalid-hmac" : "valid",
  };
  await writeJsonPrivate(expectationsPath ?? config.expected_file, expectations);
  const deviceChallenge = Buffer.from(session.device_challenge, "base64url");
  const privateKey = createPrivateKey({
    key: Buffer.from(identity.device_private_key_pkcs8, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  const possessionBytes = tlsnDeviceProofSigningBytes({
    device_id: identity.device_id,
    session_id: session.session_id,
    binding_value: session.binding,
  }, deviceChallenge);
  const possessionProof = {
    challenge: session.device_challenge,
    sig: sign(null, Buffer.from(possessionBytes), privateKey).toString("base64"),
  };
  const request = await fetch(`${config.worker_url}/verify/tlsn`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${identity.access_token}`,
      apikey: config.supabase_anon_key,
      "Content-Type": "application/json",
      "X-FUSOU-TLSN-Response-Mode": "async",
    },
    body: JSON.stringify({
      presentation_base64: submitted.toString("base64url"),
      session_id: session.session_id,
      binding: session.binding,
      device_id: identity.device_id,
      device_proof: possessionProof,
    }),
    redirect: "manual",
  });
  const responseText = await request.text();
  let responseBody;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    responseBody = null;
  }
  if (request.status !== 202 || typeof responseBody?.job_id !== "string") {
    throw new Error(`/verify/tlsn returned HTTP ${request.status}${responseBody?.error ? ` (${responseBody.error})` : ""}`);
  }
  const jobId = responseBody.job_id;
  const triggerJob = await waitForTriggerJob(config, jobId);
  const jobDirectory = join(config.jobs_directory, jobId);
  await mkdir(jobDirectory, { recursive: true, mode: 0o700 });
  await writePrivateFile(join(jobDirectory, "presentation.bin"), submitted);
  const jobRecord = {
    schema_version: 1,
    mode,
    job_id: jobId,
    session_id: sessionId,
    canonical_user_id: identity.user_id,
    device_id: identity.device_id,
    binding_value: session.binding,
    binding_id: triggerJob.binding_id,
    presentation_sha256: presentationDigest,
    presentation_bytes: submitted.length,
    verification_input_key: triggerJob.verification_input_key,
    verification_job_result_key: triggerJob.verification_result_key ?? null,
    initial_http_status: request.status,
    initial_response: responseBody,
  };
  await writeJsonPrivate(join(jobDirectory, "job.json"), jobRecord);

  const inputDeadline = Date.now() + 30_000;
  let latestTriggerState = triggerJob;
  while (Date.now() < inputDeadline) {
    latestTriggerState = (await readTriggerState(config)).jobs?.[jobId] ?? latestTriggerState;
    if (latestTriggerState.stage === "input-fetched" ||
        latestTriggerState.stage === "input-mismatch" ||
        latestTriggerState.stage === "completion-returned" ||
        latestTriggerState.stage === "executor-error") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (latestTriggerState.input_sha256 !== presentationDigest) {
    throw new Error("Trigger executor did not fetch the exact Presentation bytes from R2");
  }

  if (mode === "invalid-hmac") {
    const callbackDeadline = Date.now() + 15_000;
    while (Date.now() < callbackDeadline) {
      latestTriggerState = (await readTriggerState(config)).jobs?.[jobId] ?? latestTriggerState;
      if (latestTriggerState.stage === "completion-returned") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (latestTriggerState.callback_status !== 401) {
      throw new Error("invalid-HMAC completion was not rejected by the Worker");
    }
    jobRecord.verification_attempt_id = latestTriggerState.verification_attempt_id ?? null;
    jobRecord.verification_attempt_result_key = latestTriggerState.verification_attempt_result_key ?? null;
    await writeJsonPrivate(join(jobDirectory, "job.json"), jobRecord);
    const status = await postStatus(config, identity, session, jobId, triggerJob.binding_id);
    const statusBody = await status.json();
    if (status.status !== 202 || statusBody.verified !== false) {
      throw new Error("invalid-HMAC callback unexpectedly finalized the verification job");
    }
    await writeJsonPrivate(join(jobDirectory, "outcome.json"), {
      job_id: jobId,
      completion_http_status: latestTriggerState.callback_status,
      completion_error: latestTriggerState.callback_error,
      status_http_status: status.status,
      status: statusBody.status,
      verification_attempt_id: jobRecord.verification_attempt_id,
      verification_attempt_result_key: jobRecord.verification_attempt_result_key,
      result_committed: false,
    });
    console.log(JSON.stringify({
      mode,
      job_id: jobId,
      input_sha256: latestTriggerState.input_sha256,
      verification_attempt_id: jobRecord.verification_attempt_id,
      completion_http_status: latestTriggerState.callback_status,
      status_http_status: status.status,
      result_committed: false,
    }));
    return;
  }

  const deadline = Date.now() + 120_000;
  let finalStatus;
  let finalBody;
  let finalBytes;
  while (Date.now() < deadline) {
    const status = await postStatus(config, identity, session, jobId, triggerJob.binding_id);
    finalBytes = Buffer.from(await status.arrayBuffer());
    try {
      finalBody = JSON.parse(finalBytes.toString("utf8"));
    } catch {
      finalBody = null;
    }
    finalStatus = status.status;
    if (finalStatus === 200) break;
    if (finalStatus !== 202) {
      throw new Error(`Worker status returned unexpected HTTP ${finalStatus}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (finalStatus !== 200 || !finalBody) throw new Error("Worker status did not reach a terminal response");
  const callbackDeadline = Date.now() + 15_000;
  while (Date.now() < callbackDeadline) {
    latestTriggerState = (await readTriggerState(config)).jobs?.[jobId] ?? latestTriggerState;
    if (latestTriggerState.stage === "completion-returned") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (latestTriggerState.stage !== "completion-returned") {
    throw new Error("Trigger executor did not record the completion callback response");
  }
  if (mode === "valid" && latestTriggerState.callback_status !== 200) {
    throw new Error("Worker did not accept the valid completion callback");
  }
  if (mode === "corrupt" &&
      (latestTriggerState.callback_status !== 422 ||
       latestTriggerState.callback_error !== "verification_failed")) {
    throw new Error("Worker did not reject the corrupted Presentation through its verifier");
  }
  if (mode === "valid" && finalBody.verified !== true) {
    throw new Error(`Worker status did not verify the exact Complete Presentation${finalBody.error ? ` (${finalBody.error})` : ""}`);
  }
  if (mode === "corrupt" &&
      (finalBody.verified !== false || finalBody.status !== "not_verified")) {
    throw new Error("WASM verification accepted the corrupted Presentation");
  }
  jobRecord.verification_attempt_id = latestTriggerState.verification_attempt_id ?? null;
  jobRecord.verification_attempt_result_key = latestTriggerState.verification_attempt_result_key ?? null;
  await writeJsonPrivate(join(jobDirectory, "job.json"), jobRecord);
  if (finalBody.verified === true) {
    await writePrivateFile(join(jobDirectory, "status-response.bin"), finalBytes);
  }
  await writeJsonPrivate(join(jobDirectory, "outcome.json"), {
    job_id: jobId,
    mode,
    status_http_status: finalStatus,
    verified: finalBody.verified === true,
    status: finalBody.status ?? null,
    error: finalBody.error ?? null,
    status_sha256: sha256(finalBytes),
    verification_attempt_id: jobRecord.verification_attempt_id,
    verification_attempt_result_key: jobRecord.verification_attempt_result_key,
    result_committed: finalBody.verified === true,
  });
  console.log(JSON.stringify({
    mode,
    job_id: jobId,
    input_sha256: latestTriggerState.input_sha256,
    completion_http_status: latestTriggerState.callback_status ?? null,
    completion_error: latestTriggerState.callback_error ?? null,
    status_http_status: finalStatus,
    verified: finalBody.verified === true,
    result_committed: finalBody.verified === true,
    status_sha256: sha256(finalBytes),
    verification_attempt_id: jobRecord.verification_attempt_id,
    verification_attempt_result_key: jobRecord.verification_attempt_result_key,
  }));
}

async function verifyOuterResult(jobId) {
  const config = await loadConfig();
  const directory = join(config.jobs_directory, jobId);
  const job = await readJson(join(directory, "job.json"), null);
  if (!job) throw new Error("job metadata is missing");
  const identity = await readJson(identityPath ?? config.identity_file, null);
  const session = await readJson(join(config.sessions_directory, `${job.session_id}.json`), null);
  if (!identity?.access_token || !session) throw new Error("local identity or Session is missing");
  const initialStatusBytes = await readFile(join(directory, "status-response.bin"));
  const resultPath = process.env.FUSOU_LOCAL_R2_RESULT_FILE;
  if (!resultPath) throw new Error("FUSOU_LOCAL_R2_RESULT_FILE is required");
  const r2Bytes = await readFile(resultPath);
  const currentStatus = await postStatus(config, identity, session, jobId, job.binding_id);
  const statusBytes = Buffer.from(await currentStatus.arrayBuffer());
  if (
    currentStatus.status !== 200 ||
    !initialStatusBytes.equals(statusBytes) ||
    !statusBytes.equals(r2Bytes)
  ) {
    throw new Error("current and initial status responses do not match exact R2 Result bytes");
  }
  const outer = JSON.parse(statusBytes.toString("utf8"));
  if (
    outer.verified !== true ||
    outer.signature_algorithm !== "Ed25519" ||
    outer.signer_key_id !== config.result_signer_key_id ||
    outer.result?.attestation_session_id !== job.session_id ||
    outer.result?.canonical_user_id !== job.canonical_user_id ||
    outer.result?.device_id !== job.device_id ||
    outer.result?.device_challenge !== session.device_challenge ||
    outer.result?.binding_value !== job.binding_value ||
    outer.result?.server_identity !== config.server_identity ||
    outer.result?.profile_id !== config.profile_id ||
    outer.result?.profile_sha256 !== config.profile_sha256 ||
    outer.result?.version !== 2 ||
    outer.result?.presentation_sha256 !== job.presentation_sha256
  ) {
    throw new Error("Worker Result does not match the exact Session and Presentation");
  }
  const presentationMetadata = await readJson(config.presentation_metadata_file, null);
  if (
    !presentationMetadata ||
    outer.result.request_transcript_sha256 !== presentationMetadata.request_transcript_sha256 ||
    Number(outer.result.request_transcript_size) !== presentationMetadata.request_transcript_bytes ||
    outer.result.response_transcript_sha256 !== presentationMetadata.response_transcript_sha256 ||
    Number(outer.result.response_transcript_size) !== presentationMetadata.response_transcript_bytes
  ) {
    throw new Error("Worker Result transcript metadata does not match the independently verified Presentation");
  }
  initVerifierWasm({
    module: new Uint8Array(await readFile(
      resolve(scriptDirectory, "../src/wasm/fusou_tlsn_verifier_bg.wasm"),
    )),
  });
  const signingBytes = derive_verifier_result_signing_bytes(JSON.stringify(outer.result));
  const resultPublicKey = createPublicKey({
    key: Buffer.from(config.result_public_key_spki, "base64url"),
    format: "der",
    type: "spki",
  });
  if (
    typeof outer.result.signature !== "string" ||
    !verify(
      null,
      Buffer.from(signingBytes),
      resultPublicKey,
      Buffer.from(outer.result.signature, "base64url"),
    )
  ) {
    throw new Error("Worker inner Result signature is invalid under the pinned Result public key");
  }
  const receipt = outer.consume_receipt;
  if (
    receipt?.type !== "attestation-binding-consumed" ||
    receipt.signature_algorithm !== "Ed25519" ||
    receipt.signer_key_id !== config.binding_authority_key_id ||
    receipt.session_id !== job.session_id ||
    receipt.canonical_user_id !== job.canonical_user_id ||
    receipt.device_id !== job.device_id ||
    receipt.binding_value !== job.binding_value ||
    receipt.presentation_id !== job.presentation_sha256
  ) {
    throw new Error("Binding Authority consume receipt does not match this job");
  }
  const receiptBytes = attestationConsumeReceiptSigningBytes({
    signerKeyId: receipt.signer_key_id,
    sessionId: receipt.session_id,
    canonicalUserId: receipt.canonical_user_id,
    deviceId: receipt.device_id,
    nonce: receipt.nonce,
    bindingValue: receipt.binding_value,
    presentationId: receipt.presentation_id,
    usedAt: receipt.used_at,
  });
  const bindingAuthorityKey = createPublicKey({
    key: Buffer.from(config.binding_authority_public_key_spki, "base64url"),
    format: "der",
    type: "spki",
  });
  if (!verify(
    null,
    Buffer.from(receiptBytes),
    bindingAuthorityKey,
    Buffer.from(receipt.signature, "base64url"),
  )) {
    throw new Error("Binding Authority consume receipt signature is invalid");
  }
  console.log(JSON.stringify({
    job_id: jobId,
    status_r2_bytes_equal: true,
    result_bytes: statusBytes.length,
    result_sha256: sha256(statusBytes),
    result_signature_independent_verification: "PASS",
    result_presentation_sha256: outer.result.presentation_sha256,
    result_profile_id: outer.result.profile_id,
    result_profile_sha256: outer.result.profile_sha256,
    result_transcript_hashes_match_independent_presentation: true,
    consume_receipt_signature_verified: true,
    consume_receipt_nonce_matches_session: receipt.nonce === session.challenge,
  }));
}

const [command, argument] = process.argv.slice(2);
try {
  if (command === "configure") {
    await configure();
  } else if (command === "prepare-user") {
    await createUser();
  } else if (command === "issue-session") {
    await issueSession();
  } else if (command === "submit" && argument) {
    await submitPresentation(argument);
  } else if (command === "verify-outer" && argument) {
    await verifyOuterResult(argument);
  } else {
    console.error(`Usage: node --experimental-strip-types ${fileURLToPath(import.meta.url)} <configure|prepare-user|issue-session|submit valid|submit invalid-hmac|submit corrupt|verify-outer JOB_ID>`);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(JSON.stringify({
    command: command ?? null,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  }));
  process.exitCode = 1;
}
