import {
  canonicalJsonBytes,
  encodeBase64Url,
  RuntimeConfigDomainError,
  runtimeConfigFreshnessWire,
  runtimeConfigManifestAudienceSha256,
  signRuntimeConfigReleaseCommitRecord,
  verifyRuntimeConfigDelegation,
  verifyRuntimeConfigFreshnessRequest,
  verifyRuntimeConfigManifestEpochPointer,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";
import type {
  RuntimeConfigRootSigner,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";
import {
  verifyRuntimeConfigPublicationObjects,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/production-artifacts.ts";
import {
  createCloudflareOperatorReleaseStateReader,
  createWorkerReadableCloudflareOperatorFreshnessSigner,
  issueCloudflareOperatorFreshness,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-cloudflare-operator.ts";
import type {
  CloudflareOperatorIssueDependencies,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-cloudflare-operator.ts";
import {
  DurableObjectFreshnessIssueCoordinatorAdapter,
} from "./durable-object-adapter.ts";
import {
  CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts";
import {
  RuntimeConfigR2ReleaseConflictError,
  RuntimeConfigR2ReleaseIntegrityError,
  RuntimeConfigR2ReleaseStore,
} from "./r2-release-store.ts";
import type {
  ReleaseLedgerHeadBinding,
  ReleaseLedgerOperation,
  ReleaseRecordSigningClaim,
  RuntimeConfigR2PublicationObject,
} from "./release-ledger.ts";
import type {
  CoordinatorEnv,
  SqliteFreshnessIssueCoordinatorDO,
} from "./sqlite-freshness-issue-coordinator.ts";

export {
  SqliteFreshnessIssueCoordinatorDO,
} from "./sqlite-freshness-issue-coordinator.ts";

const PRIVATE_SERVICE_ORIGIN = "https://freshness-signer.internal";
const GENESIS_ADMIN_PATH = "/__private/admin/genesis";
const GENESIS_ADMIN_MAX_BODY_BYTES = 2_000_000;
const GENESIS_ADMIN_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const RELEASE_ADMIN_PATH = "/__private/admin/release";
const RELEASE_ADMIN_MAX_BODY_BYTES = 7_340_032;
const RELEASE_ADMIN_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const RELEASE_OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RELEASE_ADMIN_FIELDS = [
  "manifest_bytes_base64url",
  "operation_id",
  "publication_objects",
] as const;
const RELEASE_ADMIN_OBJECT_FIELDS = ["body_base64url", "key"] as const;
const GENESIS_ADMIN_FIELDS = [
  "manifest_bytes_base64url",
  "record_bytes_base64url",
  "release_delegation_bytes_base64url",
] as const;
const CONFIG_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CHAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_DELEGATION_BYTES = 8_192;
const ED25519_PKCS8_BYTES = 48;
const ED25519_SPKI_BYTES = 44;
const RELEASE_SIGNER_KEY_CHECK_DOMAIN = new TextEncoder().encode(
  "FUSOU-TLSN-RUNTIME-CONFIG-RELEASE-SIGNER-KEY-CHECK-V1\0",
);
const OPERATION_ID_DOMAIN = new TextEncoder().encode(
  "FUSOU-TLSN-CLOUDFLARE-OPERATOR-FRESHNESS-OPERATION-ID-V1\0",
);
const ROOT_SCOPE = "fusou-tlsn-runtime-config-signing-root-v2";

export interface PrivateFreshnessSignerEnv extends CoordinatorEnv {
  readonly TLSN_RUNTIME_CONFIG_MANIFEST_URL?: string;
  readonly FRESHNESS_COORDINATOR_NAME?: string;
  readonly FRESHNESS_ISSUE_COORDINATOR?: DurableObjectNamespace<
    SqliteFreshnessIssueCoordinatorDO
  >;
  readonly FRESHNESS_SIGNER_KEY_ID?: string;
  readonly FRESHNESS_SIGNER_PRIVATE_KEY_PKCS8_BASE64URL?: string;
  readonly FRESHNESS_SIGNER_DELEGATION_BASE64URL?: string;
  readonly FRESHNESS_RELEASE_ADMIN_CAPABILITY?: string;
  readonly RELEASE_RECORD_SIGNER_KEY_ID?: string;
  readonly RELEASE_RECORD_SIGNER_PRIVATE_KEY_PKCS8_BASE64URL?: string;
  readonly RELEASE_RECORD_SIGNER_DELEGATION_BASE64URL?: string;
}

interface PrivateFreshnessSignerDependencies {
  readonly manifestUrl: string;
  readonly chainId: string;
  readonly coordinator: DurableObjectFreshnessIssueCoordinatorAdapter;
  readonly issueDependencies: CloudflareOperatorIssueDependencies;
}

interface PrivateFreshnessSignerConfiguration {
  readonly manifestUrl: string;
  readonly chainId: string;
  readonly coordinatorName: string;
  readonly rootSigner: RuntimeConfigRootSigner;
  readonly manifestRootSigner: RuntimeConfigRootSigner;
  readonly freshnessKeyId: string;
  readonly freshnessDelegationBytes: Uint8Array;
  readonly privateKey: CryptoKey;
}

interface PrivateReleaseUpdateConfiguration {
  readonly manifestUrl: string;
  readonly chainId: string;
  readonly coordinatorName: string;
  readonly releaseRootSigner: RuntimeConfigRootSigner;
  readonly manifestRootSigner: RuntimeConfigRootSigner;
  readonly releaseSignerKeyId: string;
  readonly releaseSignerPrivateKey: CryptoKey;
  readonly releaseDelegationBytes: Uint8Array;
}

interface ParsedReleaseUpdateRequest {
  readonly operationId: string;
  readonly manifestBytes: Uint8Array;
  readonly publicationObjects: readonly RuntimeConfigR2PublicationObject[];
}

type BodyFailure = "empty" | "too-large" | "invalid";

class BoundedBodyError extends Error {
  readonly reason: BodyFailure;

  constructor(reason: BodyFailure) {
    super(reason);
    this.name = "BoundedBodyError";
    this.reason = reason;
  }
}

const configurationByEnvironment = new WeakMap<
  object,
  Promise<PrivateFreshnessSignerConfiguration>
>();
const releaseUpdateConfigurationByEnvironment = new WeakMap<
  object,
  Promise<PrivateReleaseUpdateConfiguration>
>();

function logFailure(event: string, error?: unknown): void {
  const details: Record<string, string> = { event };
  if (error instanceof Error) {
    details.error_name = error.name;
    if (
      "code" in error &&
      typeof error.code === "string" &&
      /^[A-Z0-9_]{1,64}$/u.test(error.code)
    ) {
      details.error_code = error.code;
    }
  }
  console.error(JSON.stringify(details));
}

function jsonResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function requiredString(
  value: string | undefined,
  label: string,
  pattern?: RegExp,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new Error(`Invalid ${label} configuration`);
  }
  return value;
}

async function configuredManifestUrl(
  env: PrivateFreshnessSignerEnv,
): Promise<string> {
  const gatewayManifestUrl = requiredString(
    env.TLSN_RUNTIME_CONFIG_MANIFEST_URL,
    "Gateway Manifest URL",
  );
  const coordinatorManifestUrl = requiredString(
    env.FRESHNESS_MANIFEST_URL,
    "Coordinator Manifest URL",
  );
  if (gatewayManifestUrl !== coordinatorManifestUrl) {
    throw new Error("Gateway and Coordinator Manifest URLs differ");
  }
  await runtimeConfigManifestAudienceSha256(gatewayManifestUrl);
  return gatewayManifestUrl;
}

function decodeBase64Url(
  value: string | undefined,
  label: string,
  maximumBytes: number,
): Uint8Array {
  const encoded = requiredString(value, label);
  if (
    !/^[A-Za-z0-9_-]+$/u.test(encoded) ||
    encoded.length % 4 === 1
  ) {
    throw new Error(`Invalid ${label} encoding`);
  }
  let binary: string;
  try {
    const padded = encoded.replace(/-/gu, "+").replace(/_/gu, "/") +
      "=".repeat((4 - encoded.length % 4) % 4);
    binary = atob(padded);
  } catch {
    throw new Error(`Invalid ${label} encoding`);
  }
  if (binary.length > maximumBytes) {
    throw new Error(`${label} exceeds its size limit`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (encodeBase64Url(bytes) !== encoded) {
    throw new Error(`${label} is not canonical base64url`);
  }
  return bytes;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function validateEd25519PublicKey(
  spkiBase64Url: string | undefined,
  label: string,
): Promise<void> {
  const spki = decodeBase64Url(spkiBase64Url, label, ED25519_SPKI_BYTES);
  if (spki.byteLength !== ED25519_SPKI_BYTES) {
    throw new Error(`${label} is not an Ed25519 SPKI key`);
  }
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "spki",
      exactArrayBuffer(spki),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    throw new Error(`${label} is not an Ed25519 SPKI key`);
  }
  if (
    key.type !== "public" ||
    key.algorithm.name !== "Ed25519" ||
    !key.usages.includes("verify")
  ) {
    throw new Error(`${label} is not an Ed25519 verification key`);
  }
}

function createRootSigner(
  keyId: string | undefined,
  publicKeySpki: string | undefined,
  label: string,
): RuntimeConfigRootSigner {
  return Object.freeze({
    scope: ROOT_SCOPE,
    key_id: requiredString(keyId, `${label} key ID`, CONFIG_KEY_ID_PATTERN),
    public_key_spki: requiredString(publicKeySpki, `${label} public key`),
  });
}

async function createConfiguration(
  env: PrivateFreshnessSignerEnv,
): Promise<PrivateFreshnessSignerConfiguration> {
  const manifestUrl = await configuredManifestUrl(env);
  const chainId = requiredString(
    env.RELEASE_LEDGER_CHAIN_ID,
    "Release chain ID",
    CHAIN_ID_PATTERN,
  );
  const coordinatorName = requiredString(
    env.FRESHNESS_COORDINATOR_NAME,
    "Freshness coordinator identity",
  );
  if (coordinatorName.length > 128) {
    throw new Error("Freshness coordinator identity exceeds its size limit");
  }
  const rootSigner = createRootSigner(
    env.RELEASE_LEDGER_ROOT_KEY_ID,
    env.RELEASE_LEDGER_ROOT_PUBLIC_KEY_SPKI,
    "Release root",
  );
  const manifestRootSigner = createRootSigner(
    env.RELEASE_LEDGER_MANIFEST_KEY_ID,
    env.RELEASE_LEDGER_MANIFEST_PUBLIC_KEY_SPKI,
    "Manifest root",
  );
  const freshnessKeyId = requiredString(
    env.FRESHNESS_SIGNER_KEY_ID,
    "Freshness child key ID",
    CONFIG_KEY_ID_PATTERN,
  );
  const freshnessDelegationBytes = decodeBase64Url(
    env.FRESHNESS_SIGNER_DELEGATION_BASE64URL,
    "Freshness delegation",
    MAX_DELEGATION_BYTES,
  );
  const privateKeyBytes = decodeBase64Url(
    env.FRESHNESS_SIGNER_PRIVATE_KEY_PKCS8_BASE64URL,
    "Freshness private key",
    ED25519_PKCS8_BYTES,
  );
  if (privateKeyBytes.byteLength !== ED25519_PKCS8_BYTES) {
    throw new Error("Freshness private key is not Ed25519 PKCS8");
  }
  await Promise.all([
    validateEd25519PublicKey(
      rootSigner.public_key_spki,
      "Release root public key",
    ),
    validateEd25519PublicKey(
      manifestRootSigner.public_key_spki,
      "Manifest root public key",
    ),
  ]);

  let privateKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey(
      "pkcs8",
      exactArrayBuffer(privateKeyBytes),
      { name: "Ed25519" },
      false,
      ["sign"],
    );
  } catch {
    throw new Error("Freshness private key is not Ed25519 PKCS8");
  }
  if (
    privateKey.type !== "private" ||
    privateKey.algorithm.name !== "Ed25519" ||
    !privateKey.usages.includes("sign")
  ) {
    throw new Error("Freshness private key is not an Ed25519 signing key");
  }

  return {
    manifestUrl,
    chainId,
    coordinatorName,
    rootSigner,
    manifestRootSigner,
    freshnessKeyId,
    freshnessDelegationBytes,
    privateKey,
  };
}

async function createReleaseUpdateConfiguration(
  env: PrivateFreshnessSignerEnv,
): Promise<PrivateReleaseUpdateConfiguration> {
  const manifestUrl = await configuredManifestUrl(env);
  const chainId = requiredString(
    env.RELEASE_LEDGER_CHAIN_ID,
    "Release chain ID",
    CHAIN_ID_PATTERN,
  );
  const coordinatorName = requiredString(
    env.FRESHNESS_COORDINATOR_NAME,
    "Freshness coordinator identity",
  );
  if (coordinatorName.length > 128) {
    throw new Error("Freshness coordinator identity exceeds its size limit");
  }
  const releaseRootSigner = createRootSigner(
    env.RELEASE_LEDGER_ROOT_KEY_ID,
    env.RELEASE_LEDGER_ROOT_PUBLIC_KEY_SPKI,
    "Release root",
  );
  const manifestRootSigner = createRootSigner(
    env.RELEASE_LEDGER_MANIFEST_KEY_ID,
    env.RELEASE_LEDGER_MANIFEST_PUBLIC_KEY_SPKI,
    "Manifest root",
  );
  const releaseSignerKeyId = requiredString(
    env.RELEASE_RECORD_SIGNER_KEY_ID,
    "Release Record signer key ID",
    CONFIG_KEY_ID_PATTERN,
  );
  const releaseDelegationBytes = decodeBase64Url(
    env.RELEASE_RECORD_SIGNER_DELEGATION_BASE64URL,
    "Release Record signer delegation",
    MAX_DELEGATION_BYTES,
  );
  const privateKeyBytes = decodeBase64Url(
    env.RELEASE_RECORD_SIGNER_PRIVATE_KEY_PKCS8_BASE64URL,
    "Release Record signer private key",
    ED25519_PKCS8_BYTES,
  );
  if (privateKeyBytes.byteLength !== ED25519_PKCS8_BYTES) {
    throw new Error("Release Record signer private key is not Ed25519 PKCS8");
  }
  await Promise.all([
    validateEd25519PublicKey(
      releaseRootSigner.public_key_spki,
      "Release root public key",
    ),
    validateEd25519PublicKey(
      manifestRootSigner.public_key_spki,
      "Manifest root public key",
    ),
  ]);
  const signerNowMs = Date.now();
  const delegation = await verifyRuntimeConfigDelegation({
    raw: releaseDelegationBytes,
    rootSigner: releaseRootSigner,
    expectedPurpose: "release-commit-record-v1",
    expectedEnvironment: "production",
    expectedAudience:
      `${runtimeConfigFreshnessWire.releaseAudiencePrefix}production`,
    signerNowMs,
  });
  if (delegation.payload.key_id !== releaseSignerKeyId) {
    throw new Error(
      "Release Record signer key ID does not match the root delegation",
    );
  }

  let releaseSignerPrivateKey: CryptoKey;
  try {
    releaseSignerPrivateKey = await crypto.subtle.importKey(
      "pkcs8",
      exactArrayBuffer(privateKeyBytes),
      { name: "Ed25519" },
      false,
      ["sign"],
    );
  } catch {
    throw new Error("Release Record signer private key is not Ed25519 PKCS8");
  }
  if (
    releaseSignerPrivateKey.type !== "private" ||
    releaseSignerPrivateKey.algorithm.name !== "Ed25519" ||
    !releaseSignerPrivateKey.usages.includes("sign")
  ) {
    throw new Error("Release Record signer private key cannot sign Ed25519");
  }
  const delegatedPublicKeyBytes = decodeBase64Url(
    delegation.payload.public_key_spki,
    "Release Record signer public key",
    ED25519_SPKI_BYTES,
  );
  if (delegatedPublicKeyBytes.byteLength !== ED25519_SPKI_BYTES) {
    throw new Error("Release Record signer delegation has an invalid public key");
  }
  const delegatedPublicKey = await crypto.subtle.importKey(
    "spki",
    exactArrayBuffer(delegatedPublicKeyBytes),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const checkMessage = concatenate([
    RELEASE_SIGNER_KEY_CHECK_DOMAIN,
    new TextEncoder().encode(releaseSignerKeyId),
  ]);
  const checkSignature = await crypto.subtle.sign(
    { name: "Ed25519" },
    releaseSignerPrivateKey,
    exactArrayBuffer(checkMessage),
  );
  if (
    !(await crypto.subtle.verify(
      { name: "Ed25519" },
      delegatedPublicKey,
      checkSignature,
      exactArrayBuffer(checkMessage),
    ))
  ) {
    throw new Error(
      "Release Record signer private key does not match its delegated public key",
    );
  }

  return {
    manifestUrl,
    chainId,
    coordinatorName,
    releaseRootSigner,
    manifestRootSigner,
    releaseSignerKeyId,
    releaseSignerPrivateKey,
    releaseDelegationBytes,
  };
}

function configurationFor(
  env: PrivateFreshnessSignerEnv,
): Promise<PrivateFreshnessSignerConfiguration> {
  const key = env as object;
  const existing = configurationByEnvironment.get(key);
  if (existing !== undefined) return existing;
  const pending = createConfiguration(env);
  configurationByEnvironment.set(key, pending);
  return pending.catch((error: unknown) => {
    if (configurationByEnvironment.get(key) === pending) {
      configurationByEnvironment.delete(key);
    }
    throw error;
  });
}

function releaseUpdateConfigurationFor(
  env: PrivateFreshnessSignerEnv,
): Promise<PrivateReleaseUpdateConfiguration> {
  const key = env as object;
  const existing = releaseUpdateConfigurationByEnvironment.get(key);
  if (existing !== undefined) return existing;
  const pending = createReleaseUpdateConfiguration(env);
  releaseUpdateConfigurationByEnvironment.set(key, pending);
  return pending.catch((error: unknown) => {
    if (releaseUpdateConfigurationByEnvironment.get(key) === pending) {
      releaseUpdateConfigurationByEnvironment.delete(key);
    }
    throw error;
  });
}

function requiredBindings(env: PrivateFreshnessSignerEnv): {
  readonly coordinatorNamespace: DurableObjectNamespace<
    SqliteFreshnessIssueCoordinatorDO
  >;
  readonly releaseBucket: R2Bucket;
} {
  const coordinatorNamespace = env.FRESHNESS_ISSUE_COORDINATOR;
  if (
    coordinatorNamespace === undefined ||
    typeof coordinatorNamespace.idFromName !== "function" ||
    typeof coordinatorNamespace.get !== "function"
  ) {
    throw new Error("Freshness coordinator binding is missing");
  }
  const releaseBucket = env.RELEASE_LEDGER_R2;
  if (releaseBucket === undefined || typeof releaseBucket.get !== "function") {
    throw new Error("Release R2 binding is missing");
  }
  return { coordinatorNamespace, releaseBucket };
}

async function createDependencies(
  env: PrivateFreshnessSignerEnv,
): Promise<PrivateFreshnessSignerDependencies> {
  const configuration = await configurationFor(env);
  const { coordinatorNamespace, releaseBucket } = requiredBindings(env);
  const stub = coordinatorNamespace.get(
    coordinatorNamespace.idFromName(configuration.coordinatorName),
  );
  const coordinator = new DurableObjectFreshnessIssueCoordinatorAdapter(stub);
  const manifests = new RuntimeConfigR2ReleaseStore(releaseBucket);
  const stateReader = createCloudflareOperatorReleaseStateReader({
    coordinator,
    manifests,
    releaseRootSigner: configuration.rootSigner,
    manifestRootSigner: configuration.manifestRootSigner,
    manifestUrl: configuration.manifestUrl,
  });
  const signer = await createWorkerReadableCloudflareOperatorFreshnessSigner({
    manifestUrl: configuration.manifestUrl,
    environment: "production",
    chainId: configuration.chainId,
    bootstrapSigner: configuration.rootSigner,
    coordinator,
    key: {
      keyId: configuration.freshnessKeyId,
      privateKey: configuration.privateKey,
      freshnessDelegationBytes: Uint8Array.from(
        configuration.freshnessDelegationBytes,
      ),
    },
    stateReader,
  });
  return {
    manifestUrl: configuration.manifestUrl,
    chainId: configuration.chainId,
    coordinator,
    issueDependencies: {
      manifestUrl: configuration.manifestUrl,
      chainId: configuration.chainId,
      bootstrapSigner: configuration.rootSigner,
      coordinator,
      currentState: stateReader,
      signer,
    },
  };
}

function dependenciesFor(
  env: PrivateFreshnessSignerEnv,
): Promise<PrivateFreshnessSignerDependencies> {
  return createDependencies(env);
}

function frame(bytes: Uint8Array): Uint8Array {
  const framed = new Uint8Array(4 + bytes.byteLength);
  new DataView(framed.buffer).setUint32(0, bytes.byteLength, false);
  framed.set(bytes, 4);
  return framed;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

function uuidFromBytes(bytes: Uint8Array): string {
  if (bytes.byteLength < 16) {
    throw new Error("Operation identifier digest is too short");
  }
  const uuid = bytes.slice(0, 16);
  uuid[6] = (uuid[6]! & 0x0f) | 0x40;
  uuid[8] = (uuid[8]! & 0x3f) | 0x80;
  const hex = [...uuid].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}

export async function deriveCloudflareOperatorFreshnessOperationId(input: {
  readonly manifestUrl: string;
  readonly chainId: string;
  readonly requestBytes: Uint8Array;
}): Promise<string> {
  if (
    !(input.requestBytes instanceof Uint8Array) ||
    input.requestBytes.byteLength === 0 ||
    input.requestBytes.byteLength > runtimeConfigFreshnessWire.maxRequestBytes ||
    !CHAIN_ID_PATTERN.test(input.chainId)
  ) {
    throw new Error("Invalid operation identifier input");
  }
  const audience = await runtimeConfigManifestAudienceSha256(input.manifestUrl);
  const preimage = concatenate([
    OPERATION_ID_DOMAIN,
    frame(new TextEncoder().encode("production")),
    frame(new TextEncoder().encode(input.chainId)),
    frame(new TextEncoder().encode(audience)),
    frame(input.requestBytes),
  ]);
  return uuidFromBytes(
    new Uint8Array(await crypto.subtle.digest("SHA-256", exactArrayBuffer(preimage))),
  );
}

function mediaType(value: string | null): string | null {
  if (value === null) return null;
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function declaredLength(
  value: string | null,
  maximum: number,
): "valid" | "invalid" | "too-large" {
  if (value === null) return "valid";
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) return "invalid";
  const length = Number(value);
  if (!Number.isSafeInteger(length)) return "invalid";
  return length > maximum ? "too-large" : "valid";
}

async function cancelRequestBody(request: Request): Promise<void> {
  if (request.body === null) return;
  try {
    await request.body.cancel();
  } catch {
    logFailure("private_signer_request_body_cancel_failed");
  }
}

async function readBoundedBody(
  request: Request,
  maximum: number = runtimeConfigFreshnessWire.maxRequestBytes,
): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  const lengthState = declaredLength(contentLength, maximum);
  if (lengthState !== "valid") {
    await cancelRequestBody(request);
    throw new BoundedBodyError(
      lengthState === "too-large" ? "too-large" : "invalid",
    );
  }
  if (request.body === null) throw new BoundedBodyError("empty");

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    throw new BoundedBodyError("invalid");
  }
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let completed = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        completed = true;
        break;
      }
      if (
        next.value.byteLength > maximum - byteLength
      ) {
        throw new BoundedBodyError("too-large");
      }
      chunks.push(next.value);
      byteLength += next.value.byteLength;
    }
  } catch (error) {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        logFailure("private_signer_request_body_cancel_failed");
      }
    }
    if (error instanceof BoundedBodyError) throw error;
    throw new BoundedBodyError("invalid");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      logFailure("private_signer_request_body_unlock_failed");
    }
  }
  if (contentLength !== null && Number(contentLength) !== byteLength) {
    throw new BoundedBodyError("invalid");
  }
  if (byteLength === 0) throw new BoundedBodyError("empty");
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function hashBase64Url(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes));
  return encodeBase64Url(new Uint8Array(digest));
}

