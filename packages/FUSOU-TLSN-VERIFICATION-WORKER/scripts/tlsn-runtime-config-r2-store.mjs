import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export const RUNTIME_CONFIG_R2_ENV = Object.freeze({
  accountId: "TLSN_RUNTIME_CONFIG_R2_ACCOUNT_ID",
  bucket: "TLSN_RUNTIME_CONFIG_R2_BUCKET",
  accessKeyId: "TLSN_RUNTIME_CONFIG_R2_ACCESS_KEY_ID",
  secretAccessKey: "TLSN_RUNTIME_CONFIG_R2_SECRET_ACCESS_KEY",
});

const MANIFEST_KEY = "tlsn/runtime-config/v2/manifest.json";
const IMMUTABLE_PREFIX = "tlsn/runtime-config/v2/artifacts/";
const IMMUTABLE_KEY_PATTERN =
  /^tlsn\/runtime-config\/v2\/artifacts\/(?:worker-reference|origin-inventory|target-approval|security-registry-set|result-registry-envelope)\/[A-Za-z0-9_-]{43}$/;
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
]);
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export function isValidRuntimeConfigR2AccountId(value) {
  return typeof value === "string" && ACCOUNT_ID_PATTERN.test(value);
}

export function isValidRuntimeConfigR2BucketName(value) {
  return typeof value === "string" && BUCKET_NAME_PATTERN.test(value);
}

export class RuntimeConfigR2ConfigurationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RuntimeConfigR2ConfigurationError";
  }
}

export class RuntimeConfigArtifactConflictError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RuntimeConfigArtifactConflictError";
  }
}

export class RuntimeConfigR2BucketError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RuntimeConfigR2BucketError";
  }
}

export class RuntimeConfigArtifactIntegrityError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RuntimeConfigArtifactIntegrityError";
  }
}

export class RuntimeConfigPointerConflictError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RuntimeConfigPointerConflictError";
  }
}

export class RuntimeConfigPointerOutcomeUnknownError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RuntimeConfigPointerOutcomeUnknownError";
  }
}

export class RuntimeConfigPointerIntegrityError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RuntimeConfigPointerIntegrityError";
  }
}

export class RuntimeConfigWriteOutcomeUnknownError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RuntimeConfigWriteOutcomeUnknownError";
  }
}

function isPresent(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function inspectRuntimeConfigR2Environment(env = process.env) {
  const accountId = env[RUNTIME_CONFIG_R2_ENV.accountId];
  const bucket = env[RUNTIME_CONFIG_R2_ENV.bucket];
  const accessKeyId = env[RUNTIME_CONFIG_R2_ENV.accessKeyId];
  const secretAccessKey = env[RUNTIME_CONFIG_R2_ENV.secretAccessKey];
  return Object.freeze({
    account_id: !isPresent(accountId)
      ? "MISSING"
      : isValidRuntimeConfigR2AccountId(accountId) ? "PRESENT_FORMAT_VALID" : "INVALID_FORMAT",
    bucket: !isPresent(bucket)
      ? "MISSING"
      : isValidRuntimeConfigR2BucketName(bucket) ? "PRESENT_FORMAT_VALID" : "INVALID_FORMAT",
    access_key_id: isPresent(accessKeyId) ? "PRESENT_UNVERIFIED" : "MISSING",
    secret_access_key: isPresent(secretAccessKey) ? "PRESENT_UNVERIFIED" : "MISSING",
  });
}

function assertRequestTimeout(requestTimeoutMs) {
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 120_000
  ) {
    throw new RuntimeConfigR2ConfigurationError(
      "Runtime Config R2 request timeout must be an integer from 1 through 120000 milliseconds",
    );
  }
}

function readRuntimeConfigR2Settings(env) {
  const readiness = inspectRuntimeConfigR2Environment(env);
  const environmentNameByField = {
    account_id: RUNTIME_CONFIG_R2_ENV.accountId,
    bucket: RUNTIME_CONFIG_R2_ENV.bucket,
    access_key_id: RUNTIME_CONFIG_R2_ENV.accessKeyId,
    secret_access_key: RUNTIME_CONFIG_R2_ENV.secretAccessKey,
  };
  const missing = Object.entries(readiness)
    .filter(([, state]) => state === "MISSING")
    .map(([name]) => environmentNameByField[name]);
  if (missing.length > 0) {
    throw new RuntimeConfigR2ConfigurationError(
      `Runtime Config R2 configuration is missing required fields: ${missing.join(", ")}`,
    );
  }
  if (readiness.account_id !== "PRESENT_FORMAT_VALID") {
    throw new RuntimeConfigR2ConfigurationError(
      `Runtime Config R2 account ID must be 32 hexadecimal characters (${RUNTIME_CONFIG_R2_ENV.accountId})`,
    );
  }
  if (readiness.bucket !== "PRESENT_FORMAT_VALID") {
    throw new RuntimeConfigR2ConfigurationError(
      `Runtime Config R2 bucket name must contain 3-63 lowercase letters, digits, or internal hyphens (${RUNTIME_CONFIG_R2_ENV.bucket})`,
    );
  }
  const bucket = env[RUNTIME_CONFIG_R2_ENV.bucket];
  return Object.freeze({
    accountId: env[RUNTIME_CONFIG_R2_ENV.accountId].toLowerCase(),
    bucket,
    accessKeyId: env[RUNTIME_CONFIG_R2_ENV.accessKeyId],
    secretAccessKey: env[RUNTIME_CONFIG_R2_ENV.secretAccessKey],
  });
}

