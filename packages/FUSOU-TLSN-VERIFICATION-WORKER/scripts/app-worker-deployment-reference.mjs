import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FORBIDDEN_PRODUCTION_INPUTS } from "./deployment-contract.mjs";
import { assertWorkerEndpointMapping, observeWorkerEndpointMapping } from "./app-worker-endpoint-mapping.mjs";
import {
  assertProvenanceEvidence,
  workflowContextFromEnvironment,
} from "./deployment-attestation.mjs";
import {
  assertPublicManifest,
  assertResultSigningIdentity,
} from "./production-trust-contract.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha256 = (value) => createHash("sha256").update(value).digest("base64url");

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`missing independent deployment input: ${name}`);
  return value;
}

function versionId(value, label) {
  if (!uuidPattern.test(value ?? "") || value === "00000000-0000-0000-0000-000000000000") {
    throw new Error(`${label} must be a canonical non-nil UUID`);
  }
  return value;
}

export function activeDeployment(payload) {
  if (payload?.success !== true || !Array.isArray(payload.result?.deployments)) {
    throw new Error("Cloudflare active deployment response is invalid");
  }
  // Cloudflare defines the first entry as the latest deployment actively serving traffic.
  const deployment = payload.result.deployments[0];
  versionId(deployment?.id, "Cloudflare deployment ID");
  if (!Number.isFinite(Date.parse(deployment.created_on)) ||
      deployment.versions?.length !== 1 || deployment.versions[0]?.percentage !== 100) {
    throw new Error("APP handoff requires one active Cloudflare version serving 100% of traffic");
  }
  return {
    deployment_id: deployment.id,
    created_on: deployment.created_on,
    version_id: versionId(deployment.versions[0].version_id, "Cloudflare active version ID"),
    percentage: 100,
  };
}