function hasGenesisAdminCapability(
  request: Request,
  env: PrivateFreshnessSignerEnv,
): boolean {
  const expected = env.FRESHNESS_GENESIS_ADMIN_CAPABILITY;
  const supplied = request.headers.get("x-fusou-genesis-capability");
  if (
    typeof expected !== "string" ||
    !GENESIS_ADMIN_CAPABILITY_PATTERN.test(expected) ||
    supplied === null ||
    !GENESIS_ADMIN_CAPABILITY_PATTERN.test(supplied)
  ) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

function hasReleaseAdminCapability(
  request: Request,
  env: PrivateFreshnessSignerEnv,
): boolean {
  const expected = env.FRESHNESS_RELEASE_ADMIN_CAPABILITY;
  const supplied = request.headers.get("x-fusou-release-capability");
  if (
    typeof expected !== "string" ||
    !RELEASE_ADMIN_CAPABILITY_PATTERN.test(expected) ||
    supplied === null ||
    !RELEASE_ADMIN_CAPABILITY_PATTERN.test(supplied)
  ) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

function parseReleaseUpdateRequest(bytes: Uint8Array): ParsedReleaseUpdateRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BoundedBodyError("invalid");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new BoundedBodyError("invalid");
  }
  const value = parsed as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== RELEASE_ADMIN_FIELDS.length ||
    keys.some((key, index) => key !== RELEASE_ADMIN_FIELDS[index]) ||
    typeof value.operation_id !== "string" ||
    !RELEASE_OPERATION_ID_PATTERN.test(value.operation_id) ||
    !Array.isArray(value.publication_objects) ||
    value.publication_objects.length !== 5
  ) {
    throw new BoundedBodyError("invalid");
  }
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = decodeBase64Url(
      typeof value.manifest_bytes_base64url === "string"
        ? value.manifest_bytes_base64url
        : undefined,
      "Release Manifest",
      1_048_576,
    );
  } catch {
    throw new BoundedBodyError("invalid");
  }
  const publicationObjects: RuntimeConfigR2PublicationObject[] = [];
  let totalObjectBytes = 0;
  for (const candidate of value.publication_objects) {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw new BoundedBodyError("invalid");
    }
    const object = candidate as Record<string, unknown>;
    const objectKeys = Object.keys(object).sort();
    if (
      objectKeys.length !== RELEASE_ADMIN_OBJECT_FIELDS.length ||
      objectKeys.some((key, index) => key !== RELEASE_ADMIN_OBJECT_FIELDS[index]) ||
      typeof object.key !== "string" ||
      object.key.length === 0 ||
      object.key.length > 256 ||
      typeof object.body_base64url !== "string"
    ) {
      throw new BoundedBodyError("invalid");
    }
    let body: Uint8Array;
    try {
      body = decodeBase64Url(
        object.body_base64url,
        "Release publication object",
        2_000_000,
      );
    } catch {
      throw new BoundedBodyError("invalid");
    }
    totalObjectBytes += body.byteLength;
    if (totalObjectBytes > 4_000_000) {
      throw new BoundedBodyError("too-large");
    }
    publicationObjects.push({ key: object.key, body });
  }
  return {
    operationId: value.operation_id,
    manifestBytes,
    publicationObjects,
  };
}

