import { privateKeyMatchesPublicKey } from "./private_key_validation_cache.js";

export const CANARY_VERIFIER_EXECUTION_RECEIPT_SCOPE = "tlsn-canary-verifier-execution-receipt";
export const CANARY_VERIFIER_WORKER_NAME = "fusou-tlsn-verifier-canary";

export type CanaryVerifierExecutionReceipt = {
  schema_version: 1;
  scope: typeof CANARY_VERIFIER_EXECUTION_RECEIPT_SCOPE;
  receipt_id: string;
  job_id: string;
  verification_attempt_id: string;
  deployment_id: string;
  worker_name: typeof CANARY_VERIFIER_WORKER_NAME;
  runtime_version_id: string;
  verifier_key_id: string;
  verifier_public_key_spki_sha256: string;
  presentation_sha256: string;
  result_sha256: string;
  issued_at: string;
  signature_algorithm: "Ed25519";
  signature_base64url: string;
};

export function serializeCanaryAuthoritativeResult(value: Record<string, unknown>): {
  body: string;
  bytes: Uint8Array;
} {
  const body = JSON.stringify(value);
  return { body, bytes: new TextEncoder().encode(body) };
}

type CanaryVerifierExecutionReceiptInput = {
  jobId: string;
  verificationAttemptId: string;
  deploymentId: string;
  runtimeVersionId: string;
  verifierKeyId: string;
  verifierPublicKeySpki: string;
  verifierSigningPrivateKeyPkcs8: Uint8Array;
  presentationBytes: Uint8Array;
  resultBytes: Uint8Array;
  issuedAt?: string;
};

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string, label: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(standard + "=".repeat((4 - (standard.length % 4)) % 4));
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(decoded) !== value) throw new Error(`${label} must be canonical base64url`);
  return decoded;
}

export async function canaryVerifierExecutionKeyPairMatches(
  privateKeyPkcs8: string | undefined,
  publicKeySpki: string | undefined,
): Promise<boolean> {
  if (typeof privateKeyPkcs8 !== "string" || typeof publicKeySpki !== "string") return false;
  try {
    return await privateKeyMatchesPublicKey(
      decodeBase64Url(privateKeyPkcs8, "Verifier private key"),
      publicKeySpki,
    );
  } catch {
    return false;
  }
}

function requiredString(value: string, label: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function createCanaryVerifierExecutionReceipt({
  jobId,
  verificationAttemptId,
  deploymentId,
  runtimeVersionId,
  verifierKeyId,
  verifierPublicKeySpki,
  verifierSigningPrivateKeyPkcs8,
  presentationBytes,
  resultBytes,
  issuedAt = new Date().toISOString(),
}: CanaryVerifierExecutionReceiptInput): Promise<CanaryVerifierExecutionReceipt> {
  requiredString(jobId, "Verifier receipt job ID", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  requiredString(verificationAttemptId, "Verifier receipt attempt ID", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  requiredString(deploymentId, "Verifier receipt deployment ID", /^[A-Za-z0-9._:/-]{1,512}$/);
  requiredString(runtimeVersionId, "Verifier receipt runtime version ID", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  requiredString(verifierKeyId, "Verifier receipt key ID", /^[A-Za-z0-9._-]{1,128}$/);
  const publicKeyBytes = decodeBase64Url(verifierPublicKeySpki, "Verifier public key SPKI");
  if (publicKeyBytes.length !== 44) throw new Error("Verifier public key SPKI must be an Ed25519 SPKI key");
  const timestamp = Date.parse(issuedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== issuedAt) {
    throw new Error("Verifier receipt issued_at must be a canonical ISO timestamp");
  }

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    verifierSigningPrivateKeyPkcs8,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey(
    "spki",
    publicKeyBytes,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const keyCheck = crypto.getRandomValues(new Uint8Array(32));
  const keyCheckSignature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, keyCheck);
  if (!await crypto.subtle.verify({ name: "Ed25519" }, publicKey, keyCheckSignature, keyCheck)) {
    throw new Error("Verifier signing key does not match its published SPKI");
  }

  const unsignedReceipt: Omit<CanaryVerifierExecutionReceipt, "signature_algorithm" | "signature_base64url"> = {
    schema_version: 1,
    scope: CANARY_VERIFIER_EXECUTION_RECEIPT_SCOPE,
    receipt_id: crypto.randomUUID(),
    job_id: jobId,
    verification_attempt_id: verificationAttemptId,
    deployment_id: deploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
    runtime_version_id: runtimeVersionId,
    verifier_key_id: verifierKeyId,
    verifier_public_key_spki_sha256: await sha256Base64Url(publicKeyBytes),
    presentation_sha256: await sha256Base64Url(presentationBytes),
    result_sha256: await sha256Base64Url(resultBytes),
    issued_at: issuedAt,
  };
  const payload = BufferlessUtf8(`FUSOU-TLSN-CANARY-VERIFIER-EXECUTION-V1\0${JSON.stringify(unsignedReceipt)}`);
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, payload);
  return {
    ...unsignedReceipt,
    signature_algorithm: "Ed25519",
    signature_base64url: encodeBase64Url(new Uint8Array(signature)),
  };
}

function BufferlessUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}