export function approvedProductionRelease(environment, provenance, publicManifest) {
  if (environment.TLSN_DEPLOYMENT_ROLE !== "production") {
    throw new Error("Production APP handoff cannot use a Canary release identity");
  }
  if (environment.TLSN_ENVIRONMENT !== "production") {
    throw new Error("Production approved release requires the production environment");
  }
  const context = workflowContextFromEnvironment(environment, "production");
  assertProvenanceEvidence(provenance, context, "production");
  assertPublicManifest(publicManifest);
  for (const [field, expected] of [
    ["notary_key_id", publicManifest.notary.key_id],
    ["notary_registry_sha256", publicManifest.notary.registry_sha256],
    ["security_registry_set_sha256", publicManifest.security_registry_set_sha256],
    ["origin_inventory_sha256", publicManifest.origin_inventory.sha256],
    ["target_approval_artifact_sha256", publicManifest.target_approval.approval_artifact_sha256],
  ]) {
    if (provenance.security_identity[field] !== expected) {
      throw new Error(`approved public manifest disagrees with provenance: ${field}`);
    }
  }
  const workerName = required(environment, "TLSN_PRODUCTION_WORKER_NAME");
  const deploymentId = required(environment, "TLSN_PRODUCTION_DEPLOYMENT_ID");
  if (!/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(workerName) ||
      provenance.deployment_identity.worker_name !== workerName ||
      provenance.deployment_identity.deployment_id !== deploymentId) {
    throw new Error("approved release deployment pins disagree with provenance");
  }
  const workerUrl = new URL(required(environment, "TLSN_VERIFY_WORKER_URL"));
  const verification = new URL(publicManifest.verification_endpoint);
  const disclosureMode = environment.TLSN_PRODUCTION_DISCLOSURE_MODE ?? "complete";
  if (!["complete", "sparse"].includes(disclosureMode)) throw new Error("APP handoff disclosure mode must be complete or sparse");
  if (workerUrl.protocol !== "https:" || workerUrl.href !== `${workerUrl.origin}/` ||
      workerUrl.origin !== verification.origin) {
    throw new Error("approved Worker origin does not match the public Verification endpoint");
  }
  if (disclosureMode === "sparse") verification.pathname = "/verify/tlsn/sparse";
  const registryRaw = required(environment, "TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY");
  const result = assertResultSigningIdentity({
    registry: registryRaw,
    registryRaw,
    keyId: required(environment, "TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID"),
    publicKeySpki: required(environment, "TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI"),
    registryEnvelope: required(environment, "TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE"),
    registryRootKeyId: required(environment, "TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID"),
    registryRootPublicKeySpki: required(environment, "TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI"),
  });
  for (const [field, resultField] of [
    ["result_public_key_spki", "public_key_spki"],
    ["result_signer_key_id", "key_id"],
    ["result_key_registry_sha256", "key_registry_sha256"],
    ["result_key_registry_envelope_sha256", "result_key_registry_envelope_sha256"],
    ["result_registry_root_key_id", "result_registry_root_key_id"],
    ["result_registry_root_public_key_spki", "result_registry_root_public_key_spki"],
  ]) {
    if (provenance.result_identity[field] !== result[resultField] ||
        publicManifest.result_signing[resultField] !== result[resultField]) {
      throw new Error(`independent Result authority disagrees with approved release: ${field}`);
    }
  }
  const publicBindings = {
    TLSN_ENVIRONMENT: "production",
    TLSN_DEPLOYMENT_ROLE: "production",
    TLSN_GIT_COMMIT_SHA: context.git_commit_sha,
    TLSN_PRODUCTION_DEPLOYMENT_ID: deploymentId,
    TLSN_PRODUCTION_WORKER_NAME: workerName,
    TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: result.public_key_spki,
    TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID: result.key_id,
    TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY: registryRaw,
    TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE: required(environment, "TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE"),
    TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID: result.result_registry_root_key_id,
    TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI: result.result_registry_root_public_key_spki,
    TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID: publicManifest.session_authority.key_id,
    TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: publicManifest.session_authority.public_key_spki,
    TLSN_CANDIDATE_NOTARY_KEY_ID: publicManifest.notary.key_id,
    TLSN_PRODUCTION_NOTARY_REGISTRY: publicManifest.notary.registry_raw,
    TLSN_CANDIDATE_VERIFIER_KEY_ID: provenance.security_identity.verifier_key_id,
    TLSN_SECURITY_REGISTRY_SET_SHA256: publicManifest.security_registry_set_sha256,
  };
  return {
    context, publicBindings, disclosureMode,
    compile_inputs: {
      FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID: deploymentId,
      FUSOU_TLSN_EXPECTED_WORKER_NAME: workerName,
      FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA: context.git_commit_sha,
      FUSOU_TLSN_EXPECTED_BINDING_MODE: "random",
      FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT: `${workerUrl.origin}/health`,
      FUSOU_TLSN_VERIFICATION_ENDPOINT: verification.href,
      FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI: result.public_key_spki,
      FUSOU_TLSN_RESULT_SIGNER_KEY_ID: result.key_id,
      FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY: registryRaw,
      FUSOU_TLSN_NOTARY_ENDPOINT: publicManifest.notary.endpoint,
      FUSOU_TLSN_NOTARY_VERIFYING_KEY: publicManifest.notary.verifying_key,
      FUSOU_TLSN_SESSION_AUTHORITY_ENDPOINT: publicManifest.session_authority.endpoint,
      FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID: publicManifest.session_authority.key_id,
      FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY: publicManifest.session_authority.public_key_spki,
    },
  };
}