function releaseUpdateResponse(
  operationId: string,
  operation: ReleaseLedgerOperation | null,
  install:
    | Awaited<
        ReturnType<
          DurableObjectFreshnessIssueCoordinatorAdapter["getCloudflareOperatorBindingInstall"]
        >
      >
    | null,
): Response {
  if (operation === null) {
    return new Response(
      JSON.stringify({
        operation_id: operationId,
        status: "NOT_FOUND",
        release_status: null,
        install_status: null,
      }),
      {
        status: 404,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }
  const status = install?.status === "INSTALLED"
    ? "INSTALLED"
    : install?.status === "VERIFYING"
    ? "INSTALLING"
    : install?.status === "QUARANTINED" ||
        operation.status === "QUARANTINED"
    ? "QUARANTINED"
    : install?.status === "CONFLICT" || operation.status === "CONFLICT"
    ? "CONFLICT"
    : operation.status;
  const statusCode = status === "INSTALLED"
    ? 200
    : status === "QUARANTINED" || status === "CONFLICT"
    ? 409
    : status === "RESULT_UNKNOWN"
    ? 503
    : 202;
  return new Response(
    JSON.stringify({
      operation_id: operation.operationId,
      status,
      release_status: operation.status,
      install_status: install?.status ?? null,
      unknown_stage: operation.unknownStage,
    }),
    {
      status: statusCode,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function parseGenesisRequest(bytes: Uint8Array): {
  readonly recordBytes: Uint8Array;
  readonly releaseDelegationBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BoundedBodyError("invalid");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new BoundedBodyError("invalid");
  }
  const value = parsed as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== GENESIS_ADMIN_FIELDS.length ||
    keys.some((key, index) => key !== GENESIS_ADMIN_FIELDS[index])
  ) {
    throw new BoundedBodyError("invalid");
  }
  try {
    if (!equalBytes(bytes, canonicalJsonBytes(value))) {
      throw new BoundedBodyError("invalid");
    }
    const manifestValue = value.manifest_bytes_base64url;
    const recordValue = value.record_bytes_base64url;
    const delegationValue = value.release_delegation_bytes_base64url;
    if (
      typeof manifestValue !== "string" ||
      typeof recordValue !== "string" ||
      typeof delegationValue !== "string"
    ) {
      throw new BoundedBodyError("invalid");
    }
    return {
      manifestBytes: decodeBase64Url(
        manifestValue,
        "Genesis Manifest",
        1_048_576,
      ),
      recordBytes: decodeBase64Url(
        recordValue,
        "Genesis Release Record",
        262_144,
      ),
      releaseDelegationBytes: decodeBase64Url(
        delegationValue,
        "Genesis Release delegation",
        8_192,
      ),
    };
  } catch (error) {
    if (error instanceof BoundedBodyError) throw error;
    throw new BoundedBodyError("invalid");
  }
}

function genesisOperationResponse(
  operation: Awaited<
    ReturnType<
      DurableObjectFreshnessIssueCoordinatorAdapter["initializeCloudflareOperatorGenesis"]
    >
  >,
): Response {
  const status = operation.status === "NOT_FOUND"
    ? 404
    : operation.status === "CONFLICT" || operation.status === "QUARANTINED"
    ? 409
    : operation.status === "RESULT_UNKNOWN"
    ? 503
    : 200;
  return new Response(
    JSON.stringify({
      operation_id: operation.operationId,
      status: operation.status,
      release_status: operation.releaseStatus,
      install_status: operation.installStatus,
    }),
    {
      status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function genesisManagementFailure(error: unknown): Response {
  const errorName = remoteErrorName(error);
  const storageErrorCode = remoteCoordinatorStorageErrorCode(error);
  if (storageErrorCode !== null) {
    logFailure("private_signer_genesis_operation_rejected", error);
    if (storageErrorCode === "INVALID_INPUT") {
      return jsonResponse(400, "invalid_genesis_material");
    }
    if (
      storageErrorCode === "PROFILE_MISMATCH" ||
      storageErrorCode === "RELEASE_CONFLICT" ||
      storageErrorCode === "RELEASE_BLOCKED" ||
      storageErrorCode === "ILLEGAL_TRANSITION"
    ) {
      return jsonResponse(409, "genesis_not_available");
    }
    return jsonResponse(503, "genesis_unavailable");
  }
  if (
    error instanceof RuntimeConfigDomainError ||
    errorName === "RuntimeConfigDomainError" ||
    error instanceof RuntimeConfigR2ReleaseConflictError ||
    errorName === "RuntimeConfigR2ReleaseConflictError" ||
    error instanceof RuntimeConfigR2ReleaseIntegrityError ||
    errorName === "RuntimeConfigR2ReleaseIntegrityError"
  ) {
    logFailure("private_signer_genesis_material_rejected", error);
    return jsonResponse(409, "genesis_material_rejected");
  }
  logFailure("private_signer_genesis_operation_failed", error);
  return jsonResponse(503, "genesis_unavailable");
}

function remoteErrorName(error: unknown): string | null {
  if (error instanceof Error) return error.name;
  if (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string"
  ) {
    return error.name;
  }
  return null;
}

function remoteCoordinatorStorageErrorCode(error: unknown): string | null {
  if (
    remoteErrorName(error) !== "FreshnessIssueCoordinatorStorageError" ||
    error === null ||
    typeof error !== "object" ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return null;
  }
  return [
    "INVALID_INPUT",
    "NOT_INITIALIZED",
    "CORRUPT_STORAGE",
    "ILLEGAL_TRANSITION",
    "FENCE_EXHAUSTED",
    "RELEASE_CONFLICT",
    "RELEASE_BLOCKED",
    "PROFILE_MISMATCH",
    "INVALID_TIME",
    "MISSING_ADAPTER",
  ].includes(error.code)
    ? error.code
    : null;
}

function genesisCoordinatorFor(
  env: PrivateFreshnessSignerEnv,
): DurableObjectFreshnessIssueCoordinatorAdapter {
  const coordinatorName = requiredString(
    env.FRESHNESS_COORDINATOR_NAME,
    "Freshness coordinator identity",
  );
  const { coordinatorNamespace } = requiredBindings(env);
  const stub = coordinatorNamespace.get(
    coordinatorNamespace.idFromName(coordinatorName),
  );
  return new DurableObjectFreshnessIssueCoordinatorAdapter(stub);
}

async function handleGenesisManagementRequest(
  request: Request,
  env: PrivateFreshnessSignerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const operationMatch = /^\/__private\/admin\/genesis\/([0-9a-f-]{36})$/u.exec(
    url.pathname,
  );
  const isInitializePath = url.pathname === GENESIS_ADMIN_PATH;
  if (!isInitializePath && operationMatch === null) return null;
  if (url.origin !== PRIVATE_SERVICE_ORIGIN || url.search.length !== 0) {
    return jsonResponse(404, "not_found");
  }
  const expectedMethod = isInitializePath ? "POST" : "GET";
  if (request.method !== expectedMethod) {
    return new Response(null, {
      status: 405,
      headers: {
        allow: expectedMethod,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (!hasGenesisAdminCapability(request, env)) {
    await cancelRequestBody(request);
    return jsonResponse(403, "forbidden");
  }

  if (isInitializePath) {
    if (mediaType(request.headers.get("content-type")) !== "application/json") {
      return jsonResponse(415, "unsupported_media_type");
    }
    const contentEncoding = request.headers.get("content-encoding");
    if (
      contentEncoding !== null &&
      contentEncoding.toLowerCase() !== "identity"
    ) {
      return jsonResponse(415, "unsupported_media_type");
    }
    let requestBytes: Uint8Array;
    try {
      requestBytes = await readBoundedBody(
        request,
        GENESIS_ADMIN_MAX_BODY_BYTES,
      );
    } catch (error) {
      if (!(error instanceof BoundedBodyError)) throw error;
      return jsonResponse(
        error.reason === "too-large" ? 413 : 400,
        error.reason === "too-large" ? "request_too_large" : "invalid_request",
      );
    }
    let input: ReturnType<typeof parseGenesisRequest>;
    try {
      input = parseGenesisRequest(requestBytes);
    } catch (error) {
      if (!(error instanceof BoundedBodyError)) throw error;
      return jsonResponse(400, "invalid_request");
    }
    try {
      const coordinator = genesisCoordinatorFor(env);
      return genesisOperationResponse(
        await coordinator.initializeCloudflareOperatorGenesis({
          ...input,
          adminCapability: requiredString(
            env.FRESHNESS_GENESIS_ADMIN_CAPABILITY,
            "Genesis management capability",
            GENESIS_ADMIN_CAPABILITY_PATTERN,
          ),
        }),
      );
    } catch (error) {
      return genesisManagementFailure(error);
    }
  }

  if (
    request.body !== null ||
    (request.headers.has("content-length") &&
      request.headers.get("content-length") !== "0")
  ) {
    await cancelRequestBody(request);
    return jsonResponse(400, "invalid_request");
  }
  const operationId = operationMatch?.[1];
  if (operationId === undefined) return jsonResponse(404, "not_found");
  try {
    const coordinator = genesisCoordinatorFor(env);
    return genesisOperationResponse(
      await coordinator.getCloudflareOperatorGenesisOperation(
        operationId,
        requiredString(
          env.FRESHNESS_GENESIS_ADMIN_CAPABILITY,
          "Genesis management capability",
          GENESIS_ADMIN_CAPABILITY_PATTERN,
        ),
      ),
    );
  } catch (error) {
    return genesisManagementFailure(error);
  }
}

function releaseUpdateCoordinatorFor(
  env: PrivateFreshnessSignerEnv,
  coordinatorName: string,
): DurableObjectFreshnessIssueCoordinatorAdapter {
  const { coordinatorNamespace } = requiredBindings(env);
  const stub = coordinatorNamespace.get(
    coordinatorNamespace.idFromName(coordinatorName),
  );
  return new DurableObjectFreshnessIssueCoordinatorAdapter(stub);
}

async function releaseUpdateOperationResponse(
  coordinator: DurableObjectFreshnessIssueCoordinatorAdapter,
  operationId: string,
): Promise<Response> {
  const operation = await coordinator.getReleaseOperation(operationId);
  const install = await coordinator.getCloudflareOperatorBindingInstall(
    operationId,
  );
  if (operation === null && install !== null) {
    throw new Error("Release update install exists without its operation");
  }
  return releaseUpdateResponse(operationId, operation, install);
}

async function verifyReleaseUpdateManifest(
  input: ParsedReleaseUpdateRequest,
  configuration: PrivateReleaseUpdateConfiguration,
): Promise<void> {
  const verified = await verifyRuntimeConfigManifestEpochPointer({
    raw: input.manifestBytes,
    trustedSigner: configuration.manifestRootSigner,
    manifestUrl: configuration.manifestUrl,
    nowMs: Date.now(),
  });
  if (
    verified.envelopeSchemaVersion !== 3 ||
    verified.publicationArtifactDigests === null
  ) {
    throw new RuntimeConfigDomainError(
      "INVALID_BINDING",
      "Operator Release updates require a root-delegated Manifest V3",
    );
  }
  await verifyRuntimeConfigPublicationObjects({
    payload: verified.payload,
    objects: input.publicationObjects,
    nowMs: Date.now(),
    maxReferenceAgeSeconds: 600,
    maxClockSkewSeconds: 30,
  });
}

async function resumeCloudflareOperatorReleaseUpdate(
  input: ParsedReleaseUpdateRequest,
  configuration: PrivateReleaseUpdateConfiguration,
  coordinator: DurableObjectFreshnessIssueCoordinatorAdapter,
): Promise<void> {
  let operation = await coordinator.getReleaseOperation(input.operationId);
  if (operation === null) {
    throw new Error("Admitted Release update operation is missing");
  }
  if (
    !operation.releaseSigningRequired ||
    operation.expectedHead === null ||
    operation.expectedCurrentStateSha256 === null ||
    operation.expectedRestoreEpoch === null
  ) {
    throw new RuntimeConfigDomainError(
      "INVALID_BINDING",
      "Release update is not an admitted cloudflare-operator-v1 ADVANCE",
    );
  }
  const fencingToken = operation.fencingToken;
  const expectedCurrentStateSha256 = operation.expectedCurrentStateSha256;
  const expectedRestoreEpoch = operation.expectedRestoreEpoch;
  if (fencingToken === null) {
    throw new Error("Release update operation has no persisted writer fence");
  }
  if (
    expectedCurrentStateSha256 === null ||
    expectedRestoreEpoch === null
  ) {
    throw new Error("Release update operation has no ADVANCE install binding");
  }

  if (operation.status === "INTENT") {
    operation = (
      await coordinator.stageReleaseManifest({
        operationId: operation.operationId,
        fencingToken,
      })
    ).operation;
  }
  if (
    operation.status === "R2_WRITE_PENDING" ||
    (operation.status === "RESULT_UNKNOWN" &&
      operation.unknownStage === "R2_WRITE")
  ) {
    operation = (
      await coordinator.reconcileReleaseOperation({
        operationId: operation.operationId,
        fencingToken,
      })
    ).operation;
  }

  if (
    operation.status === "R2_STAGED" ||
    (operation.status === "RESULT_UNKNOWN" &&
      operation.unknownStage === "RELEASE_SIGNER")
  ) {
    const claim: ReleaseRecordSigningClaim =
      await coordinator.claimReleaseRecordSigning({
        operationId: operation.operationId,
        fencingToken,
        releaseDelegationBytes: configuration.releaseDelegationBytes,
      });
    if (claim.status === "CLAIMED") {
      const signedRecordBytes = await signRuntimeConfigReleaseCommitRecord({
        payload: claim.payload,
        signerKeyId: configuration.releaseSignerKeyId,
        privateKey: configuration.releaseSignerPrivateKey,
      });
      operation = (
        await coordinator.storeReleaseRecordSignature({
          operationId: operation.operationId,
          fencingToken,
          recordBytes: signedRecordBytes,
        })
      ).operation;
    } else {
      operation = claim.operation;
    }
    if (
      operation.status === "R2_STAGED" &&
      operation.signedRecordBytes !== null
    ) {
      operation = (
        await coordinator.appendReleaseRecord({
          operationId: operation.operationId,
          fencingToken,
          recordBytes: operation.signedRecordBytes,
          releaseDelegationBytes: configuration.releaseDelegationBytes,
        })
      ).operation;
    }
  }

  if (
    operation.status === "LEDGER_COMMITTED" ||
    operation.status === "R2_READBACK_PENDING" ||
    (operation.status === "RESULT_UNKNOWN" &&
      operation.unknownStage === "R2_READBACK")
  ) {
    operation = (
      operation.status === "RESULT_UNKNOWN"
        ? await coordinator.reconcileReleaseOperation({
            operationId: operation.operationId,
            fencingToken,
          })
        : await coordinator.finalizeReleaseR2Readback({
            operationId: operation.operationId,
            fencingToken,
          })
    ).operation;
  }

  if (operation.status !== "AVAILABLE") return;
  const install = await coordinator.beginCloudflareOperatorBindingInstall({
    operationId: operation.operationId,
    mode: "ADVANCE",
    releaseOperationId: operation.operationId,
    expectedCurrentStateSha256,
    expectedRestoreEpoch,
  });
  if (install.status === "CONFLICT") {
    throw new RuntimeConfigDomainError(
      "INVALID_BINDING",
      "ADVANCE install does not match the persisted predecessor binding",
    );
  }
  if (install.status !== "STARTED") return;
  await coordinator.finalizeCloudflareOperatorBindingInstall({
    operationId: operation.operationId,
  });
}

function releaseManagementFailure(error: unknown): Response {
  const errorName = remoteErrorName(error);
  const storageErrorCode = remoteCoordinatorStorageErrorCode(error);
  if (storageErrorCode !== null) {
    logFailure("private_signer_release_update_rejected", error);
    if (storageErrorCode === "INVALID_INPUT") {
      return jsonResponse(400, "invalid_release_update");
    }
    if (
      storageErrorCode === "PROFILE_MISMATCH" ||
      storageErrorCode === "RELEASE_CONFLICT" ||
      storageErrorCode === "RELEASE_BLOCKED" ||
      storageErrorCode === "ILLEGAL_TRANSITION"
    ) {
      return jsonResponse(409, "release_update_not_available");
    }
    return jsonResponse(503, "release_update_unavailable");
  }
  if (
    error instanceof RuntimeConfigDomainError ||
    errorName === "RuntimeConfigDomainError" ||
    error instanceof RuntimeConfigR2ReleaseConflictError ||
    errorName === "RuntimeConfigR2ReleaseConflictError" ||
    error instanceof RuntimeConfigR2ReleaseIntegrityError ||
    errorName === "RuntimeConfigR2ReleaseIntegrityError"
  ) {
    logFailure("private_signer_release_update_material_rejected", error);
    return jsonResponse(409, "release_update_rejected");
  }
  logFailure("private_signer_release_update_failed", error);
  return jsonResponse(503, "release_update_unavailable");
}

async function handleReleaseManagementRequest(
  request: Request,
  env: PrivateFreshnessSignerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const operationMatch =
    /^\/__private\/admin\/release\/([0-9a-f-]{36})$/u.exec(url.pathname);
  const isUpdatePath = url.pathname === RELEASE_ADMIN_PATH;
  if (!isUpdatePath && operationMatch === null) return null;
  if (url.origin !== PRIVATE_SERVICE_ORIGIN || url.search.length !== 0) {
    return jsonResponse(404, "not_found");
  }
  const expectedMethod = isUpdatePath ? "POST" : "GET";
  if (request.method !== expectedMethod) {
    return new Response(null, {
      status: 405,
      headers: {
        allow: expectedMethod,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (!hasReleaseAdminCapability(request, env)) {
    await cancelRequestBody(request);
    return jsonResponse(403, "forbidden");
  }
  if (!isUpdatePath) {
    if (
      request.body !== null ||
      (request.headers.has("content-length") &&
        request.headers.get("content-length") !== "0")
    ) {
      await cancelRequestBody(request);
      return jsonResponse(400, "invalid_request");
    }
    const operationId = operationMatch?.[1];
    if (operationId === undefined) return jsonResponse(404, "not_found");
    try {
      const coordinatorName = requiredString(
        env.FRESHNESS_COORDINATOR_NAME,
        "Freshness coordinator identity",
      );
      const coordinator = releaseUpdateCoordinatorFor(env, coordinatorName);
      return await releaseUpdateOperationResponse(coordinator, operationId);
    } catch (error) {
      return releaseManagementFailure(error);
    }
  }
  if (mediaType(request.headers.get("content-type")) !== "application/json") {
    return jsonResponse(415, "unsupported_media_type");
  }
  const contentEncoding = request.headers.get("content-encoding");
  if (
    contentEncoding !== null &&
    contentEncoding.toLowerCase() !== "identity"
  ) {
    return jsonResponse(415, "unsupported_media_type");
  }
  let requestBytes: Uint8Array;
  try {
    requestBytes = await readBoundedBody(request, RELEASE_ADMIN_MAX_BODY_BYTES);
  } catch (error) {
    if (!(error instanceof BoundedBodyError)) throw error;
    return jsonResponse(
      error.reason === "too-large" ? 413 : 400,
      error.reason === "too-large" ? "request_too_large" : "invalid_request",
    );
  }
  let input: ParsedReleaseUpdateRequest;
  try {
    input = parseReleaseUpdateRequest(requestBytes);
  } catch (error) {
    if (!(error instanceof BoundedBodyError)) throw error;
    return jsonResponse(
      error.reason === "too-large" ? 413 : 400,
      error.reason === "too-large" ? "request_too_large" : "invalid_request",
    );
  }

  try {
    const configuration = await releaseUpdateConfigurationFor(env);
    const coordinator = releaseUpdateCoordinatorFor(
      env,
      configuration.coordinatorName,
    );
    await verifyReleaseUpdateManifest(input, configuration);
    const snapshot = await coordinator.readCloudflareOperatorReleaseSnapshot();
    if (
      snapshot.profileId !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
      snapshot.environment !== "production" ||
      snapshot.chainId !== configuration.chainId ||
      snapshot.currentState === null ||
      snapshot.head === null
    ) {
      throw new RuntimeConfigDomainError(
        "INVALID_BINDING",
        "Release update target is not an initialized cloudflare-operator-v1 coordinator",
      );
    }

    const existing = await coordinator.getReleaseOperation(input.operationId);
    const expectedHead: ReleaseLedgerHeadBinding | null = existing === null
      ? await coordinator.readReleaseLedgerHead()
      : existing.expectedHead === null
      ? null
      : {
          environment: existing.environment,
          chainId: existing.chainId,
          ...existing.expectedHead,
        };
    const admitted = await coordinator.beginReleaseOperation({
      operationId: input.operationId,
      expectedHead,
      manifestBytes: input.manifestBytes,
      publicationObjects: input.publicationObjects,
    });
    if (admitted.status === "CONFLICT") {
      return jsonResponse(409, "release_update_not_available");
    }
    if (
      admitted.operation.releaseSigningRequired &&
      admitted.operation.expectedHead !== null
    ) {
      await resumeCloudflareOperatorReleaseUpdate(
        input,
        configuration,
        coordinator,
      );
    }
    return await releaseUpdateOperationResponse(
      coordinator,
      input.operationId,
    );
  } catch (error) {
    return releaseManagementFailure(error);
  }
}

async function handleFreshnessRequest(
  request: Request,
  env: PrivateFreshnessSignerEnv,
  context: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.origin !== PRIVATE_SERVICE_ORIGIN ||
    url.pathname !== runtimeConfigFreshnessWire.requestPath ||
    url.search.length !== 0
  ) {
    return jsonResponse(404, "not_found");
  }
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: {
        allow: "POST",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (mediaType(request.headers.get("content-type")) !== "application/json") {
    return jsonResponse(415, "unsupported_media_type");
  }
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding !== null && contentEncoding.toLowerCase() !== "identity") {
    return jsonResponse(415, "unsupported_media_type");
  }

  let requestBytes: Uint8Array;
  try {
    requestBytes = await readBoundedBody(request);
  } catch (error) {
    if (!(error instanceof BoundedBodyError)) throw error;
    return jsonResponse(
      error.reason === "too-large" ? 413 : 400,
      error.reason === "too-large" ? "request_too_large" : "invalid_request",
    );
  }

  let manifestUrl: string;
  let audienceManifestUrlSha256: string;
  try {
    manifestUrl = await configuredManifestUrl(env);
    audienceManifestUrlSha256 =
      await runtimeConfigManifestAudienceSha256(manifestUrl);
  } catch {
    logFailure("private_signer_configuration_invalid");
    return jsonResponse(503, "freshness_unavailable");
  }

  let challenge;
  try {
    challenge = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
      environment: "production",
      audienceManifestUrlSha256,
    });
    if (!equalBytes(requestBytes, canonicalJsonBytes(challenge))) {
      return jsonResponse(400, "invalid_freshness_request");
    }
  } catch (error) {
    if (error instanceof RuntimeConfigDomainError) {
      return jsonResponse(400, "invalid_freshness_request");
    }
    logFailure("private_signer_request_verification_failed");
    return jsonResponse(503, "freshness_unavailable");
  }

  let dependencies: PrivateFreshnessSignerDependencies;
  try {
    dependencies = await dependenciesFor(env);
  } catch {
    logFailure("private_signer_configuration_invalid");
    return jsonResponse(503, "freshness_unavailable");
  }

  let operationId: string;
  try {
    operationId = await deriveCloudflareOperatorFreshnessOperationId({
      manifestUrl,
      chainId: dependencies.chainId,
      requestBytes,
    });
  } catch {
    logFailure("private_signer_operation_identity_failed");
    return jsonResponse(503, "freshness_unavailable");
  }

  const operation = issueCloudflareOperatorFreshness(
    { operationId, requestBytes },
    dependencies.issueDependencies,
  );
  context.waitUntil(
    operation.then(
      () => undefined,
      (error: unknown) => {
        logFailure("private_signer_issue_failed", error);
      },
    ),
  );
  let result: Awaited<typeof operation>;
  try {
    result = await operation;
  } catch {
    return jsonResponse(503, "freshness_unavailable");
  }
  if (
    result.status !== "ISSUED" &&
    result.status !== "ALREADY_FINALIZED"
  ) {
    logFailure("private_signer_result_not_finalized");
    return jsonResponse(503, "freshness_unavailable");
  }
  if (
    result.responseBytes.byteLength === 0 ||
    result.responseBytes.byteLength > runtimeConfigFreshnessWire.maxResponseBytes ||
    result.responseLength !== result.responseBytes.byteLength
  ) {
    logFailure("private_signer_finalized_response_invalid");
    return jsonResponse(503, "freshness_unavailable");
  }
  let responseSha256: string;
  try {
    responseSha256 = await hashBase64Url(result.responseBytes);
  } catch {
    logFailure("private_signer_finalized_response_hash_failed");
    return jsonResponse(503, "freshness_unavailable");
  }
  if (responseSha256 !== result.responseSha256) {
    logFailure("private_signer_finalized_response_hash_mismatch");
    return jsonResponse(503, "freshness_unavailable");
  }
  return new Response(exactArrayBuffer(result.responseBytes), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
    },
  });
}

const privateFreshnessSigner = {
  async fetch(
    request: Request,
    env: PrivateFreshnessSignerEnv,
    context: ExecutionContext,
  ): Promise<Response> {
    const genesisResponse = await handleGenesisManagementRequest(request, env);
    if (genesisResponse !== null) return genesisResponse;
    const releaseResponse = await handleReleaseManagementRequest(request, env);
    if (releaseResponse !== null) return releaseResponse;
    return handleFreshnessRequest(request, env, context);
  },
} satisfies ExportedHandler<PrivateFreshnessSignerEnv>;

export default privateFreshnessSigner;
