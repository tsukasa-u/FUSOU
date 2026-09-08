import { Hono } from "hono";
import { z } from "zod";
import {
  BindingAuthorityError,
  DurableObjectBindingAuthority,
  TlsnBindingAuthorityDurableObject,
  encodeBase64Url,
} from "./binding_authority.js";
import {
  attestationConsumeReceiptSigningBytes,
  attestationSessionReceiptSigningBytes,
} from "./attestation_receipts.js";
import initVerifier, {
  attach_verifier_result_signature,
  verify_require_info_presentation,
  verify_require_info_presentation_with_trust_anchor,
} from "./wasm/fusou_tlsn_verifier.js";
import wasmModule from "./wasm/fusou_tlsn_verifier_bg.wasm";

type Bindings = {
  TLSN_ENVIRONMENT: string;
  TLSN_BINDINGS: DurableObjectNamespace;
  TLSN_BINDING_TTL_SECONDS: string;
  TLSN_SERVER_IDENTITY: string;
  TLSN_PROFILE_SHA256: string;
  TLSN_VERIFIER_KEY_ID: string;
  TLSN_NOTARY_KEY_ID: string;
  TLSN_NOTARY_REGISTRY: string;
  TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8: string;
  TLSN_TRUST_ROOT_CERTIFICATE_DER?: string;
  TLSN_TEST_BINDING_VALUE?: string;
  TLSN_CANDIDATE_SERVER_IDENTITY?: string;
  TLSN_CANDIDATE_PROFILE_SHA256?: string;
  TLSN_CANDIDATE_VERIFIER_KEY_ID?: string;
  TLSN_CANDIDATE_NOTARY_KEY_ID?: string;
  TLSN_CANDIDATE_NOTARY_REGISTRY?: string;
  TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS?: string;
  TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS?: string;
  TLSN_CANDIDATE_SUPABASE_URL?: string;
  TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY?: string;
  TLSN_CANDIDATE_DEVICE_AUTH_URL?: string;
  TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL?: string;
  TLSN_SUPABASE_URL?: string;
  TLSN_SUPABASE_PUBLISHABLE_KEY?: string;
  TLSN_CANARY_DEPLOYMENT_ID?: string;
  TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8?: string;
  TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER?: string;
  TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI?: string;
  TLSN_CANARY_RESULT_SIGNER_KEY_ID?: string;
  TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY?: string;
  TLSN_CANARY_WORKER_NAME?: string;
  TLSN_PRODUCTION_DEPLOYMENT_ID?: string;
  TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8?: string;
  TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER?: string;
  TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI?: string;
  TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID?: string;
  TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY?: string;
  TLSN_PRODUCTION_WORKER_NAME?: string;
  TLSN_DEPLOYMENT_ROLE?: string;
  TLSN_GIT_COMMIT_SHA?: string;
  TLSN_CANARY_BINDING_VALUE?: string;
  TLSN_SECURITY_REGISTRY_SET_SHA256?: string;
  TLSN_DEVICE_AUTH_URL?: string;
  TLSN_DEVICE_POSSESSION_AUTH_URL?: string;
  TLSN_TEST_AUTH_USERS?: string;
};

const MAX_PRESENTATION_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_JSON_BYTES = 12 * 1024 * 1024;
const MAX_PRESENTATION_BASE64_LENGTH = Math.ceil(MAX_PRESENTATION_BYTES * 4 / 3) + 4;
const MAX_RESULT_JSON_BYTES = 25_165_824;

const requestSchema = z
  .object({
    presentation_base64: z
      .string()
      .min(1)
      .max(MAX_PRESENTATION_BASE64_LENGTH)
      .regex(/^[A-Za-z0-9_-]+$/),
    session_id: z.string().uuid(),
    binding: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/),
    device_id: z.string().uuid(),
    device_proof: z.object({
      challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      sig: z.string().min(1).max(256).regex(/^[A-Za-z0-9+/_=-]+$/),
    }).strict(),
  })
  .strict();

const deviceProofRequestSchema = z
  .object({
    device_id: z.string().uuid(),
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
    sig: z.string().min(1).max(256).regex(/^[A-Za-z0-9+/_=-]+$/),
  })
  .strict();

const authenticatedResultSchema = z.object({
  attestation_session_id: z.string().uuid(),
  canonical_user_id: z.string().uuid(),
  device_id: z.string().uuid(),
  device_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  binding_nonce: z.string().regex(/^[A-Za-z0-9_-]+$/),
  binding_value: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/),
  tlsn_attestation_id: z.string().regex(/^[A-Za-z0-9_-]+$/),
});

