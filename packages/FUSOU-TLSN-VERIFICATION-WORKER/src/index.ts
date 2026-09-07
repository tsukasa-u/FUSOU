import { Hono } from "hono";
import { z } from "zod";
import initVerifier, {
  attach_verifier_result_signature,
  verify_require_info_presentation,
  verify_require_info_presentation_with_trust_anchor,
} from "./wasm/fusou_tlsn_verifier.js";
import wasmModule from "./wasm/fusou_tlsn_verifier_bg.wasm";

type Bindings = {
  TLSN_SERVER_IDENTITY: string;
  TLSN_PROFILE_SHA256: string;
  TLSN_VERIFIER_KEY_ID: string;
  TLSN_NOTARY_KEY_ID: string;
  TLSN_SIGNING_PRIVATE_KEY_PKCS8: string;
  TLSN_TRUST_ROOT_CERTIFICATE_DER?: string;
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
  })
  .strict();

const preparedResultSchema = z
  .object({
    unsigned_result: z.string().min(1).max(MAX_RESULT_JSON_BYTES),
    signing_bytes: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

const configSchema = z.object({
  serverIdentity: z.string().min(1).max(253),
  profileSha256: z.string().regex(/^[A-Za-z0-9_-]+$/),
  verifierKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  notaryKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  signingPrivateKeyPkcs8: z.string().regex(/^[A-Za-z0-9_-]+$/),
  trustRootCertificateDer: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
});

type VerifierConfig = z.infer<typeof configSchema> & {
  profileSha256Bytes: Uint8Array;
  signingPrivateKeyBytes: Uint8Array;
  trustRootCertificateDerBytes: Uint8Array | undefined;
};

const app = new Hono<{ Bindings: Bindings }>();
let wasmInitialization: Promise<void> | undefined;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

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

function readConfig(env: Bindings): VerifierConfig | null {
  const parsed = configSchema.safeParse({
    serverIdentity: env.TLSN_SERVER_IDENTITY,
    profileSha256: env.TLSN_PROFILE_SHA256,
    verifierKeyId: env.TLSN_VERIFIER_KEY_ID,
    notaryKeyId: env.TLSN_NOTARY_KEY_ID,
    signingPrivateKeyPkcs8: env.TLSN_SIGNING_PRIVATE_KEY_PKCS8,
    trustRootCertificateDer: env.TLSN_TRUST_ROOT_CERTIFICATE_DER,
  });
  if (!parsed.success) {
    return null;
  }
  try {
    const profileSha256Bytes = decodeBase64Url(parsed.data.profileSha256, 32);
    if (profileSha256Bytes.length !== 32) {
      return null;
    }
    const signingPrivateKeyBytes = decodeBase64Url(parsed.data.signingPrivateKeyPkcs8, 4096);
    const trustRootCertificateDerBytes = parsed.data.trustRootCertificateDer
      ? decodeBase64Url(parsed.data.trustRootCertificateDer, 4096)
      : undefined;
    return {
      ...parsed.data,
      profileSha256Bytes,
      signingPrivateKeyBytes,
      trustRootCertificateDerBytes,
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

app.get("/health", (c) => c.json({ ok: true, verifier: "tlsn-alpha15-wasm" }));

app.post("/verify/tlsn", async (c) => {
  const config = readConfig(c.env);
  if (!config) {
    return c.json({ error: "verifier_unconfigured" }, 503);
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
              config.trustRootCertificateDerBytes,
            )
          : verify_require_info_presentation(
              presentationBytes,
              config.serverIdentity,
              config.profileSha256Bytes,
              config.verifierKeyId,
              config.notaryKeyId,
            ),
      ) as unknown,
    );
    const signingBytes = decodeBase64Url(prepared.signing_bytes, MAX_RESULT_JSON_BYTES);
    const signature = await signSigningBytes(signingBytes, config.signingPrivateKeyBytes);
    if (signature.length !== 64) {
      return c.json({ error: "verifier_unavailable" }, 503);
    }
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
    });
  } catch {
    return c.json({ verified: false, error: "verification_failed" }, 422);
  }
});

export { app };
export default app;