export function createAppWorkerReference(release, deploymentPayload, versionPayload, accountId, observedAt, endpointMapping) {
  if (!/^[0-9a-f]{32}$/.test(accountId ?? "")) throw new Error("Cloudflare account ID is missing or invalid");
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("control-plane observation timestamp is invalid");
  const active = activeDeployment(deploymentPayload);
  if (versionPayload?.success !== true || versionPayload.result?.id !== active.version_id ||
      !Array.isArray(versionPayload.result.resources?.bindings)) {
    throw new Error("Cloudflare version detail does not match the active deployment/version");
  }
  const bindings = versionPayload.result.resources.bindings;
  if (bindings.some((binding) => !binding || typeof binding.name !== "string" || typeof binding.type !== "string")) {
    throw new Error("Cloudflare version binding metadata is invalid");
  }
  if (bindings.some((binding) => FORBIDDEN_PRODUCTION_INPUTS.includes(binding.name) ||
      binding.name === "TLSN_TEST_BINDING_VALUE")) {
    throw new Error("active Cloudflare version contains forbidden Canary/Test bindings");
  }
  for (const [name, expected] of Object.entries(release.publicBindings)) {
    const matches = bindings.filter((binding) => binding.name === name);
    if (matches.length !== 1 || matches[0].type !== "plain_text" || matches[0].text !== expected) {
      throw new Error(`active Cloudflare version does not match approved release binding: ${name}`);
    }
  }
  const metadataBindings = bindings.filter((binding) => binding.name === "CF_VERSION_METADATA");
  if (metadataBindings.length !== 1 || metadataBindings[0].type !== "version_metadata") {
    throw new Error("active Cloudflare version lacks CF_VERSION_METADATA");
  }
  const script = release.compile_inputs.FUSOU_TLSN_EXPECTED_WORKER_NAME;
  const source = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${script}`;
  assertWorkerEndpointMapping(endpointMapping, new URL(release.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT).origin, accountId, script);
  return {
    schema_version: 2,
    scope: "tlsn-app-approved-worker-deployment-reference",
    authority: "operator-controlled-approved-release-and-authenticated-cloudflare-control-plane",
    observed_at: observedAt,
    release_context: { ...release.context },
    disclosure_mode: release.disclosureMode,
    endpoint_mapping: structuredClone(endpointMapping),
    cloudflare: {
      account_id: accountId, script_name: script,
      deployments_source: `${source}/deployments`,
      version_source: `${source}/versions/${active.version_id}`,
      ...active,
      checked_public_bindings: { ...release.publicBindings },
    },
    compile_inputs: {
      ...release.compile_inputs,
      FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID: active.version_id,
    },
  };
}

export async function acquireAppWorkerReference({ environment, provenance, publicManifest, fetchImpl = fetch }) {
  // Build the approved release before making any observation; health is never an input.
  const release = approvedProductionRelease(environment, provenance, publicManifest);
  const accountId = required(environment, "CLOUDFLARE_ACCOUNT_ID");
  if (!/^[0-9a-f]{32}$/.test(accountId)) throw new Error("Cloudflare account ID is invalid");
  const token = required(environment, "CLOUDFLARE_API_TOKEN");
  const scriptName = release.compile_inputs.FUSOU_TLSN_EXPECTED_WORKER_NAME;
  const scriptPath = `/accounts/${accountId}/workers/scripts/${scriptName}`;
  async function get(path) {
    const url = `https://api.cloudflare.com/client/v4${path}`;
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error", signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("Cloudflare control-plane request failed (network, timeout or redirect)");
    }
    if (response.status !== 200) throw new Error(`Cloudflare control-plane request failed (${response.status})`);
    if (response.redirected || (response.url && response.url !== url)) throw new Error("Cloudflare control-plane response URL changed");
    try {
      return await response.json();
    } catch {
      throw new Error("Cloudflare control-plane response is malformed JSON");
    }
  }
  const deployments = await get(`${scriptPath}/deployments`);
  const active = activeDeployment(deployments);
  const version = await get(`${scriptPath}/versions/${active.version_id}`);
  const mappingInputs = {
    get, accountId, scriptName,
    origin: new URL(release.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT).origin,
  };
  const endpointMapping = await observeWorkerEndpointMapping(mappingInputs);
  const reference = createAppWorkerReference(release, deployments, version, accountId, new Date().toISOString(), endpointMapping);
  const latest = activeDeployment(await get(`${scriptPath}/deployments`));
  if (latest.deployment_id !== active.deployment_id || latest.version_id !== active.version_id) {
    throw new Error("active Cloudflare deployment changed during APP handoff");
  }
  if (JSON.stringify(await observeWorkerEndpointMapping(mappingInputs)) !== JSON.stringify(endpointMapping)) {
    throw new Error("Cloudflare endpoint/script mapping changed during APP handoff");
  }
  return reference;
}

export async function writeAppWorkerReference(environment) {
  const outputPath = resolve(required(environment, "TLSN_APP_WORKER_REFERENCE_PATH"));
  async function publicJson(name) {
    const bytes = await readFile(required(environment, name), "utf8");
    try {
      return JSON.parse(bytes);
    } catch {
      throw new Error(`independent public reference is malformed JSON: ${name}`);
    }
  }
  const provenance = await publicJson("TLSN_PROVENANCE_REPORT_PATH");
  const publicManifest = await publicJson("TLSN_PUBLIC_MANIFEST_PATH");
  const reference = await acquireAppWorkerReference({ environment, provenance, publicManifest });
  await writeFile(outputPath, `${JSON.stringify(reference, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(`[tlsn-app-worker-reference] wrote independent reference ${outputPath} (sha256 ${sha256(await readFile(outputPath))})`);
  return reference;
}
