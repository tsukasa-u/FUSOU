import { PrivateKeyValidationCache } from "./private_key_validation_cache.ts";

const SCOPE = "tlsn-production-queue-verifier-execution-receipt";
const DOMAIN = "FUSOU-TLSN-PRODUCTION-QUEUE-VERIFIER-EXECUTION-V1\0";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();
const keyPairs = new PrivateKeyValidationCache();

export type ProductionQueueReceiptBindings = {
  TLSN_PRODUCTION_QUEUE_EXECUTION_KEY_ID?: string;
  TLSN_PRODUCTION_QUEUE_EXECUTION_PUBLIC_KEY_SPKI?: string;
  TLSN_PRODUCTION_QUEUE_EXECUTION_PRIVATE_KEY_PKCS8?: string;
};

type ProductionQueueReceiptEnvironment = ProductionQueueReceiptBindings & {
  TLSN_PRODUCTION_DEPLOYMENT_ID?: string;
  TLSN_PRODUCTION_WORKER_NAME?: string;
  TLSN_GIT_COMMIT_SHA?: string;
  CF_VERSION_METADATA?: { id: string };
  TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID?: string;
  TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI?: string;
  TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID?: string;
  TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI?: string;
  TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID?: string;
  TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI?: string;
};

type SigningInput = {
  jobId: string;
  verificationAttemptId: string;
  presentationBytes: Uint8Array;
  resultBytes: Uint8Array;
  profile: "complete" | "sparse";
  issuedAt: string;
};

export type ProductionQueueReceiptSigner = (input: SigningInput) => Promise<Uint8Array>;

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value: string | undefined, length: number): Uint8Array | null {
  if (!value || value.length !== Math.ceil(length * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const bytes = Uint8Array.from(atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "=")), c => c.charCodeAt(0));
  return bytes.length === length && encode(bytes) === value ? bytes : null;
}

async function digest(bytes: Uint8Array): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function productionQueueReceiptSigner(
  env: ProductionQueueReceiptEnvironment,
): Promise<ProductionQueueReceiptSigner | null> {
  const keyId = env.TLSN_PRODUCTION_QUEUE_EXECUTION_KEY_ID ?? "";
  const publicSpki = env.TLSN_PRODUCTION_QUEUE_EXECUTION_PUBLIC_KEY_SPKI ?? "";
  const deploymentId = env.TLSN_PRODUCTION_DEPLOYMENT_ID ?? "";
  const workerName = env.TLSN_PRODUCTION_WORKER_NAME ?? "";
  const runtimeVersionId = env.CF_VERSION_METADATA?.id ?? "";
  const sourceSha = env.TLSN_GIT_COMMIT_SHA ?? "";
  const otherKeys = [
    [env.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID, env.TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI],
    [env.TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID, env.TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI],
    [env.TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID, env.TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI],
  ];
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(keyId) ||
      !/^[A-Za-z0-9._:/-]{1,512}$/.test(deploymentId) ||
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(workerName) ||
      !UUID.test(runtimeVersionId) || !/^[a-f0-9]{40}$/.test(sourceSha) ||
      otherKeys.some(([id, spki]) => !id || !spki || id === keyId || spki === publicSpki)) return null;

  const publicKey = decode(publicSpki, 44);
  const keyBytes = decode(env.TLSN_PRODUCTION_QUEUE_EXECUTION_PRIVATE_KEY_PKCS8, 48);
  if (!publicKey || !keyBytes || !(await keyPairs.validate(keyBytes, publicSpki, SCOPE)).valid) return null;
  const key = await crypto.subtle.importKey("pkcs8", keyBytes, "Ed25519", false, ["sign"]);
  const publicKeySha256 = await digest(publicKey);
  return async ({jobId, verificationAttemptId, presentationBytes, resultBytes, profile, issuedAt}) => {
    if (!UUID_V4.test(jobId) || !UUID_V4.test(verificationAttemptId) ||
        !["complete", "sparse"].includes(profile) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(issuedAt) ||
        new Date(issuedAt).toISOString() !== issuedAt ||
        presentationBytes.byteLength === 0 || resultBytes.byteLength === 0) {
      throw new Error("Queue execution receipt input is invalid");
    }
    const receipt = {
      schema_version: 1,
      scope: SCOPE,
      environment: "production",
      deployment_role: "production",
      execution_mode: "queue",
      job_id: jobId,
      verification_attempt_id: verificationAttemptId,
      deployment_id: deploymentId,
      worker_name: workerName,
      runtime_version_id: runtimeVersionId,
      source_sha: sourceSha,
      verifier_execution_key_id: keyId,
      verifier_public_key_spki_sha256: publicKeySha256,
      verification_profile: profile,
      presentation_sha256: await digest(presentationBytes),
      result_sha256: await digest(resultBytes),
      issued_at: issuedAt,
    };
    // The insertion order is the v1 signing field inventory shared with the offline verifier.
    const payload = encoder.encode(DOMAIN + JSON.stringify(Object.values(receipt)));
    const signature = await crypto.subtle.sign("Ed25519", key, payload);
    return encoder.encode(JSON.stringify({
      ...receipt,
      signature_algorithm: "Ed25519",
      signature_base64url: encode(new Uint8Array(signature)),
    }));
  };
}