const preparedResultSchema = z
  .object({
    unsigned_result: z.string().min(1).max(MAX_RESULT_JSON_BYTES),
    signing_bytes: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

const configSchema = z.object({
  environment: z.enum(["test", "production"]),
  serverIdentity: z.string().min(1).max(253),
  profileSha256: z.string().regex(/^[A-Za-z0-9_-]+$/),
  verifierKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  notaryKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  deviceAuthUrl: z.string().url(),
  devicePossessionAuthUrl: z.string().url(),
  deviceAuthAllowedHosts: z.string().optional(),
  notaryRegistry: z.string().min(1).max(65_536),
  signingPrivateKeyPkcs8: z.string().regex(/^[A-Za-z0-9_-]+$/),
  trustRootCertificateDer: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  resultPublicKeySpki: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  resultSignerKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/).optional(),
  resultSigningKeyRegistry: z.string().min(1).optional(),
});

const resultSigningKeyEntrySchema = z.object({
  key_id: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  public_key_spki: z.string().regex(/^[A-Za-z0-9_-]{59}$/),
  status: z.enum(["ACTIVE", "VERIFY_ONLY", "RETIRED", "REVOKED"]),
  not_before: z.string(),
  not_after: z.string().nullable(),
}).strict();

const resultSigningKeyRegistrySchema = z.object({
  schema_version: z.literal(1),
  scope: z.literal("tlsn-result-signing-key-registry"),
  keys: z.array(resultSigningKeyEntrySchema).min(1),
}).strict().superRefine((registry, context) => {
  const seenKeyIds = new Set<string>();
  registry.keys.forEach((key, index) => {
    if (seenKeyIds.has(key.key_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keys", index, "key_id"],
        message: "result signing key IDs must be unique",
      });
    }
    seenKeyIds.add(key.key_id);
    const notBefore = Date.parse(key.not_before);
    if (!Number.isFinite(notBefore)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keys", index, "not_before"],
        message: "not_before must be an ISO timestamp",
      });
    }
    if (key.not_after !== null) {
      const notAfter = Date.parse(key.not_after);
      if (!Number.isFinite(notAfter)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keys", index, "not_after"],
          message: "not_after must be an ISO timestamp or null",
        });
      } else if (Number.isFinite(notBefore) && notAfter <= notBefore) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keys", index, "not_after"],
          message: "not_after must be after not_before",
        });
      }
    }
  });
});

const authUserSchema = z.object({
  id: z.string().uuid(),
  is_anonymous: z.boolean(),
}).passthrough();

const testAuthUsersSchema = z.record(z.string().min(1), authUserSchema);

type AuthenticatedSubject = {
  canonicalUserId: string;
  accessToken: string;
};

type AuthenticationResult =
  | { ok: true; subject: AuthenticatedSubject }
  | { ok: false; status: 401 | 503; error: "unauthorized" | "auth_unconfigured" };

const notaryRegistrySchema = z.record(
  z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  z.string().regex(/^[A-Za-z0-9_-]+$/),
);

type VerifierConfig = z.infer<typeof configSchema> & {
  profileSha256Bytes: Uint8Array;
  notaryKeyBytes: Uint8Array;
  signingPrivateKeyBytes: Uint8Array;
  trustRootCertificateDerBytes: Uint8Array | undefined;
  bindingTtlSeconds: number;
};

const app = new Hono<{ Bindings: Bindings }>();
let wasmInitialization: Promise<void> | undefined;

function decodeBase64Url(value: string, maximumBytes: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("invalid base64url");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  if (binary.length === 0 || binary.length > maximumBytes) {
    throw new Error("base64url value exceeds the configured limit");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) {
    throw new Error("non-canonical base64url");
  }
  return bytes;
}

const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function parseHostnameAllowlist(value: string | undefined): Set<string> | null {
  if (!value) return null;
  const hosts = value
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
  if (hosts.length === 0 || hosts.some((host) => !DNS_HOSTNAME_PATTERN.test(host))) {
    return null;
  }
  return new Set(hosts);
}

function isAllowedProductionHttpsUrl(
  value: string,
  pathname: string,
  allowedHosts: Set<string>,
): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === "" &&
      allowedHosts.has(url.hostname.toLowerCase()) &&
      url.pathname === pathname
    );
  } catch {
    return false;
  }
}

function containsTestFixtureMarker(value: string): boolean {
  return /(?:^|[._-])(test|synthetic|fixture|local|staging)(?:$|[._-])/i.test(value);
}

function isSafeDeploymentId(value: string | undefined): boolean {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

function isSha256Base64Url(value: string | undefined): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isPublicKeyBase64Url(value: string | undefined): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{59}$/.test(value);
}