function assertETag(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new RuntimeConfigR2ConfigurationError("R2 returned an invalid object ETag");
  }
  return value;
}

function assertSupportedKey(key) {
  if (key !== MANIFEST_KEY && !IMMUTABLE_KEY_PATTERN.test(key)) {
    throw new RuntimeConfigR2ConfigurationError(
      "Runtime Config R2 object key is outside the versioned publication namespace",
    );
  }
}

function assertManifestObject(object) {
  if (
    !object ||
    object.key !== MANIFEST_KEY ||
    !(object.body instanceof Uint8Array) ||
    object.content_type !== "application/json" ||
    object.cache_control !== "no-store"
  ) {
    throw new RuntimeConfigR2ConfigurationError(
      "Runtime Config manifest publication object has an invalid key, body, or metadata",
    );
  }
  return Buffer.from(object.body);
}

function assertImmutableObject(object) {
  if (
    !object ||
    typeof object.key !== "string" ||
    !object.key.startsWith(IMMUTABLE_PREFIX) ||
    !(object.body instanceof Uint8Array) ||
    object.content_type !== "application/octet-stream" ||
    object.cache_control !== "public, max-age=31536000, immutable"
  ) {
    throw new RuntimeConfigR2ConfigurationError(
      "Runtime Config immutable artifact has an invalid key, body, or metadata",
    );
  }
  assertSupportedKey(object.key);
  const body = Buffer.from(object.body);
  const digest = createHash("sha256").update(body).digest("base64url");
  if (!object.key.endsWith(`/${digest}`)) {
    throw new RuntimeConfigArtifactIntegrityError(
      "Runtime Config immutable artifact key does not match its exact body digest",
    );
  }
  return body;
}

function statusCode(error) {
  return error?.$metadata?.httpStatusCode;
}

function errorCode(error) {
  return error?.Code ?? error?.code ?? error?.name;
}

function isNoSuchBucket(error) {
  return errorCode(error) === "NoSuchBucket";
}

function isNotFound(error) {
  return ["NoSuchKey", "NotFound", "NoSuchObject"].includes(errorCode(error)) ||
    statusCode(error) === 404;
}

function isConditionalConflict(error) {
  return [409, 412].includes(statusCode(error)) ||
    ["ConditionalRequestConflict", "PreconditionFailed"].includes(errorCode(error));
}

function isAmbiguousWriteFailure(error) {
  const status = statusCode(error);
  const code = error?.code;
  return status === 408 ||
    (Number.isInteger(status) && status >= 500) ||
    NETWORK_ERROR_CODES.has(code) ||
    error?.name === "AbortError" ||
    error?.name === "TimeoutError";
}

