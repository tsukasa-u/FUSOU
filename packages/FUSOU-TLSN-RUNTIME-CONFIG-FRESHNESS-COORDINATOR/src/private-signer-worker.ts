import {
  canonicalJsonBytes,
  encodeBase64Url,
  RuntimeConfigDomainError,
  runtimeConfigFreshnessWire,
  runtimeConfigManifestAudienceSha256,
  verifyRuntimeConfigFreshnessRequest,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";
import type {
  RuntimeConfigRootSigner,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";
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
  RuntimeConfigR2ReleaseStore,
} from "./r2-release-store.ts";
import type {
  CoordinatorEnv,
  SqliteFreshnessIssueCoordinatorDO,
} from "./sqlite-freshness-issue-coordinator.ts";

export {
  SqliteFreshnessIssueCoordinatorDO,
} from "./sqlite-freshness-issue-coordinator.ts";

const PRIVATE_SERVICE_ORIGIN = "https://freshness-signer.internal";
const CONFIG_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CHAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_DELEGATION_BYTES = 8_192;
const ED25519_PKCS8_BYTES = 48;
const ED25519_SPKI_BYTES = 44;
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

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  const lengthState = declaredLength(
    contentLength,
    runtimeConfigFreshnessWire.maxRequestBytes,
  );
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
        next.value.byteLength >
        runtimeConfigFreshnessWire.maxRequestBytes - byteLength
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
    return handleFreshnessRequest(request, env, context);
  },
} satisfies ExportedHandler<PrivateFreshnessSignerEnv>;

export default privateFreshnessSigner;
