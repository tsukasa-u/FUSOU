#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, createPrivateKey } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  issueSession,
  loadHealth,
  pollStatus,
  submitVerification,
  synchronousCompletion,
  verificationBody,
} from "./benchmark-tlsn-remote.mjs";
import {
  fixtureSourcePath,
  generateRealFixture,
  packageDirectory,
  readRealFixtureManifest,
} from "./tlsn-benchmark-fixtures.mjs";
import {
  assertSignedSparseResult,
} from "./production-evidence.mjs";
import {
  deriveSparseAuthenticatedMemberId,
  verifyNotaryIdentity,
  verifyResultKeyPublication,
  verifyServerIdentity,
  verifySparsePresentationBindingToSession,
  verifySparsePresentationCryptography,
  verifySparseRequireInfoHttpProfile,
  verifySparseResultPresentationBinding,
  verifySparseResultSignature,
  verifyProductionPresentation,
  verifyTrustRootPublication,
} from "./production-evidence-semantic.mjs";
import { sha256Base64Url } from "./deployment-attestation.mjs";
import { assertCanonicalTestWorkerName } from "./test-deployment-target.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function decodeBase64Url(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be base64 encoded`);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0) throw new Error(`${label} is not valid base64`);
  return bytes;
}

function loadPrivateKey() {
  const file = optional("TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE");
  const encoded = file
    ? readFile(file, "utf8")
    : Promise.resolve(required("TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL"));
  return encoded.then((value) => createPrivateKey({
    key: decodeBase64Url(value.trim(), "Test device private key"),
    format: "der",
    type: "pkcs8",
  }));
}

function testUser(accessToken) {
  let users;
  try {
    users = JSON.parse(required("TLSN_TEST_AUTH_USERS"));
  } catch {
    throw new Error("TLSN_TEST_AUTH_USERS must be valid JSON");
  }
  const user = users[accessToken];
  if (!user || typeof user.id !== "string" || user.is_anonymous === true) {
    throw new Error("Test access token is not mapped to a non-anonymous user");
  }
  return user.id;
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output.trim());
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

function wranglerJson(args, label) {
  return parseJsonOutput(
    execFileSync("pnpm", ["exec", "wrangler", ...args], { cwd: packageDirectory, encoding: "utf8" }),
    label,
  );
}

function platformIdentity(workerName, runtimeVersionId) {
  const deploymentPayload = wranglerJson(
    ["deployments", "list", "--name", workerName, "--json"],
    "Wrangler deployment metadata",
  );
  const versionPayload = wranglerJson(
    ["versions", "list", "--name", workerName, "--json"],
    "Wrangler version metadata",
  );
  const deployments = Array.isArray(deploymentPayload)
    ? deploymentPayload
    : deploymentPayload?.result?.deployments;
  const versions = Array.isArray(versionPayload)
    ? versionPayload
    : versionPayload?.result?.items;
  const deployment = deployments?.find((candidate) => candidate?.versions?.some(
    (entry) => entry?.version_id === runtimeVersionId,
  ));
  if (!deployment?.id || !Array.isArray(deployment.versions) || deployment.versions.length !== 1) {
    throw new Error("current runtime version was not found in a single-version Test deployment");
  }
  const serving = deployment.versions[0];
  if (serving?.percentage !== 100 || serving.version_id !== runtimeVersionId) {
    throw new Error("current Test deployment is not serving one version at 100 percent");
  }
  const version = versions?.find((candidate) => candidate?.id === runtimeVersionId);
  if (!version?.id) throw new Error("current Test version metadata was not found");
  return {
    worker_name: workerName,
    deployment_id: deployment.id,
    deployment_created_on: deployment.created_on,
    version_id: version.id,
    version_tag: version.tag,
    version_timestamp: version.created_on ?? version.timestamp,
    serving_percentage: serving.percentage,
  };
}

function resultRegistry(health) {
  const keyId = health.result_identity?.result_signer_key_id;
  const publicKeySpki = health.result_identity?.result_public_key_spki;
  if (!keyId || !publicKeySpki) throw new Error("Test health did not expose Result registry identity");
  const raw = `${JSON.stringify({
    schema_version: 1,
    scope: "tlsn-result-signing-key-registry",
    keys: [{
      key_id: keyId,
      public_key_spki: publicKeySpki,
      status: "ACTIVE",
      not_before: "2020-01-01T00:00:00.000Z",
      not_after: null,
    }],
  })}\n`;
  const sha256 = sha256Base64Url(raw);
  if (sha256 !== health.result_identity.result_key_registry_sha256) {
    throw new Error("reconstructed Test Result registry does not match /health hash");
  }
  return { raw, parsed: JSON.parse(raw), sha256 };
}

