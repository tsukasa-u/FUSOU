import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonicalJsonBytes,
  runtimeConfigManifestAudienceSha256,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";
import { cloudflareOperatorGenesisOperationId } from "../src/genesis-operation-id.ts";

const SIGNER = "fusou-tlsn-runtime-config-freshness-signer";
const GENESIS_URL = "https://freshness-signer.internal/__private/admin/genesis";
const SHA256 = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MATERIALS = [
  ["manifest_bytes_base64url", "manifest.json", "manifest_sha256", 1_048_576],
  ["record_bytes_base64url", "release-record.json", "release_record_sha256", 262_144],
  ["release_delegation_bytes_base64url", "release-delegation.json", "release_delegation_sha256", 8_192],
];
const HTTP_STATUS = new Map([
  ["VERIFYING", 200], ["LEDGER_COMMITTED", 200], ["R2_READBACK_PENDING", 200],
  ["AVAILABLE", 200], ["INSTALLING", 200], ["INSTALLED", 200],
  ["NOT_FOUND", 404], ["CONFLICT", 409], ["QUARANTINED", 409], ["RESULT_UNKNOWN", 503],
]);
const RELEASE_STATUS = new Set([
  null, "INTENT", "R2_WRITE_PENDING", "R2_STAGED", "LEDGER_COMMITTED",
  "R2_READBACK_PENDING", "AVAILABLE", "RESULT_UNKNOWN", "QUARANTINED", "CONFLICT",
]);
const INSTALL_STATUS = new Set([null, "VERIFYING", "INSTALLED", "QUARANTINED", "CONFLICT"]);

class OperatorInputError extends Error {}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

async function boundedFile(path, maxBytes, label) {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) throw new Error();
      const bytes = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length !== stat.size) throw new Error();
      return bytes.subarray(0, length);
    } finally {
      await file.close();
    }
  } catch {
    throw new OperatorInputError(`Missing, invalid or oversized ${label}`);
  }
}

export async function loadGenesisPlan(directory, approvedDigest, { withMaterials = true } = {}) {
  if (!SHA256.test(approvedDigest ?? "")) throw new OperatorInputError("An independently approved Genesis digest is required");
  const raw = await boundedFile(join(directory, "genesis-approval.json"), 16_384, "Genesis approval");
  if (sha256(raw) !== approvedDigest) throw new OperatorInputError("Genesis approval digest mismatch");
  let approval;
  let audience;
  try {
    approval = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    audience = await runtimeConfigManifestAudienceSha256(approval.manifest_url);
  } catch {
    throw new OperatorInputError("Genesis approval JSON or Manifest URL is invalid");
  }
  if (
    approval?.schema_version !== 1 ||
    approval.scope !== "fusou-cloudflare-operator-genesis-v1" ||
    approval.environment !== "production" || approval.profile_id !== "cloudflare-operator-v1" ||
    !raw.equals(canonicalJsonBytes(approval)) ||
    audience !== approval.audience_manifest_url_sha256 ||
    typeof approval.coordinator_id !== "string" || !/^[a-f0-9]{64}$/u.test(approval.coordinator_id)
  ) throw new OperatorInputError("Genesis approval has invalid canonical bytes, scope or audience");
  const request = {};
  if (withMaterials) {
    for (const [field, name, pin, limit] of MATERIALS) {
      const bytes = await boundedFile(join(directory, name), limit, name);
      if (sha256(bytes) !== approval[pin]) throw new OperatorInputError(`${name} digest mismatch`);
      request[field] = bytes.toString("base64url");
    }
  }
  return {
    operationId: await cloudflareOperatorGenesisOperationId(raw),
    manifestUrl: approval.manifest_url,
    coordinatorId: approval.coordinator_id,
    requestBytes: withMaterials ? canonicalJsonBytes(request) : null,
  };
}

async function responseJson(response) {
  if (response.headers.get("content-type")?.split(";")[0] !== "application/json") {
    await response.body?.cancel();
    throw new Error();
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > 4_096) throw new Error();
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
}

