import { Hono } from "hono";
import { z } from "zod";
import {
  BindingAuthorityError,
  DurableObjectBindingAuthority,
  TlsnBindingAuthorityDurableObject,
  encodeBase64Url,
} from "./binding_authority.js";
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
  TLSN_SIGNING_PRIVATE_KEY_PKCS8: string;
  TLSN_TRUST_ROOT_CERTIFICATE_DER?: string;
  TLSN_TEST_BINDING_VALUE?: string;
  TLSN_PRODUCTION_SERVER_IDENTITY?: string;
  TLSN_PRODUCTION_PROFILE_SHA256?: string;
  TLSN_PRODUCTION_VERIFIER_KEY_ID?: string;
  TLSN_PRODUCTION_NOTARY_KEY_ID?: string;
  TLSN_PRODUCTION_NOTARY_REGISTRY?: string;
  TLSN_PRODUCTION_SIGNING_PRIVATE_KEY_PKCS8?: string;
  TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER?: string;
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
  })
  .strict();

const sessionRequestSchema = z.object({}).strict();

const authenticatedResultSchema = z.object({
  attestation_session_id: z.string().uuid(),
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
  notaryRegistry: z.string().min(1).max(65_536),
  signingPrivateKeyPkcs8: z.string().regex(/^[A-Za-z0-9_-]+$/),
  trustRootCertificateDer: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
});

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

function readConfig(env: Bindings): VerifierConfig | null {
  const production = env.TLSN_ENVIRONMENT === "production";
  const parsed = configSchema.safeParse({
    environment: env.TLSN_ENVIRONMENT,
    serverIdentity: production ? env.TLSN_PRODUCTION_SERVER_IDENTITY : env.TLSN_SERVER_IDENTITY,
    profileSha256: production ? env.TLSN_PRODUCTION_PROFILE_SHA256 : env.TLSN_PROFILE_SHA256,
    verifierKeyId: production ? env.TLSN_PRODUCTION_VERIFIER_KEY_ID : env.TLSN_VERIFIER_KEY_ID,
    notaryKeyId: production ? env.TLSN_PRODUCTION_NOTARY_KEY_ID : env.TLSN_NOTARY_KEY_ID,
    notaryRegistry: production ? env.TLSN_PRODUCTION_NOTARY_REGISTRY : env.TLSN_NOTARY_REGISTRY,
    signingPrivateKeyPkcs8: production
      ? env.TLSN_PRODUCTION_SIGNING_PRIVATE_KEY_PKCS8
      : env.TLSN_SIGNING_PRIVATE_KEY_PKCS8,
    trustRootCertificateDer: production
      ? env.TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER
      : env.TLSN_TRUST_ROOT_CERTIFICATE_DER,
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
    if (production && env.TLSN_TEST_BINDING_VALUE) {
      return null;
    }
    if (production && !parsed.data.trustRootCertificateDer) {
      return null;
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

app.post("/attestation/session", async (c) => {
  const config = readConfig(c.env);
  if (!config) {
    return c.json({ error: "verifier_unconfigured" }, 503);
  }
  try {
    sessionRequestSchema.parse(await readJsonBody(c.req.raw));
    const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
    const record = await authority.issueBinding(
      Date.now(),
      config.bindingTtlSeconds,
      c.env.TLSN_ENVIRONMENT === "test" ? c.env.TLSN_TEST_BINDING_VALUE : undefined,
    );
    c.header("Cache-Control", "no-store");
    return c.json({
      session_id: record.session_id,
      challenge: record.nonce,
      binding: record.binding_value,
      expires_at: record.expires_at,
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
      Date.now(),
    );
  } catch (error) {
    if (error instanceof BindingAuthorityError && error.code === "authority_unavailable") {
      return c.json({ verified: false, error: "authority_unavailable" }, 503);
    }
    const status = error instanceof BindingAuthorityError && error.code === "binding_expired" ? 410 : 422;
    const message = error instanceof BindingAuthorityError ? error.code : "binding_unknown";
    return c.json({ verified: false, error: message }, status);
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
              config.notaryKeyBytes,
            )
          : verify_require_info_presentation(
              presentationBytes,
              config.serverIdentity,
              config.profileSha256Bytes,
              config.verifierKeyId,
              config.notaryKeyId,
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
      authenticatedResult.binding_nonce !== issuedBinding.nonce ||
      authenticatedResult.binding_value !== issuedBinding.binding_value ||
      authenticatedResult.binding_value !== requestBody.binding
    ) {
      return c.json({ verified: false, error: "binding_mismatch" }, 422);
    }
    const presentationId = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", presentationBytes)),
    );
    const signingBytes = decodeBase64Url(prepared.signing_bytes, MAX_RESULT_JSON_BYTES);
    const signature = await signSigningBytes(signingBytes, config.signingPrivateKeyBytes);
    if (signature.length !== 64) {
      return c.json({ error: "verifier_unavailable" }, 503);
    }
    try {
      await authority.consumeBinding(requestBody.binding, {
        session_id: requestBody.session_id,
        binding_value: requestBody.binding,
        nonce: authenticatedResult.binding_nonce,
        presentation_id: presentationId,
        now: Date.now(),
      });
    } catch (error) {
      if (error instanceof BindingAuthorityError && error.code === "authority_unavailable") {
        return c.json({ verified: false, error: "authority_unavailable" }, 503);
      }
      const status = error instanceof BindingAuthorityError && error.code === "binding_expired" ? 410 : 422;
      const message = error instanceof BindingAuthorityError ? error.code : "binding_unknown";
      return c.json({ verified: false, error: message }, status);
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

export { app, TlsnBindingAuthorityDurableObject };
export default app;