async function responseBodyBytes(body) {
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body && typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  if (body && typeof body[Symbol.asyncIterator] === "function") {
    const chunks = [];
    for await (const chunk of body) {
      if (!(chunk instanceof Uint8Array)) {
        throw new RuntimeConfigR2ConfigurationError(
          "R2 returned a non-byte object body chunk",
        );
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new RuntimeConfigR2ConfigurationError("R2 returned no readable object body");
}

export function createR2RuntimeConfigObjectStore({
  bucket,
  client,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}) {
  if (!isValidRuntimeConfigR2BucketName(bucket)) {
    throw new RuntimeConfigR2ConfigurationError(
      "Runtime Config R2 bucket name must contain 3-63 lowercase letters, digits, or internal hyphens",
    );
  }
  if (!client || typeof client.send !== "function") {
    throw new RuntimeConfigR2ConfigurationError("Runtime Config R2 S3 client is required");
  }
  assertRequestTimeout(requestTimeoutMs);

  const send = (command) => client.send(command, {
    abortSignal: AbortSignal.timeout(requestTimeoutMs),
  });

  async function readObject(key) {
    assertSupportedKey(key);
    let response;
    try {
      response = await send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      if (isNoSuchBucket(error)) {
        throw new RuntimeConfigR2BucketError(
          "Configured Runtime Config R2 bucket does not exist or is unavailable",
          { cause: error },
        );
      }
      if (isNotFound(error)) return null;
      throw error;
    }
    return Object.freeze({
      body: await responseBodyBytes(response.Body),
      etag: assertETag(response.ETag),
    });
  }

  async function reconcileImmutableWrite(key, expectedBody, writeError, outcomeUnknown) {
    let existing;
    try {
      existing = await readObject(key);
    } catch (readError) {
      throw new RuntimeConfigWriteOutcomeUnknownError(
        "Runtime Config immutable write could not be reconciled by readback",
        { cause: new AggregateError([writeError, readError]) },
      );
    }
    if (existing?.body.equals(expectedBody)) {
      return Object.freeze({ state: "ALREADY_PRESENT", etag: existing.etag });
    }
    if (existing) {
      throw new RuntimeConfigArtifactIntegrityError(
        "Runtime Config immutable key already contains different bytes",
        { cause: writeError },
      );
    }
    if (outcomeUnknown) {
      throw new RuntimeConfigWriteOutcomeUnknownError(
        "Runtime Config immutable write outcome is unknown; no automatic retry was attempted",
        { cause: writeError },
      );
    }
    throw new RuntimeConfigArtifactConflictError(
      "Runtime Config immutable create was rejected but no object was readable",
      { cause: writeError },
    );
  }

  async function reconcileManifestWrite(expectedETag, expectedBody, writeError) {
    let current;
    try {
      current = await readObject(MANIFEST_KEY);
    } catch (readError) {
      throw new RuntimeConfigPointerOutcomeUnknownError(
        "Runtime Config manifest write outcome could not be reconciled by readback",
        { cause: new AggregateError([writeError, readError]) },
      );
    }
    if (current?.body.equals(expectedBody)) return current.etag;

    const changed = current === null
      ? expectedETag !== null
      : current.etag !== expectedETag;
    if (changed) {
      throw new RuntimeConfigPointerConflictError(
        "Runtime Config manifest pointer changed during conditional publication",
        { cause: writeError },
      );
    }
    throw new RuntimeConfigPointerOutcomeUnknownError(
      "Runtime Config manifest write outcome is unknown; no automatic retry was attempted",
      { cause: writeError },
    );
  }

  return Object.freeze({
    async getManifestState() {
      const current = await readObject(MANIFEST_KEY);
      return current && Object.freeze({
        body: Buffer.from(current.body),
        etag: current.etag,
      });
    },

    async putImmutable(object) {
      const body = assertImmutableObject(object);
      try {
        await send(new PutObjectCommand({
          Bucket: bucket,
          Key: object.key,
          Body: body,
          ContentType: object.content_type,
          CacheControl: object.cache_control,
          IfNoneMatch: "*",
        }));
        return Object.freeze({ state: "CREATED" });
      } catch (error) {
        if (isConditionalConflict(error)) {
          return reconcileImmutableWrite(
            object.key,
            body,
            error,
            statusCode(error) === 409 || errorCode(error) === "ConditionalRequestConflict",
          );
        }
        if (isAmbiguousWriteFailure(error)) {
          return reconcileImmutableWrite(object.key, body, error, true);
        }
        throw error;
      }
    },

    async getObject(key) {
      const object = await readObject(key);
      return object ? Buffer.from(object.body) : null;
    },

    async compareAndSwapManifest(expectedETag, object) {
      const body = assertManifestObject(object);
      if (expectedETag !== null) assertETag(expectedETag);
      const input = {
        Bucket: bucket,
        Key: MANIFEST_KEY,
        Body: body,
        ContentType: object.content_type,
        CacheControl: object.cache_control,
        ...(expectedETag === null
          ? { IfNoneMatch: "*" }
          : { IfMatch: expectedETag }),
      };
      let response;
      try {
        response = await send(new PutObjectCommand(input));
      } catch (error) {
        if (isConditionalConflict(error)) {
          return reconcileManifestWrite(expectedETag, body, error);
        }
        if (isAmbiguousWriteFailure(error)) {
          return reconcileManifestWrite(expectedETag, body, error);
        }
        throw error;
      }
      if (
        typeof response?.ETag === "string" &&
        response.ETag.length > 0 &&
        response.ETag.trim() === response.ETag
      ) {
        return response.ETag;
      }
      return reconcileManifestWrite(
        expectedETag,
        body,
        new RuntimeConfigPointerOutcomeUnknownError(
          "R2 accepted the manifest write without returning a usable ETag",
        ),
      );
    },
  });
}

export function createCloudflareR2RuntimeConfigObjectStore({
  env = process.env,
  client,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const settings = readRuntimeConfigR2Settings(env);
  const runtimeClient = client ?? new S3Client({
    endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
  return createR2RuntimeConfigObjectStore({
    bucket: settings.bucket,
    client: runtimeClient,
    requestTimeoutMs,
  });
}