function readConfig(env: Bindings): VerifierConfig | null {
  const production = env.TLSN_ENVIRONMENT === "production";
  const role = env.TLSN_DEPLOYMENT_ROLE;
  const canary = production && role === "canary";
  const signingPrivateKey = production
    ? canary ? env.TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8 : env.TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8
    : env.TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8;
  const trustRootCertificateDer = production
    ? canary ? env.TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER : env.TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER
    : env.TLSN_TRUST_ROOT_CERTIFICATE_DER;
  const resultPublicKeySpki = production
    ? canary ? env.TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI : env.TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI
    : undefined;
  const resultSignerKeyId = production
    ? canary ? env.TLSN_CANARY_RESULT_SIGNER_KEY_ID : env.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID
    : undefined;
  const resultSigningKeyRegistry = production
    ? canary ? env.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY : env.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY
    : undefined;
  const parsed = configSchema.safeParse({
    environment: env.TLSN_ENVIRONMENT,
    serverIdentity: production ? env.TLSN_CANDIDATE_SERVER_IDENTITY : env.TLSN_SERVER_IDENTITY,
    profileSha256: production ? env.TLSN_CANDIDATE_PROFILE_SHA256 : env.TLSN_PROFILE_SHA256,
    verifierKeyId: production ? env.TLSN_CANDIDATE_VERIFIER_KEY_ID : env.TLSN_VERIFIER_KEY_ID,
    notaryKeyId: production ? env.TLSN_CANDIDATE_NOTARY_KEY_ID : env.TLSN_NOTARY_KEY_ID,
    deviceAuthUrl: production ? env.TLSN_CANDIDATE_DEVICE_AUTH_URL : env.TLSN_DEVICE_AUTH_URL,
    devicePossessionAuthUrl: production
      ? env.TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL
      : env.TLSN_DEVICE_POSSESSION_AUTH_URL,
    deviceAuthAllowedHosts: production ? env.TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS : undefined,
    notaryRegistry: production ? env.TLSN_CANDIDATE_NOTARY_REGISTRY : env.TLSN_NOTARY_REGISTRY,
    signingPrivateKeyPkcs8: signingPrivateKey,
    trustRootCertificateDer,
    resultPublicKeySpki,
    resultSignerKeyId,
    resultSigningKeyRegistry,
  });
  if (!parsed.success) {
    return null;
  }
  try {
    if (!env.TLSN_BINDINGS || !/^[1-9][0-9]{0,3}$/.test(env.TLSN_BINDING_TTL_SECONDS)) {
      return null;
    }
    const bindingTtlSeconds = Number(env.TLSN_BINDING_TTL_SECONDS);
    if (bindingTtlSeconds < 1 || bindingTtlSeconds > 3600) {
      return null;
    }
    if (production && (!canary && role !== "production")) {
      return null;
    }
    if (production && env.TLSN_TEST_BINDING_VALUE) {
      return null;
    }
    if (
      production &&
      !/^[0-9a-f]{40}$/i.test(env.TLSN_GIT_COMMIT_SHA ?? "")
    ) {
      return null;
    }
    if (canary && !/^[A-Za-z0-9_-]{1,512}$/.test(env.TLSN_CANARY_BINDING_VALUE ?? "")) {
      return null;
    }
    if (role === "production" && env.TLSN_CANARY_BINDING_VALUE) {
      return null;
    }
    const forbiddenRoleFields = canary
      ? [env.TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8, env.TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER, env.TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI, env.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID, env.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY, env.TLSN_PRODUCTION_DEPLOYMENT_ID, env.TLSN_PRODUCTION_WORKER_NAME]
      : [env.TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8, env.TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER, env.TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI, env.TLSN_CANARY_RESULT_SIGNER_KEY_ID, env.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY, env.TLSN_CANARY_DEPLOYMENT_ID, env.TLSN_CANARY_WORKER_NAME];
    if (production && forbiddenRoleFields.some((field) => field !== undefined)) {
      return null;
    }
    if (production && env.TLSN_TEST_AUTH_USERS) {
      return null;
    }
    if (
      production &&
      (!isSafeDeploymentId(canary ? env.TLSN_CANARY_DEPLOYMENT_ID : env.TLSN_PRODUCTION_DEPLOYMENT_ID) ||
        !isSha256Base64Url(env.TLSN_SECURITY_REGISTRY_SET_SHA256) ||
        containsTestFixtureMarker(parsed.data.verifierKeyId) ||
        containsTestFixtureMarker(parsed.data.notaryKeyId) ||
        containsTestFixtureMarker(parsed.data.serverIdentity))
    ) {
      return null;
    }
    if (production && !parsed.data.trustRootCertificateDer) {
      return null;
    }
    if (production && !isPublicKeyBase64Url(parsed.data.resultPublicKeySpki)) {
      return null;
    }
    if (production && (!parsed.data.resultSignerKeyId || !parsed.data.resultSigningKeyRegistry)) {
      return null;
    }
    if (production) {
      const resultRegistry = resultSigningKeyRegistrySchema.safeParse(JSON.parse(parsed.data.resultSigningKeyRegistry ?? ""));
      if (!resultRegistry.success) return null;
      const currentResultKey = resultRegistry.data.keys.find((key) => key.key_id === parsed.data.resultSignerKeyId);
      const now = Date.now();
      if (
        !currentResultKey ||
        currentResultKey.public_key_spki !== parsed.data.resultPublicKeySpki ||
        currentResultKey.status !== "ACTIVE" ||
        Date.parse(currentResultKey.not_before) > now ||
        (currentResultKey.not_after !== null && Date.parse(currentResultKey.not_after) < now)
      ) return null;
    }
    if (production) {
      const deviceAuthAllowedHosts = parseHostnameAllowlist(parsed.data.deviceAuthAllowedHosts);
      const supabaseAllowedHosts = parseHostnameAllowlist(env.TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS);
      if (
        !deviceAuthAllowedHosts ||
        !supabaseAllowedHosts ||
        !isAllowedProductionHttpsUrl(
          parsed.data.deviceAuthUrl,
          "/api/auth/anonymous-sync/v2/device-proof",
          deviceAuthAllowedHosts,
        ) ||
        !isAllowedProductionHttpsUrl(
          parsed.data.devicePossessionAuthUrl,
          "/api/auth/anonymous-sync/v2/tlsn-device-proof",
          deviceAuthAllowedHosts,
        ) ||
        !isAllowedProductionHttpsUrl(
          env.TLSN_CANDIDATE_SUPABASE_URL ?? "",
          "/",
          supabaseAllowedHosts,
        )
      ) {
        return null;
      }
    }
    const notaryRegistry = notaryRegistrySchema.safeParse(JSON.parse(parsed.data.notaryRegistry));
    if (!notaryRegistry.success) {
      return null;
    }
    const notaryKeyValue = notaryRegistry.data[parsed.data.notaryKeyId];
    if (!notaryKeyValue) {
      return null;
    }
    const profileSha256Bytes = decodeBase64Url(parsed.data.profileSha256, 32);
    if (profileSha256Bytes.length !== 32) {
      return null;
    }
    const notaryKeyBytes = decodeBase64Url(notaryKeyValue, 4096);
    const signingPrivateKeyBytes = decodeBase64Url(parsed.data.signingPrivateKeyPkcs8, 4096);
    const trustRootCertificateDerBytes = parsed.data.trustRootCertificateDer
      ? decodeBase64Url(parsed.data.trustRootCertificateDer, 4096)
      : undefined;
    return {
      ...parsed.data,
      profileSha256Bytes,
      notaryKeyBytes,
      signingPrivateKeyBytes,
      trustRootCertificateDerBytes,
      bindingTtlSeconds,
    };
  } catch {
    return null;
  }
}