export async function callGenesis(signer, command, plan, capability) {
  if (!UUID.test(plan.operationId) || !SHA256.test(capability ?? "")) {
    throw new Error("Invalid operation ID or Genesis capability encoding");
  }
  if (command !== "status" && (command !== "apply" || !plan.requestBytes?.byteLength)) {
    throw new Error("Genesis apply requires exact material bytes");
  }
  const apply = command === "apply";
  const request = new Request(apply ? GENESIS_URL : `${GENESIS_URL}/${plan.operationId}`, {
    method: apply ? "POST" : "GET",
    headers: {
      "x-fusou-genesis-capability": capability,
      ...(apply && { "content-type": "application/json" }),
    },
    body: apply ? plan.requestBytes : null,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const unconfirmed = { operation_id: plan.operationId, status: "RESULT_UNCONFIRMED" };
  try {
    const response = await signer.fetch(request);
    const value = await responseJson(response);
    if (response.status === 403 && value?.error === "forbidden") {
      return { operation_id: plan.operationId, status: "FORBIDDEN" };
    }
    if (
      value?.operation_id !== plan.operationId || HTTP_STATUS.get(value.status) !== response.status ||
      !RELEASE_STATUS.has(value.release_status) || !INSTALL_STATUS.has(value.install_status) ||
      (value.status === "INSTALLED" && (value.release_status !== "AVAILABLE" || value.install_status !== "INSTALLED"))
    ) return unconfirmed;
    const { operation_id, status, release_status, install_status } = value;
    return { operation_id, status, release_status, install_status };
  } catch {
    return unconfirmed;
  }
}

async function withWranglerSigner(accountId, command, plan, run) {
  const temporary = await mkdtemp(join(tmpdir(), "fusou-genesis-operator-"));
  try {
    const config = join(temporary, "wrangler.json");
    const bridge = join(temporary, "bridge.mjs");
    const localToken = randomBytes(32).toString("base64url");
    const target = command === "apply" ? GENESIS_URL : `${GENESIS_URL}/${plan.operationId}`;
    const method = command === "apply" ? "POST" : "GET";
    await writeFile(bridge, `
let forwarded = false;
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/" || url.search || request.method !== ${JSON.stringify(method)} ||
        request.headers.get("x-local-genesis-token") !== ${JSON.stringify(localToken)} || forwarded) {
      return new Response(null, { status: 404 });
    }
    forwarded = true;
    const headers = new Headers();
    for (const name of ["x-fusou-genesis-capability", "content-type"]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return env.SIGNER.fetch(${JSON.stringify(target)}, {
      method: request.method, headers, body: request.body, redirect: "manual",
    });
  },
};
`, { mode: 0o600 });
    await writeFile(config, JSON.stringify({
      name: "fusou-tlsn-genesis-operator-local",
      main: "bridge.mjs",
      account_id: accountId,
      compatibility_date: "2026-09-07",
      workers_dev: false,
      preview_urls: false,
      services: [{ binding: "SIGNER", service: SIGNER, remote: true }],
    }), { mode: 0o600 });
    process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
    process.env.WRANGLER_SEND_METRICS = "false";
    process.env.WRANGLER_LOG_PATH = join(temporary, "wrangler.log");
    const { unstable_dev } = await import("wrangler");
    const worker = await unstable_dev(bridge, {
      config, ip: "127.0.0.1", port: 0, inspect: false, persist: false,
      envFiles: [], logLevel: "error",
      experimental: { showInteractiveDevSession: false, disableExperimentalWarning: true },
    });
    try {
      return await run({
        fetch(request) {
          const headers = new Headers(request.headers);
          headers.set("x-local-genesis-token", localToken);
          return worker.fetch("/", {
            method: request.method, headers, body: plan.requestBytes,
            redirect: "manual", signal: request.signal,
          });
        },
      });
    } finally {
      await worker.stop();
    }
  } finally {
    await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function main([command, directory, approvedDigest, ...extra]) {
  if (!["prepare", "status", "apply"].includes(command) || !directory || extra.length) {
    throw new OperatorInputError("Usage: genesis-operator.mjs <prepare|status|apply> PACKAGE_DIR APPROVED_APPROVAL_SHA256");
  }
  const plan = await loadGenesisPlan(directory, approvedDigest, { withMaterials: command !== "status" });
  if (command === "prepare") {
    console.log(JSON.stringify({
      status: "PREPARED_OFFLINE", operation_id: plan.operationId,
      coordinator_id: plan.coordinatorId, manifest_url: plan.manifestUrl,
    }));
    return;
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const capabilityPath = process.env.FUSOU_GENESIS_CAPABILITY_FILE;
  if (!/^[a-f0-9]{32}$/u.test(accountId ?? "") || !capabilityPath) {
    throw new OperatorInputError("Cloudflare account ID and the operator capability file are required");
  }
  const capability = (await boundedFile(capabilityPath, 44, "Genesis capability")).toString("utf8").replace(/\n$/u, "");
  if (!SHA256.test(capability)) throw new OperatorInputError("Invalid Genesis capability encoding");
  const result = await withWranglerSigner(accountId, command, plan, (signer) =>
    callGenesis(signer, command, plan, capability)
  );
  console.log(JSON.stringify(result));
  if (result.status !== "INSTALLED") process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof OperatorInputError ? error.message :
      "Genesis command failed before an operation result was confirmed. Verify inputs and use status before retrying apply.");
    process.exitCode = 1;
  });
}
