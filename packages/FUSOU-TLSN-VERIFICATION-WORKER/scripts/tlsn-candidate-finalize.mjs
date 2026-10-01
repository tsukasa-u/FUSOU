import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { verifyCanaryExistingSourceProofBundle } from "./canary-operational-smoke-existing-proofs.mjs";

const ARTIFACT_NAMES = [
  "session.json",
  "device-authentication.json",
  "device-identity.json",
  "possession-proof.json",
  "result.json",
  "consume-receipt.json",
  "worker-verification.json",
  "result-exact.bin",
  "verifier-execution-receipt-header.txt",
  "verifier-execution-receipt.bin",
  "presentation.bin",
  "metadata.json",
  "capture-provenance.json",
].sort();

const TRUST_CONTEXT_KEYS = [
  "verifierIdentityKeyRegistry",
  "trustedRuntimeIdentity",
  "expectedJobId",
  "expectedVerificationAttemptId",
  "sessionAuthority",
  "bindingAuthority",
  "resultAuthority",
  "deploymentManifest",
  "profileSha256",
  "notaryRegistry",
  "trustAnchorDer",
];

function sha256Base64Url(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function assertPrivateDirectoryStats(stats) {
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("candidate bundle path must be a real directory");
  }
  if (process.platform !== "win32") {
    if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
      throw new Error("candidate bundle directory must be owned by the current user");
    }
    if ((stats.mode & 0o077) !== 0) {
      throw new Error("candidate bundle directory permissions must be private");
    }
  }
}

function sameDirectoryIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function pinCandidateDirectory(directory) {
  const resolvedPath = path.resolve(directory);
  const pathStats = await lstat(resolvedPath);
  assertPrivateDirectoryStats(pathStats);
  let handle = null;
  if (process.platform !== "win32") {
    const flags = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0);
    handle = await open(resolvedPath, flags);
    try {
      const openedStats = await handle.stat();
      assertPrivateDirectoryStats(openedStats);
      if (!sameDirectoryIdentity(pathStats, openedStats)) {
        throw new Error("candidate bundle directory changed while being opened");
      }
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  return {
    path: resolvedPath,
    identity: { dev: pathStats.dev, ino: pathStats.ino },
    handle,
  };
}

async function assertPinnedCandidateDirectory(guard) {
  const pathStats = await lstat(guard.path);
  assertPrivateDirectoryStats(pathStats);
  if (!sameDirectoryIdentity(guard.identity, pathStats)) {
    throw new Error("candidate bundle directory identity changed during verification");
  }
  if (guard.handle) {
    const openedStats = await guard.handle.stat();
    assertPrivateDirectoryStats(openedStats);
    if (!sameDirectoryIdentity(guard.identity, openedStats)) {
      throw new Error("pinned candidate bundle directory identity changed during verification");
    }
  }
}

function assertPrivateFileStats(stats, label) {
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (process.platform !== "win32") {
    if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
      throw new Error(`${label} must be owned by the current user`);
    }
    if ((stats.mode & 0o077) !== 0) {
      throw new Error(`${label} permissions must be private`);
    }
  }
}

