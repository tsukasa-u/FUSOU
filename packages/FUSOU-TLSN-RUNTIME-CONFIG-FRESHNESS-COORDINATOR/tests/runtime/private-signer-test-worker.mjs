import privateSigner, {
  deriveCloudflareOperatorFreshnessOperationId,
} from "../../src/private-signer-worker.ts";
import runtimeTestWorker from "./worker.ts";
import { RUNTIME_RPC_PATH } from "./rpc-data.ts";
import { runtimeConfigFreshnessWire } from "../../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";

const freshnessResponseDomain = new TextEncoder().encode(
  "FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-RESPONSE-V1\0",
);
const signatureMetrics = {
  keyPairCheckSignatures: 0,
  freshnessResponseSignatures: 0,
};
const originalSign = crypto.subtle.sign.bind(crypto.subtle);

Object.defineProperty(crypto.subtle, "sign", {
  configurable: true,
  writable: true,
  value: async (algorithm, key, data) => {
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : null;
    if (
      bytes !== null &&
      bytes.byteLength >= freshnessResponseDomain.byteLength &&
      freshnessResponseDomain.every((value, index) => bytes[index] === value)
    ) {
      signatureMetrics.freshnessResponseSignatures += 1;
    } else if (bytes?.byteLength === 32) {
      signatureMetrics.keyPairCheckSignatures += 1;
    }
    return originalSign(algorithm, key, data);
  },
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

async function readTestBytes(request) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > runtimeConfigFreshnessWire.maxRequestBytes
  ) {
    return null;
  }
  return bytes;
}

function withOverrides(env, overrides) {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      return Reflect.get(target, property, receiver);
    },
  });
}

const invalidConfigurations = {
  "missing-coordinator": (env) => ({
    FRESHNESS_ISSUE_COORDINATOR: undefined,
  }),
  "missing-r2": () => ({ RELEASE_LEDGER_R2: undefined }),
  "missing-private-key": () => ({
    FRESHNESS_SIGNER_PRIVATE_KEY_PKCS8_BASE64URL: undefined,
  }),
  "wrong-key-id": () => ({ FRESHNESS_SIGNER_KEY_ID: "not-the-delegated-key" }),
  "wrong-root-pin": () => ({ RELEASE_LEDGER_ROOT_KEY_ID: "not-the-root" }),
  "wrong-private-key": (env) => ({
    FRESHNESS_SIGNER_PRIVATE_KEY_PKCS8_BASE64URL:
      env.TEST_WRONG_FRESHNESS_PRIVATE_KEY_PKCS8_BASE64URL,
  }),
  "malformed-delegation": () => ({
    FRESHNESS_SIGNER_DELEGATION_BASE64URL: "AA",
  }),
  "expired-delegation": (env) => ({
    FRESHNESS_SIGNER_DELEGATION_BASE64URL:
      env.TEST_EXPIRED_FRESHNESS_DELEGATION_BASE64URL,
  }),
  "manifest-url-mismatch": () => ({
    TLSN_RUNTIME_CONFIG_MANIFEST_URL:
      "https://unapproved.example.invalid/manifest.json",
  }),
  "wrong-chain": (env) => ({
    FRESHNESS_COORDINATOR_NAME: env.TEST_WRONG_CHAIN_COORDINATOR_NAME,
    RELEASE_LEDGER_CHAIN_ID: env.TEST_WRONG_CHAIN_ID,
  }),
};

async function fetch(request, env, context) {
  const url = new URL(request.url);
  if (url.pathname === RUNTIME_RPC_PATH) {
    return runtimeTestWorker.fetch(request, env, context);
  }
  if (url.pathname === "/__runtime_test/signature-metrics") {
    return jsonResponse({ ...signatureMetrics });
  }
  if (url.pathname === "/__runtime_test/reset-signature-metrics") {
    signatureMetrics.keyPairCheckSignatures = 0;
    signatureMetrics.freshnessResponseSignatures = 0;
    return jsonResponse({ reset: true });
  }
  if (
    url.pathname === "/__runtime_test/operation-id" ||
    url.pathname === "/__runtime_test/operation-id/wrong-chain"
  ) {
    const requestBytes = await readTestBytes(request);
    if (requestBytes === null) return jsonResponse({ error: "invalid_test_input" });
    try {
      const operationId = await deriveCloudflareOperatorFreshnessOperationId({
        manifestUrl: env.FRESHNESS_MANIFEST_URL,
        chainId: url.pathname.endsWith("/wrong-chain")
          ? env.TEST_WRONG_CHAIN_ID
          : env.RELEASE_LEDGER_CHAIN_ID,
        requestBytes,
      });
      return jsonResponse({ operationId });
    } catch {
      return jsonResponse({ error: "invalid_test_input" });
    }
  }
  if (url.pathname.startsWith("/__runtime_test/config/")) {
    const variant = url.pathname.slice("/__runtime_test/config/".length);
    const resolveOverrides = invalidConfigurations[variant];
    if (resolveOverrides === undefined) {
      return jsonResponse({ error: "unknown_test_configuration" });
    }
    const overrides = resolveOverrides(env);
    const internalRequest = new Request(
      `https://freshness-signer.internal${runtimeConfigFreshnessWire.requestPath}`,
      request,
    );
    return privateSigner.fetch(
      internalRequest,
      withOverrides(env, overrides),
      context,
    );
  }
  return privateSigner.fetch(request, env, context);
}

export default { fetch };