async function ensureWasmInitialized(): Promise<void> {
  wasmInitialization ??= initVerifier({ module_or_path: wasmModule }).then(() => undefined);
  return wasmInitialization;
}

async function signSigningBytes(
  signingBytes: Uint8Array,
  privateKeyBytes: Uint8Array,
): Promise<Uint8Array> {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    signingBytes,
  );
  return new Uint8Array(signature);
}

function receiptSignerKeyId(config: VerifierConfig): string {
  return config.resultSignerKeyId ?? "test-result-signing-key";
}

async function signSessionReceipt(
  config: VerifierConfig,
  record: {
    session_id: string;
    canonical_user_id: string;
    device_id: string;
    device_auth_nonce: string;
    nonce: string;
    tlsn_device_challenge: string;
    binding_value: string;
    created_at: string;
    expires_at: string;
  },
): Promise<Record<string, string | number>> {
  const signerKeyId = receiptSignerKeyId(config);
  const signature = await signSigningBytes(
    attestationSessionReceiptSigningBytes({
      signerKeyId,
      sessionId: record.session_id,
      canonicalUserId: record.canonical_user_id,
      deviceId: record.device_id,
      deviceAuthNonce: record.device_auth_nonce,
      nonce: record.nonce,
      deviceChallenge: record.tlsn_device_challenge,
      bindingValue: record.binding_value,
      createdAt: record.created_at,
      expiresAt: record.expires_at,
    }),
    config.signingPrivateKeyBytes,
  );
  return {
    schema_version: 1,
    type: "attestation-session-issued",
    signer_key_id: signerKeyId,
    signature_algorithm: "Ed25519",
    session_id: record.session_id,
    canonical_user_id: record.canonical_user_id,
    device_id: record.device_id,
    device_auth_nonce: record.device_auth_nonce,
    nonce: record.nonce,
    device_challenge: record.tlsn_device_challenge,
    binding_value: record.binding_value,
    created_at: record.created_at,
    expires_at: record.expires_at,
    signature: encodeBase64Url(signature),
  };
}

async function signConsumeReceipt(
  config: VerifierConfig,
  record: {
    session_id: string;
    canonical_user_id: string;
    device_id: string;
    nonce: string;
    binding_value: string;
    presentation_id?: string;
    used_at?: string;
  },
): Promise<Record<string, string | number>> {
  if (!record.presentation_id || !record.used_at) {
    throw new Error("consumed binding is missing receipt fields");
  }
  const signerKeyId = receiptSignerKeyId(config);
  const signature = await signSigningBytes(
    attestationConsumeReceiptSigningBytes({
      signerKeyId,
      sessionId: record.session_id,
      canonicalUserId: record.canonical_user_id,
      deviceId: record.device_id,
      nonce: record.nonce,
      bindingValue: record.binding_value,
      presentationId: record.presentation_id,
      usedAt: record.used_at,
    }),
    config.signingPrivateKeyBytes,
  );
  return {
    schema_version: 1,
    type: "attestation-binding-consumed",
    signer_key_id: signerKeyId,
    signature_algorithm: "Ed25519",
    session_id: record.session_id,
    canonical_user_id: record.canonical_user_id,
    device_id: record.device_id,
    nonce: record.nonce,
    binding_value: record.binding_value,
    presentation_id: record.presentation_id,
    used_at: record.used_at,
    signature: encodeBase64Url(signature),
  };
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null && Number(contentLength) > MAX_REQUEST_JSON_BYTES) {
    throw new Error("request body is too large");
  }
  const raw = await request.text();
  if (raw.length > MAX_REQUEST_JSON_BYTES) {
    throw new Error("request body is too large");
  }
  return JSON.parse(raw) as unknown;
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization")?.trim();
  const match = header ? /^Bearer ([^\s]+)$/.exec(header) : null;
  return match?.[1] ?? null;
}