function verifiedPredicates({ presentationBytes, semanticVerification, result, session, sessionId, health, registry, trustedInputs, notaryRegistry, trustRootBytes }) {
  const verifiedAt = new Date().toISOString();
  const predicates = {
    presentation_cryptography: verifySparsePresentationCryptography({ presentationBytes, semanticVerification, verifiedAt }),
    notary_identity: verifyNotaryIdentity({ semanticVerification, notaryRegistry, notaryKeyId: trustedInputs.notary_key_id, verifiedAt }),
    server_identity: verifyServerIdentity({ semanticVerification, trustedServerIdentity: trustedInputs.server_identity, verifiedAt }),
    require_info_http_profile: verifySparseRequireInfoHttpProfile({
      semanticVerification,
      trustedServerIdentity: trustedInputs.server_identity,
      trustedProfileSha256: trustedInputs.profile_sha256,
      trustedVerifierKeyId: trustedInputs.verifier_key_id,
      verifiedAt,
    }),
    presentation_binding_to_session: verifySparsePresentationBindingToSession({
      semanticVerification,
      sessionBinding: session.binding,
      sessionId,
      verifiedAt,
    }),
    authenticated_member_id: deriveSparseAuthenticatedMemberId({
      semanticVerification,
      trustedServerIdentity: trustedInputs.server_identity,
      verifiedAt,
    }),
    result_presentation_binding: verifySparseResultPresentationBinding({ semanticVerification, result, verifiedAt }),
    result_signature: verifySparseResultSignature({
      result,
      resultRegistry: registry.parsed,
      resultPublicKeySpki: trustedInputs.result_public_key_spki,
      resultSignerKeyId: trustedInputs.result_signer_key_id,
      verifiedAt,
    }),
    result_key_publication: verifyResultKeyPublication({
      resultRegistry: registry.parsed,
      resultRegistrySha256: registry.sha256,
      resultPublicKeySpki: trustedInputs.result_public_key_spki,
      resultSignerKeyId: trustedInputs.result_signer_key_id,
      trustedInputs,
      verifiedAt,
    }),
    trust_root_publication: verifyTrustRootPublication({
      trustRootCertificateBytes: trustRootBytes,
      trustedTrustRootCertificateSha256: trustedInputs.trust_root_certificate_sha256,
      verifiedAt,
    }),
  };
  for (const [name, predicate] of Object.entries(predicates)) {
    if (predicate.status !== "PASS") throw new Error(`offline predicate did not PASS: ${name}`);
  }
  return predicates;
}

function valueAt(object, path) {
  return path.reduce((value, key) => value?.[key], object);
}

function assertFreshAttestation(candidate, expected) {
  assert.equal(candidate.schema_version, 1);
  assert.equal(candidate.scope, "tlsn-test-fresh-attestation");
  assert.equal(candidate.status, "PASS");
  assert.match(candidate.repository?.head_sha ?? "", /^[0-9a-f]{40}$/);
  assert.equal(candidate.repository.head_sha, expected.head_sha);
  assert.equal(candidate.deployment?.worker_name, assertCanonicalTestWorkerName(candidate.deployment?.worker_name));
  assert.equal(candidate.deployment.deployment_id, expected.deployment_id);
  assert.equal(candidate.deployment.version_id, expected.version_id);
  assert.equal(candidate.deployment.serving_percentage, 100);
  assert.equal(candidate.runtime.observed_version_id, candidate.deployment.version_id);
  assert.equal(candidate.runtime.observed_commit_sha, candidate.repository.head_sha);
  assert.equal(candidate.attested_version_id, candidate.deployment.version_id);
  assert.equal(candidate.verification_runtime_version_id, candidate.runtime.observed_version_id);
  assert.equal(candidate.same_deployment, true);
  assert.match(candidate.verification.session_id ?? "", UUID_PATTERN);
  assert.match(candidate.verification.binding_id ?? "", SHA256_BASE64URL_PATTERN);
  assert.match(candidate.evidence.presentation_sha256 ?? "", SHA256_BASE64URL_PATTERN);
  assert.equal(candidate.result.presentation_sha256, candidate.evidence.presentation_sha256);
  assert.equal(candidate.result_identity.signer_key_id, expected.signer_key_id);
  assert.equal(candidate.result_identity.public_key_spki_sha256, expected.public_key_spki_sha256);
  assert.equal(candidate.result_identity.registry_sha256, expected.registry_sha256);
  assert.equal(candidate.result.signature, candidate.result_signature);
  assertSignedSparseResult(candidate.result, {
    publicKeySpki: candidate.result_identity.public_key_spki,
    keyRegistry: expected.result_registry,
    signerKeyId: candidate.result_identity.signer_key_id,
  });
  return true;
}