async function readPrivateFile(filePath, label, directoryGuard) {
  await assertPinnedCandidateDirectory(directoryGuard);
  const pathStats = await lstat(filePath);
  assertPrivateFileStats(pathStats, label);
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(filePath, flags);
  try {
    const openedStats = await handle.stat();
    assertPrivateFileStats(openedStats, label);
    if (!sameDirectoryIdentity(pathStats, openedStats)) {
      throw new Error(`${label} changed while being opened`);
    }
    const bytes = await handle.readFile();
    await assertPinnedCandidateDirectory(directoryGuard);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readArtifact(directoryGuard, manifest, name) {
  const expected = manifest.artifacts?.[name];
  if (!expected || !Number.isSafeInteger(expected.size_bytes) || typeof expected.sha256 !== "string") {
    throw new Error(`candidate manifest is missing artifact metadata: ${name}`);
  }
  const filePath = path.join(directoryGuard.path, name);
  const bytes = await readPrivateFile(filePath, `candidate artifact ${name}`, directoryGuard);
  if (bytes.length !== expected.size_bytes || sha256Base64Url(bytes) !== expected.sha256) {
    throw new Error(`candidate artifact integrity mismatch: ${name}`);
  }
  return bytes;
}

async function loadPinnedTlsnCandidateBundle(directoryGuard) {
  const candidateDirectory = directoryGuard.path;
  await assertPinnedCandidateDirectory(directoryGuard);
  const manifestPath = path.join(candidateDirectory, "candidate-manifest.json");
  const manifestBytes = await readPrivateFile(manifestPath, "candidate manifest", directoryGuard);
  const manifest = parseJson(manifestBytes, "candidate manifest");
  if (
    manifest.schema_version !== 1 ||
    manifest.scope !== "fusou-tlsn-human-test-play-candidate" ||
    manifest.candidate_status !== "CAPTURED_PENDING_OFFLINE_VERIFICATION" ||
    manifest.approval_status !== "UNAPPROVED" ||
    manifest.target_identity_status !== "NOT_YET_OBSERVED" ||
    manifest.readiness_effect !== "NONE" ||
    manifest.gameplay_effect !== "NONE"
  ) {
    throw new Error("candidate manifest scope or status is invalid");
  }
  if (
    typeof manifest.synthetic_fixture !== "boolean" ||
    (manifest.synthetic_fixture && manifest.capture_provenance !== "synthetic-alpha15-test-fixture") ||
    (!manifest.synthetic_fixture && manifest.capture_provenance !== "production-proxy-capture")
  ) {
    throw new Error("candidate synthetic fixture classification is invalid");
  }
  const artifactNames = Object.keys(manifest.artifacts ?? {}).sort();
  assert.deepEqual(artifactNames, ARTIFACT_NAMES, "candidate artifact inventory is incomplete or unexpected");
  const finalizationPath = path.join(candidateDirectory, "candidate-finalization.json");
  let hasExistingFinalization = false;
  try {
    assertPrivateFileStats(await lstat(finalizationPath), "candidate finalization");
    hasExistingFinalization = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await assertPinnedCandidateDirectory(directoryGuard);
  const actualNames = (await readdir(candidateDirectory)).sort();
  await assertPinnedCandidateDirectory(directoryGuard);
  assert.deepEqual(
    actualNames,
    [
      ...ARTIFACT_NAMES,
      "candidate-manifest.json",
      ...(hasExistingFinalization ? ["candidate-finalization.json"] : []),
    ].sort(),
    "candidate directory contains missing or unexpected entries",
  );

  const artifacts = Object.fromEntries(
    await Promise.all(ARTIFACT_NAMES.map(async (name) => [
      name,
      await readArtifact(directoryGuard, manifest, name),
    ])),
  );
  await assertPinnedCandidateDirectory(directoryGuard);
  const presentationBytes = artifacts["presentation.bin"];
  const resultBytes = artifacts["result-exact.bin"];
  const receiptBytes = artifacts["verifier-execution-receipt.bin"];
  const receiptHeader = artifacts["verifier-execution-receipt-header.txt"].toString("ascii");
  if (
    sha256Base64Url(presentationBytes) !== manifest.presentation_sha256 ||
    sha256Base64Url(resultBytes) !== manifest.exact_result_sha256 ||
    sha256Base64Url(receiptBytes) !== manifest.verifier_execution_receipt_sha256 ||
    manifest.verifier_execution_receipt_status !== "CAPTURED" ||
    Buffer.from(receiptHeader, "base64url").toString("base64url") !== receiptHeader ||
    Buffer.from(receiptHeader, "base64url").compare(receiptBytes) !== 0
  ) {
    throw new Error("candidate proof bytes do not match the capture manifest");
  }

  const session = parseJson(artifacts["session.json"], "captured Session");
  const deviceAuthentication = parseJson(
    artifacts["device-authentication.json"],
    "captured device authentication",
  );
  const deviceIdentity = parseJson(artifacts["device-identity.json"], "captured device identity");
  const possessionProof = parseJson(artifacts["possession-proof.json"], "captured possession proof");
  const workerVerification = parseJson(
    artifacts["worker-verification.json"],
    "captured Worker verification",
  );
  const responsePayload = parseJson(resultBytes, "exact Worker result body");
  const result = parseJson(artifacts["result.json"], "captured Result");
  const consumeReceipt = parseJson(artifacts["consume-receipt.json"], "captured consume receipt");
  const captureProvenance = parseJson(
    artifacts["capture-provenance.json"],
    "capture provenance",
  );
  const expectedProvenance = manifest.synthetic_fixture
    ? { classification: "SYNTHETIC_FIXTURE", source: "synthetic-alpha15-test-fixture" }
    : { classification: "UNVERIFIED", source: "production-proxy-capture" };
  if (
    !isDeepStrictEqual(responsePayload, workerVerification) ||
    !isDeepStrictEqual(result, workerVerification.result) ||
    !isDeepStrictEqual(consumeReceipt, workerVerification.consume_receipt) ||
    captureProvenance.schema_version !== 1 ||
    captureProvenance.classification !== expectedProvenance.classification ||
    captureProvenance.source !== expectedProvenance.source ||
    manifest.capture_provenance !== expectedProvenance.source ||
    deviceIdentity.authority_state !== "UNVERIFIED" ||
    session.canonical_user_id !== session.session_receipt?.canonical_user_id
  ) {
    throw new Error("candidate proof artifacts are inconsistent or claim unsupported identity authority");
  }

  return {
    candidateDirectory,
    manifest,
    manifestSha256: sha256Base64Url(manifestBytes),
    artifacts,
    session,
    deviceAuthentication,
    deviceIdentity,
    possessionProof,
    consumeReceipt,
    workerVerification,
    presentationBytes,
    resultBytes,
    verifierExecutionReceiptBytes: receiptBytes,
  };
}

export async function loadTlsnCandidateBundle(candidateDirectory) {
  const directoryGuard = await pinCandidateDirectory(candidateDirectory);
  try {
    return await loadPinnedTlsnCandidateBundle(directoryGuard);
  } finally {
    await directoryGuard.handle?.close();
  }
}

function validateTrustContext(trustContext) {
  assertObject(trustContext, "offline trust context");
  const allowedKeys = new Set([...TRUST_CONTEXT_KEYS, "disclosureMode"]);
  const keys = Object.keys(trustContext);
  if (keys.some((key) => !allowedKeys.has(key)) || TRUST_CONTEXT_KEYS.some((key) => !(key in trustContext))) {
    throw new Error("offline trust context fields are incomplete or unexpected");
  }
  assertObject(trustContext.deploymentManifest, "deployment manifest");
  if (trustContext.deploymentManifest.target !== undefined) {
    assertObject(trustContext.deploymentManifest.target, "deployment target");
    if (typeof trustContext.deploymentManifest.target.server_identity !== "string") {
      throw new Error("deployment target server identity is malformed");
    }
  }
  return trustContext;
}

export async function finalizeTlsnCandidateBundle({
  candidateDirectory,
  trustContext,
} = {}) {
  const directoryGuard = await pinCandidateDirectory(candidateDirectory);
  try {
    const bundle = await loadPinnedTlsnCandidateBundle(directoryGuard);
    const trusted = validateTrustContext(trustContext);
    const verification = await verifyCanaryExistingSourceProofBundle({
    ...trusted,
    session: bundle.session,
    deviceAuthentication: bundle.deviceAuthentication,
    deviceIdentity: bundle.deviceIdentity,
    possessionProof: bundle.possessionProof,
    consumeReceipt: bundle.consumeReceipt,
    presentationBytes: bundle.presentationBytes,
    resultBytes: bundle.resultBytes,
    verifierExecutionReceiptBytes: bundle.verifierExecutionReceiptBytes,
    syntheticFixture: bundle.manifest.synthetic_fixture,
  });
    verification.evidence.synthetic = bundle.manifest.synthetic_fixture ? true : null;
    verification.evidence.synthetic_classification = bundle.manifest.synthetic_fixture
    ? "DECLARED_SYNTHETIC_FIXTURE"
    : "UNVERIFIED";
    const verifiedPresentation = verification?.verified_presentation;
    if (
    verification?.status !== "PASS" ||
    verification.proof_bundle_status !== "PASS_LIMITED" ||
    verification.readiness_effect !== "NONE" ||
    verification.gameplay_effect !== "NONE" ||
    verification.operational_smoke_effect !== "NONE" ||
    typeof verifiedPresentation?.server_identity !== "string" ||
    verifiedPresentation.server_identity.length === 0 ||
    (trusted.deploymentManifest.target?.server_identity !== undefined &&
      verifiedPresentation.server_identity !== trusted.deploymentManifest.target.server_identity) ||
    verifiedPresentation.presentation_sha256 !== bundle.manifest.presentation_sha256
    ) {
      throw new Error("offline proof verifier did not return a bounded verified Presentation identity");
    }

    const finalization = {
    schema_version: 1,
    scope: "fusou-tlsn-human-test-play-observed-target",
    status: "OBSERVED_UNAPPROVED",
    approval_status: "UNAPPROVED",
    proof_bundle_status: verification.proof_bundle_status,
    candidate_manifest_sha256: bundle.manifestSha256,
    target_identity: {
      source: "verified-alpha15-presentation",
      server_identity: verifiedPresentation.server_identity,
      presentation_sha256: verifiedPresentation.presentation_sha256,
      tlsn_attestation_id: verifiedPresentation.tlsn_attestation_id,
      notary_key_sha256: verifiedPresentation.notary_key_sha256,
      profile_id: verifiedPresentation.profile_id,
      profile_sha256: verifiedPresentation.profile_sha256,
      disclosure_mode: verifiedPresentation.disclosure_mode,
    },
    verification,
    human_play_provenance: "UNVERIFIED",
    synthetic_fixture_status: bundle.manifest.synthetic_fixture
      ? "DECLARED_SYNTHETIC_FIXTURE"
      : "UNVERIFIED",
    capture_provenance_status: bundle.manifest.synthetic_fixture
      ? "DECLARED_SYNTHETIC_FIXTURE"
      : "UNVERIFIED",
    readiness_effect: "NONE",
    gameplay_effect: "NONE",
    };
    const outputPath = path.join(directoryGuard.path, "candidate-finalization.json");
    await assertPinnedCandidateDirectory(directoryGuard);
    const output = await open(outputPath, "wx", 0o600);
    try {
      await assertPinnedCandidateDirectory(directoryGuard);
      await output.writeFile(`${JSON.stringify(finalization, null, 2)}\n`, "utf8");
      await output.sync();
      await assertPinnedCandidateDirectory(directoryGuard);
      await output.close();
    } catch (error) {
      await output.close().catch(() => {});
      if (await assertPinnedCandidateDirectory(directoryGuard).then(() => true, () => false)) {
        await rm(outputPath, { force: true }).catch(() => {});
      }
      throw error;
    }
    return finalization;
  } finally {
    await directoryGuard.handle?.close();
  }
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!["--bundle", "--trust-context"].includes(key) || !value || values.has(key)) {
      throw new Error("usage: pnpm tlsn:candidate:finalize -- --bundle /absolute/candidate --trust-context /absolute/trust.json");
    }
    values.set(key, value);
  }
  const bundle = values.get("--bundle");
  const trustContext = values.get("--trust-context");
  if (!bundle || !trustContext || !path.isAbsolute(bundle) || !path.isAbsolute(trustContext)) {
    throw new Error("bundle and trust-context paths must be absolute");
  }
  return { bundle, trustContext };
}

async function main() {
  const { bundle, trustContext } = parseArguments(
    process.argv.slice(2).filter((argument) => argument !== "--"),
  );
  const result = await finalizeTlsnCandidateBundle({
    candidateDirectory: bundle,
    trustContext: parseJson(await readFile(trustContext), "offline trust context"),
  });
  console.log(`Candidate finalization: ${path.join(bundle, "candidate-finalization.json")}`);
  console.log(`Target identity: ${result.target_identity.server_identity} (OBSERVED_UNAPPROVED)`);
  console.log("Readiness and gameplay effects: NONE");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`tlsn:candidate:finalize: ${error.message}`);
    process.exitCode = 1;
  });
}