function authenticationFailure(
  error: "unauthorized" | "auth_unconfigured",
): AuthenticationResult {
  return { ok: false, status: error === "unauthorized" ? 401 : 503, error };
}

async function authenticateRequest(
  request: Request,
  env: Bindings,
): Promise<AuthenticationResult> {
  const token = extractBearerToken(request);
  if (env.TLSN_ENVIRONMENT === "test" && env.TLSN_TEST_AUTH_USERS) {
    try {
      const users = testAuthUsersSchema.parse(JSON.parse(env.TLSN_TEST_AUTH_USERS));
      const user = token ? users[token] : undefined;
      if (!token || !user || user.is_anonymous === true) {
        return authenticationFailure("unauthorized");
      }
      return { ok: true, subject: { canonicalUserId: user.id, accessToken: token } };
    } catch {
      return authenticationFailure("auth_unconfigured");
    }
  }

  const supabaseUrl = (env.TLSN_ENVIRONMENT === "production"
    ? env.TLSN_CANDIDATE_SUPABASE_URL
    : env.TLSN_SUPABASE_URL)?.replace(/\/$/, "");
  const publishableKey = env.TLSN_ENVIRONMENT === "production"
    ? env.TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY
    : env.TLSN_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return authenticationFailure("auth_unconfigured");
  }
  if (!token) {
    return authenticationFailure("unauthorized");
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      redirect: "manual",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      return authenticationFailure("unauthorized");
    }
    const user = authUserSchema.parse(await response.json());
    if (user.is_anonymous === true) {
      return authenticationFailure("unauthorized");
    }
    return { ok: true, subject: { canonicalUserId: user.id, accessToken: token } };
  } catch {
    return authenticationFailure("unauthorized");
  }
}

type DeviceAuthenticationResult =
  | { ok: true; canonicalUserId: string; deviceId: string }
  | {
      ok: false;
      status: 401 | 403 | 409 | 503;
      error:
        | "device_auth_unconfigured"
        | "device_unauthorized"
        | "device_owner_mismatch"
        | "device_revoked"
        | "device_nonce_invalid"
        | "device_nonce_replayed"
        | "device_auth_unavailable";
    };

type DevicePossessionAuthenticationResult =
  | { ok: true; canonicalUserId: string; deviceId: string; replayDigestHex: string }
  | {
      ok: false;
      status: 401 | 403 | 409 | 503;
      error:
        | "device_possession_unauthorized"
        | "device_possession_owner_mismatch"
        | "device_possession_revoked"
        | "device_possession_replayed"
        | "device_possession_unavailable";
    };

const deviceProofResponseSchema = z
  .object({
    authenticated: z.literal(true),
    canonical_user_id: z.string().uuid(),
    device_id: z.string().uuid(),
  })
  .strict();

const tlsnDeviceProofResponseSchema = deviceProofResponseSchema.extend({
  replay_digest_hex: z.string().regex(/^[a-f0-9]{64}$/),
});