function mutate(value, path, replacement) {
  const copy = structuredClone(value);
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key];
  target[path.at(-1)] = replacement;
  return copy;
}

function runTamperMatrix(candidate, expected) {
  const mutations = [
    [["repository", "head_sha"], "a".repeat(40)],
    [["deployment", "deployment_id"], "4b064508-1cdb-453c-826b-bdea36a8b1e5"],
    [["deployment", "version_id"], "d82e4bec-3c4f-4a90-9d22-cb1e9186221b"],
    [["runtime", "observed_version_id"], "d82e4bec-3c4f-4a90-9d22-cb1e9186221b"],
    [["result_identity", "signer_key_id"], "other-key"],
    [["result_identity", "public_key_spki_sha256"], "A".repeat(43)],
    [["result_identity", "registry_sha256"], "A".repeat(43)],
    [["evidence", "presentation_sha256"], "A".repeat(43)],
    [["result", "verified_member_id"], "999999"],
    [["result_signature"], "B".repeat(86)],
  ];
  for (const [path, replacement] of mutations) {
    assert.throws(() => assertFreshAttestation(mutate(candidate, path, replacement), expected), path.join("."));
  }
  return mutations.length;
}

async function writeRestricted(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

async function main() {
  const workerOrigin = new URL(required("TLSN_REMOTE_BENCHMARK_WORKER_URL")).origin;
  const workerName = assertCanonicalTestWorkerName(optional("TLSN_TEST_WORKER_NAME") ?? "fusou-tlsn-verification-test");
  const accessToken = required("TLSN_REMOTE_ACCESS_TOKEN_A");
  const device = { id: required("TLSN_REMOTE_DEVICE_ID_A") };
  const privateKey = await loadPrivateKey();
  const canonicalUserId = testUser(accessToken);
  const healthBefore = await loadHealth(workerOrigin);
  if (healthBefore.environment !== "test" || healthBefore.deployment_role !== "synthetic-test") {
    throw new Error("fresh attestation requires the synthetic Test Worker");
  }
  if (healthBefore.binding_mode !== "random" || healthBefore.auth_mode !== "test-token") {
    throw new Error("fresh attestation requires random binding and Test token auth");
  }
  if (!healthBefore.runtime_version?.version_id || healthBefore.git_commit_sha !== /^[0-9a-f]{40}$/i.exec(healthBefore.git_commit_sha)?.[0]) {
    throw new Error("Test health did not expose a valid runtime identity");
  }
  const platform = platformIdentity(workerName, healthBefore.runtime_version.version_id);
  const { manifest, entries } = readRealFixtureManifest();
  const caseLabel = optional("TLSN_TEST_FRESH_FIXTURE_CASE") ?? "p50";
  const entry = entries.get(caseLabel);
  if (!entry) throw new Error(`unknown fresh fixture case: ${caseLabel}`);
  const session = await issueSession(workerOrigin, undefined, accessToken, device, privateKey, "test");
  const fixture = generateRealFixture(fixtureSourcePath(manifest, entry), session.binding);
  const presentationBytes = Buffer.from(fixture.sparse_presentation_base64, "base64url");
  const body = verificationBody(session, device, privateKey, fixture);
  const submission = await submitVerification(
    workerOrigin,
    accessToken,
    body,
    healthBefore.execution_mode === "direct" && optional("TLSN_REMOTE_DIRECT_SYNCHRONOUS_CANDIDATE") === "true",
  );
  const completion = submission.responseMode === "direct_synchronous"
    ? synchronousCompletion(submission, healthBefore.execution_mode)
    : await pollStatus(
      workerOrigin,
      accessToken,
      canonicalUserId,
      device,
      session,
      submission.jobId,
      submission.benchmarkTraceId,
      Number(optional("TLSN_REMOTE_POLL_INTERVAL_MS") ?? 250),
      Number(optional("TLSN_REMOTE_MAX_POLL_MS") ?? 300_000),
      healthBefore.execution_mode,
      false,
    );
  if (completion.outcome !== "verified" || !completion.responseBytes || completion.responseJson?.verified !== true) {
    throw new Error(`fresh Test verification did not return a verified Result: ${completion.outcome}`);
  }
  const healthAfter = await loadHealth(workerOrigin);
  if (healthAfter.runtime_version?.version_id !== platform.version_id || healthAfter.git_commit_sha !== healthBefore.git_commit_sha) {
    throw new Error("runtime identity changed during fresh verification");
  }
  if (healthAfter.runtime_version?.version_id !== healthBefore.runtime_version.version_id) {
    throw new Error("fresh verification did not remain on the attested runtime version");
  }
  const result = completion.responseJson.result;
  const registry = resultRegistry(healthBefore);
  const notaryRegistryRaw = required("TLSN_NOTARY_REGISTRY");
  let notaryRegistry;
  try {
    notaryRegistry = JSON.parse(notaryRegistryRaw);
  } catch {
    throw new Error("TLSN_NOTARY_REGISTRY must be valid JSON");
  }
  const trustRootBytes = decodeBase64Url(required("TLSN_TRUST_ROOT_CERTIFICATE_DER"), "Test trust root");
  const trustedInputs = {
    server_identity: healthBefore.security_identity.server_identity,
    profile_sha256: healthBefore.sparse_profile_sha256,
    verifier_key_id: healthBefore.verifier_key_id,
    notary_key_id: healthBefore.notary_key_id,
    result_public_key_spki: healthBefore.result_identity.result_public_key_spki,
    result_signer_key_id: healthBefore.result_identity.result_signer_key_id,
    result_key_registry_sha256: healthBefore.result_identity.result_key_registry_sha256,
    trust_root_certificate_sha256: sha256Base64Url(trustRootBytes),
  };
  const semanticVerification = await verifyProductionPresentation({
    presentationBytes,
    serverIdentity: trustedInputs.server_identity,
    profileSha256: trustedInputs.profile_sha256,
    verifierKeyId: trustedInputs.verifier_key_id,
    notaryKeyId: trustedInputs.notary_key_id,
    canonicalUserId,
    canonicalDeviceId: device.id,
    deviceChallenge: session.device_challenge,
    notaryRegistry,
    trustAnchorDer: required("TLSN_TRUST_ROOT_CERTIFICATE_DER"),
    disclosureMode: "sparse",
  });
  const predicates = verifiedPredicates({
    presentationBytes,
    semanticVerification,
    result,
    session,
    sessionId: session.session_id,
    health: healthBefore,
    registry,
    trustedInputs,
    notaryRegistry,
    trustRootBytes,
  });
  assertSignedSparseResult(result, {
    publicKeySpki: trustedInputs.result_public_key_spki,
    keyRegistry: registry.parsed,
    signerKeyId: trustedInputs.result_signer_key_id,
  });
  const presentationSha256 = sha256Base64Url(presentationBytes);
  const bindingId = sha256Base64Url(session.binding);
  const candidate = {
    schema_version: 1,
    scope: "tlsn-test-fresh-attestation",
    status: "PASS",
    created_at: new Date().toISOString(),
    repository: {
      head_sha: healthBefore.git_commit_sha,
      head_checked_before_deploy: true,
    },
    deployment: {
      worker_name: platform.worker_name,
      deployment_id: platform.deployment_id,
      version_id: platform.version_id,
      serving_percentage: platform.serving_percentage,
      version_tag: platform.version_tag,
      version_timestamp: platform.version_timestamp,
    },
    runtime: {
      observed_version_id: healthAfter.runtime_version.version_id,
      version_tag: healthAfter.runtime_version.version_tag,
      version_timestamp: healthAfter.runtime_version.version_timestamp,
      observed_commit_sha: healthAfter.git_commit_sha,
      health_observation: "PASS",
    },
    result_identity: {
      signer_key_id: trustedInputs.result_signer_key_id,
      public_key_spki: trustedInputs.result_public_key_spki,
      public_key_spki_sha256: healthBefore.result_identity.result_public_key_spki_sha256,
      registry_sha256: registry.sha256,
    },
    verification: {
      session_id: session.session_id,
      binding_id: bindingId,
      profile_id: semanticVerification.result.profile_id,
      target_identity: {
        kind: "synthetic_fixture",
        fixture_case: caseLabel,
        server_identity: trustedInputs.server_identity,
      },
      verifier_identity: {
        worker: "tlsn-alpha15-wasm",
        offline: "local-production-evidence-semantic-v2",
        verifier_key_id: trustedInputs.verifier_key_id,
      },
      live_verified: true,
      offline_verified: true,
      predicates_passed: Object.keys(predicates),
    },
    evidence: {
      presentation_sha256: presentationSha256,
      presentation_bytes: presentationBytes.length,
      evidence_identity: {
        tlsn_attestation_id: semanticVerification.verified_presentation.tlsn_attestation_id,
        notary_key_sha256: semanticVerification.verified_presentation.notary_key_sha256,
        server_identity: semanticVerification.verified_presentation.server_identity,
      },
    },
    result,
    result_signature: result.signature,
    attested_version_id: platform.version_id,
    verification_runtime_version_id: healthAfter.runtime_version.version_id,
    same_deployment: true,
  };
  const expected = {
    head_sha: platform.version_id === healthBefore.runtime_version.version_id ? healthBefore.git_commit_sha : "",
    deployment_id: platform.deployment_id,
    version_id: platform.version_id,
    signer_key_id: trustedInputs.result_signer_key_id,
    public_key_spki_sha256: healthBefore.result_identity.result_public_key_spki_sha256,
    registry_sha256: registry.sha256,
    result_registry: registry.parsed,
  };
  assertFreshAttestation(candidate, expected);
  const tamperCount = runTamperMatrix(candidate, expected);
  const capturePath = resolve(optional("TLSN_TEST_FRESH_CAPTURE_PATH") ?? "/tmp/fusou-test-fresh-capture.json");
  const attestationPath = resolve(optional("TLSN_TEST_FRESH_ATTESTATION_PATH") ?? "/tmp/fusou-test-fresh-attestation.json");
  await writeRestricted(capturePath, {
    schema_version: 1,
    scope: "tlsn-test-fresh-evidence-bundle",
    provenance: "synthetic-test-only",
    worker_origin: workerOrigin,
    health_before: healthBefore,
    health_after: healthAfter,
    platform,
    session: {
      session_id: session.session_id,
      binding: session.binding,
      device_id: session.device_id,
      device_challenge: session.device_challenge,
      session_receipt: session.session_receipt,
    },
    fixture: {
      case_label: caseLabel,
      presentation_base64: fixture.sparse_presentation_base64,
    },
    live_result_response_base64: Buffer.from(completion.responseBytes).toString("base64"),
    live_result_response_sha256: sha256Base64Url(completion.responseBytes),
    result_registry_raw: registry.raw,
    notary_registry_raw: notaryRegistryRaw,
    trust_root_certificate_der: required("TLSN_TRUST_ROOT_CERTIFICATE_DER"),
    offline_predicates: predicates,
    candidate_path: attestationPath,
  });
  await writeRestricted(attestationPath, candidate);
  console.log(JSON.stringify({
    status: "PASS",
    worker: platform.worker_name,
    deployment_id: platform.deployment_id,
    version_id: platform.version_id,
    session_id: session.session_id,
    binding_id: bindingId,
    presentation_sha256: presentationSha256,
    result_signature_valid: true,
    offline_predicates: Object.keys(predicates).length,
    tamper_rejections: `${tamperCount}/${tamperCount}`,
    capture_path: capturePath,
    attestation_path: attestationPath,
    production_access: "NONE",
    canary_access: "NONE",
    game_server_access: "NONE",
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[tlsn-test-fresh-attestation] ${error instanceof Error ? error.message : "fresh_attestation_failed"}`);
    process.exitCode = 2;
  });
}

export { assertFreshAttestation, runTamperMatrix };