async function authenticateDeviceProof(
  subject: AuthenticatedSubject,
  proof: z.infer<typeof deviceProofRequestSchema>,
  endpoint: string,
): Promise<DeviceAuthenticationResult> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${subject.accessToken}`,
      },
      body: JSON.stringify(proof),
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: 503, error: "device_auth_unavailable" };
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(payload).data?.error;
      if (response.status === 403) {
        return { ok: false, status: 403, error: "device_owner_mismatch" };
      }
      if (response.status === 409 && error === "device_revoked") {
        return { ok: false, status: 409, error: "device_revoked" };
      }
      if (response.status === 409 && error === "nonce_already_used") {
        return { ok: false, status: 409, error: "device_nonce_replayed" };
      }
      if (response.status === 401 && error === "nonce_invalid_or_expired") {
        return { ok: false, status: 401, error: "device_nonce_invalid" };
      }
      if (response.status >= 500) {
        return { ok: false, status: 503, error: "device_auth_unavailable" };
      }
      return { ok: false, status: 401, error: "device_unauthorized" };
    }
    const parsed = deviceProofResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.canonical_user_id !== subject.canonicalUserId) {
      return { ok: false, status: 403, error: "device_owner_mismatch" };
    }
    if (parsed.data.device_id !== proof.device_id) {
      return { ok: false, status: 403, error: "device_owner_mismatch" };
    }
    return {
      ok: true,
      canonicalUserId: parsed.data.canonical_user_id,
      deviceId: parsed.data.device_id,
    };
  } catch {
    return { ok: false, status: 503, error: "device_auth_unavailable" };
  }
}

async function authenticateTlsnDeviceProof(
  subject: AuthenticatedSubject,
  proof: {
    device_id: string;
    session_id: string;
    binding_value: string;
    challenge: string;
    sig: string;
  },
  endpoint: string,
): Promise<DevicePossessionAuthenticationResult> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${subject.accessToken}`,
      },
      body: JSON.stringify(proof),
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: 503, error: "device_possession_unavailable" };
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(payload).data?.error;
      if (response.status === 403) {
        return { ok: false, status: 403, error: "device_possession_owner_mismatch" };
      }
      if (response.status === 409 && error === "device_revoked") {
        return { ok: false, status: 409, error: "device_possession_revoked" };
      }
      if (response.status === 409 && error === "device_proof_replayed") {
        return { ok: false, status: 409, error: "device_possession_replayed" };
      }
      if (response.status >= 500) {
        return { ok: false, status: 503, error: "device_possession_unavailable" };
      }
      return { ok: false, status: 401, error: "device_possession_unauthorized" };
    }
    const parsed = tlsnDeviceProofResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.canonical_user_id !== subject.canonicalUserId) {
      return { ok: false, status: 403, error: "device_possession_owner_mismatch" };
    }
    if (parsed.data.device_id !== proof.device_id) {
      return { ok: false, status: 403, error: "device_possession_owner_mismatch" };
    }
    return {
      ok: true,
      canonicalUserId: parsed.data.canonical_user_id,
      deviceId: parsed.data.device_id,
      replayDigestHex: parsed.data.replay_digest_hex,
    };
  } catch {
    return { ok: false, status: 503, error: "device_possession_unavailable" };
  }
}

function requireAuthentication(
  result: AuthenticationResult,
): Response | AuthenticatedSubject {
  return result.ok ? result.subject : Response.json({ error: result.error }, { status: result.status });
}

type BindingAuthorityHttpStatus = 409 | 410 | 422 | 503;

function bindingAuthorityStatus(error: unknown): BindingAuthorityHttpStatus {
  if (!(error instanceof BindingAuthorityError)) {
    return 422;
  }
  switch (error.code) {
    case "authority_unavailable":
      return 503;
    case "binding_expired":
      return 410;
    case "binding_consumed":
    case "binding_conflict":
    case "session_mismatch":
    case "user_mismatch":
    case "device_mismatch":
    case "nonce_mismatch":
      return 409;
    default:
      return 422;
  }
}

app.get("/health", async (c) => {
  const production = c.env.TLSN_ENVIRONMENT === "production";
  const role = c.env.TLSN_DEPLOYMENT_ROLE ?? (production ? "production" : "synthetic-test");
  const canary = production && role === "canary";
  const verifierKeyId = production
    ? c.env.TLSN_CANDIDATE_VERIFIER_KEY_ID
    : c.env.TLSN_VERIFIER_KEY_ID;
  const notaryKeyId = production
    ? c.env.TLSN_CANDIDATE_NOTARY_KEY_ID
    : c.env.TLSN_NOTARY_KEY_ID;
  const profileSha256 = production
    ? c.env.TLSN_CANDIDATE_PROFILE_SHA256
    : c.env.TLSN_PROFILE_SHA256;
  const notaryRegistry = production
    ? c.env.TLSN_CANDIDATE_NOTARY_REGISTRY
    : c.env.TLSN_NOTARY_REGISTRY;
  const notaryRegistrySha256 = notaryRegistry
    ? encodeBase64Url(new Uint8Array(await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(notaryRegistry),
      )))
    : null;
  const trustRoot = production
    ? canary ? c.env.TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER : c.env.TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER
    : c.env.TLSN_TRUST_ROOT_CERTIFICATE_DER;
  const trustRootCertificateSha256 = trustRoot
    ? encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", decodeBase64Url(trustRoot, 4096))))
    : null;
  const resultPublicKeySpki = production
    ? canary ? c.env.TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI : c.env.TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI
    : null;
  const resultSignerKeyId = production
    ? canary ? c.env.TLSN_CANARY_RESULT_SIGNER_KEY_ID : c.env.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID
    : null;
  const resultSigningKeyRegistry = production
    ? canary ? c.env.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY : c.env.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY
    : null;
  const resultKeyRegistrySha256 = resultSigningKeyRegistry
    ? encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resultSigningKeyRegistry))))
    : null;
  const deploymentId = production
    ? canary ? c.env.TLSN_CANARY_DEPLOYMENT_ID : c.env.TLSN_PRODUCTION_DEPLOYMENT_ID
    : null;
  const bindingMode = production && canary && c.env.TLSN_CANARY_BINDING_VALUE
    ? "fixed_canary"
    : c.env.TLSN_TEST_BINDING_VALUE
      ? "fixed_test"
      : "random";
  return c.json({
    schema_version: 2,
    ok: true,
    verifier: "tlsn-alpha15-wasm",
    environment: c.env.TLSN_ENVIRONMENT,
    deployment_role: role,
    git_commit_sha: c.env.TLSN_GIT_COMMIT_SHA ?? null,
    verifier_key_id: verifierKeyId ?? null,
    notary_key_id: notaryKeyId ?? null,
    profile_sha256: profileSha256 ?? null,
    deployment_id: deploymentId,
    security_registry_set_sha256: c.env.TLSN_SECURITY_REGISTRY_SET_SHA256 ?? null,
    notary_registry_sha256: notaryRegistrySha256,
    result_public_key_spki: resultPublicKeySpki,
    binding_mode: bindingMode,
    security_identity: {
      git_commit_sha: c.env.TLSN_GIT_COMMIT_SHA ?? null,
      server_identity: production ? c.env.TLSN_CANDIDATE_SERVER_IDENTITY ?? null : c.env.TLSN_SERVER_IDENTITY,
      profile_sha256: profileSha256 ?? null,
      verifier_key_id: verifierKeyId ?? null,
      notary_key_id: notaryKeyId ?? null,
      security_registry_set_sha256: c.env.TLSN_SECURITY_REGISTRY_SET_SHA256 ?? null,
      notary_registry_sha256: notaryRegistrySha256,
      binding_authority: "durable-single-use",
    },
    deployment_identity: {
      deployment_id: deploymentId,
      deployment_role: role,
      binding_mode: bindingMode,
      trust_root_certificate_sha256: trustRootCertificateSha256,
      worker_name: production
        ? canary ? c.env.TLSN_CANARY_WORKER_NAME ?? null : c.env.TLSN_PRODUCTION_WORKER_NAME ?? null
        : null,
    },
    result_identity: {
      result_public_key_spki: resultPublicKeySpki,
      result_public_key_spki_sha256: resultPublicKeySpki
        ? encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", decodeBase64Url(resultPublicKeySpki, 4096))))
        : null,
      ...(resultSignerKeyId && resultKeyRegistrySha256
        ? {
            result_signer_key_id: resultSignerKeyId,
            result_key_registry_sha256: resultKeyRegistrySha256,
          }
        : {}),
    },
  });
});

app.post("/attestation/session", async (c) => {
  const config = readConfig(c.env);
  if (!config) {
    return c.json({ error: "verifier_unconfigured" }, 503);
  }
  const authentication = requireAuthentication(await authenticateRequest(c.req.raw, c.env));
  if (authentication instanceof Response) {
    return authentication;
  }
  let requestBody: z.infer<typeof deviceProofRequestSchema>;
  try {
    requestBody = deviceProofRequestSchema.parse(await readJsonBody(c.req.raw));
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  try {
    const deviceAuthentication = await authenticateDeviceProof(
      authentication,
      requestBody,
      config.deviceAuthUrl,
    );
    if (!deviceAuthentication.ok) {
      return c.json({ error: deviceAuthentication.error }, deviceAuthentication.status);
    }
    if (deviceAuthentication.canonicalUserId !== authentication.canonicalUserId) {
      return c.json({ error: "device_owner_mismatch" }, 403);
    }
    const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
    const record = await authority.issueBinding(
      Date.now(),
      config.bindingTtlSeconds,
      authentication.canonicalUserId,
      deviceAuthentication.deviceId,
      requestBody.nonce,
      c.env.TLSN_ENVIRONMENT === "test"
        ? c.env.TLSN_TEST_BINDING_VALUE
        : c.env.TLSN_DEPLOYMENT_ROLE === "canary"
          ? c.env.TLSN_CANARY_BINDING_VALUE
          : undefined,
    );
        const sessionReceipt = await signSessionReceipt(config, record);
    c.header("Cache-Control", "no-store");
    return c.json({
      session_id: record.session_id,
      challenge: record.nonce,
      binding: record.binding_value,
      device_id: record.device_id,
      device_challenge: record.tlsn_device_challenge,
      expires_at: record.expires_at,
      session_receipt: sessionReceipt,
    }, 201);
  } catch {
    return c.json({ error: "authority_unavailable" }, 503);
  }
});

app.post("/verify/tlsn", async (c) => {
  const config = readConfig(c.env);
  if (!config) {
    return c.json({ error: "verifier_unconfigured" }, 503);
  }
  const authentication = requireAuthentication(await authenticateRequest(c.req.raw, c.env));
  if (authentication instanceof Response) {
    return authentication;
  }

  let requestBody: z.infer<typeof requestSchema>;
  try {
    requestBody = requestSchema.parse(await readJsonBody(c.req.raw));
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }

  let presentationBytes: Uint8Array;
  try {
    presentationBytes = decodeBase64Url(requestBody.presentation_base64, MAX_PRESENTATION_BYTES);
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }

  const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
  let issuedBinding;
  try {
    issuedBinding = await authority.lookupBinding(
      requestBody.session_id,
      requestBody.binding,
      authentication.canonicalUserId,
      requestBody.device_id,
      Date.now(),
    );
  } catch (error) {
    const message = error instanceof BindingAuthorityError ? error.code : "binding_unknown";
    return c.json({ verified: false, error: message }, bindingAuthorityStatus(error));
  }

  if (requestBody.device_proof.challenge !== issuedBinding.tlsn_device_challenge) {
    return c.json({ verified: false, error: "device_challenge_mismatch" }, 409);
  }
  let deviceChallengeBytes: Uint8Array;
  try {
    deviceChallengeBytes = decodeBase64Url(requestBody.device_proof.challenge, 32);
  } catch {
    return c.json({ verified: false, error: "invalid_request" }, 400);
  }
  if (deviceChallengeBytes.length !== 32) {
    return c.json({ verified: false, error: "invalid_request" }, 400);
  }

  try {
    await ensureWasmInitialized();
  } catch {
    return c.json({ error: "verifier_unavailable" }, 503);
  }

  try {
    const prepared = preparedResultSchema.parse(
      JSON.parse(
        config.trustRootCertificateDerBytes
          ? verify_require_info_presentation_with_trust_anchor(
              presentationBytes,
              config.serverIdentity,
              config.profileSha256Bytes,
              config.verifierKeyId,
              config.notaryKeyId,
              authentication.canonicalUserId,
              requestBody.device_id,
              deviceChallengeBytes,
              config.trustRootCertificateDerBytes,
              config.notaryKeyBytes,
            )
          : verify_require_info_presentation(
              presentationBytes,
              config.serverIdentity,
              config.profileSha256Bytes,
              config.verifierKeyId,
              config.notaryKeyId,
              authentication.canonicalUserId,
              requestBody.device_id,
              deviceChallengeBytes,
              config.notaryKeyBytes,
            ),
      ) as unknown,
    );
    const authenticatedResult = authenticatedResultSchema.parse(
      JSON.parse(prepared.unsigned_result) as unknown,
    );
    if (
      authenticatedResult.attestation_session_id !== issuedBinding.session_id ||
      authenticatedResult.attestation_session_id !== requestBody.session_id ||
      authenticatedResult.canonical_user_id !== authentication.canonicalUserId ||
      authenticatedResult.device_id !== requestBody.device_id ||
      authenticatedResult.device_challenge !== requestBody.device_proof.challenge ||
      authenticatedResult.binding_nonce !== issuedBinding.nonce ||
      authenticatedResult.binding_value !== issuedBinding.binding_value ||
      authenticatedResult.binding_value !== requestBody.binding
    ) {
      return c.json({ verified: false, error: "binding_mismatch" }, 422);
    }
    const devicePossession = await authenticateTlsnDeviceProof(
      authentication,
      {
        device_id: issuedBinding.device_id,
        session_id: issuedBinding.session_id,
        binding_value: issuedBinding.binding_value,
        challenge: requestBody.device_proof.challenge,
        sig: requestBody.device_proof.sig,
      },
      config.devicePossessionAuthUrl,
    );
    if (!devicePossession.ok) {
      return c.json({ verified: false, error: devicePossession.error }, devicePossession.status);
    }
    if (
      devicePossession.canonicalUserId !== authentication.canonicalUserId ||
      devicePossession.deviceId !== issuedBinding.device_id ||
      devicePossession.deviceId !== requestBody.device_id
    ) {
      return c.json({ verified: false, error: "device_possession_owner_mismatch" }, 403);
    }
    const presentationId = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", presentationBytes)),
    );
    const signingBytes = decodeBase64Url(prepared.signing_bytes, MAX_RESULT_JSON_BYTES);
    const signature = await signSigningBytes(signingBytes, config.signingPrivateKeyBytes);
    if (signature.length !== 64) {
      return c.json({ error: "verifier_unavailable" }, 503);
    }
    let consumedBinding;
    try {
      consumedBinding = await authority.consumeBinding(requestBody.binding, {
        session_id: requestBody.session_id,
        canonical_user_id: authentication.canonicalUserId,
        device_id: requestBody.device_id,
        binding_value: requestBody.binding,
        nonce: authenticatedResult.binding_nonce,
        presentation_id: presentationId,
        now: Date.now(),
      });
    } catch (error) {
      const message = error instanceof BindingAuthorityError ? error.code : "binding_unknown";
      return c.json({ verified: false, error: message }, bindingAuthorityStatus(error));
    }
    const consumeReceipt = await signConsumeReceipt(config, consumedBinding);
    const signedResultJson = attach_verifier_result_signature(
      prepared.unsigned_result,
      signature,
    );
    const signedResult = JSON.parse(signedResultJson) as Record<string, unknown>;
    c.header("Cache-Control", "no-store");
    return c.json({
      verified: true,
      result: signedResult,
      signature_algorithm: "Ed25519",
      consume_receipt: consumeReceipt,
      device_replay_digest_hex: devicePossession.replayDigestHex,
    });
  } catch {
    return c.json({ verified: false, error: "verification_failed" }, 422);
  }
});

export { app, TlsnBindingAuthorityDurableObject };
export default app;