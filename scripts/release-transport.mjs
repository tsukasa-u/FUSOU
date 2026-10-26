import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sha256 } from "./release-bytes.mjs";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { producerArtifactName, requireRelease } from "./release-build-proof.mjs";
import { createProducerExecutionOrigin, EXECUTION_ORIGIN_FILE } from "./release-execution-origin.mjs";
const authenticatedTransports = new WeakMap();
const transportBinding = ({ files, origin }, run) => canonicalJson({ origin, run,
  files: Object.fromEntries([...files].map(([name, bytes]) => [name,
    { sha256: createHash("sha256").update(bytes).digest("hex"), byte_length: bytes.byteLength }])) });
export function assertAuthenticatedReleaseTransport(downloaded, run) {
  requireRelease(authenticatedTransports.get(downloaded.authenticationProof) === transportBinding(downloaded, run),
    "unauthenticated/changed GitHub release transport");
}

// Operational admission limits, not a bound on process RSS.
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_TRANSPORT_BYTES = 512 * 1024 * 1024;
const fileName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const exec = promisify(execFile);
export async function packProducerTransport(report, readOutput, { executionProofs, capturedChecks = new Map() } = {}) {
  const files = new Map([["release-report.json", Buffer.from(canonicalJson(report))]]);
  if (report.build?.status === "BUILD_OUTPUTS_GENERATED") {
    for (const claim of report.build.artifacts) {
      for (const name of [claim.file, claim.build_record_file, claim.provenance_file]) {
        requireRelease(typeof name === "string" && fileName.test(name) && name !== "__proto__" && name !== EXECUTION_ORIGIN_FILE,
          "producer output filename");
        requireRelease(!files.has(name), "duplicate producer output filename");
        files.set(name, await readOutput(name));
      }
    }
    for (const name of report.build.check_files ?? []) {
        requireRelease(/^(?:check-[a-z_]+\.json|evidence-[A-Za-z0-9_-]{43}\.bin|app-compiled-observations\.json)$/.test(name) &&
          !files.has(name), "producer check output filename");
        files.set(name, await readOutput(name));
    }
    requireRelease(capturedChecks instanceof Map, "producer captured check inventory");
    const proofs = { ...executionProofs };
    for (const [check, execution] of capturedChecks) {
      requireRelease(["archive_readback", "offline_verification"].includes(check) &&
        execution?.files instanceof Map && execution.executionProof &&
        (!proofs[check] || proofs[check] === execution.executionProof) &&
        execution.record instanceof Uint8Array && execution.receipt instanceof Uint8Array &&
        execution.files.get(`check-${check}.json`) instanceof Uint8Array &&
        execution.files.get(`evidence-${sha256(execution.receipt)}.bin`) instanceof Uint8Array &&
        Buffer.from(execution.record).equals(execution.files.get(`check-${check}.json`)) &&
        Buffer.from(execution.receipt).equals(execution.files.get(`evidence-${sha256(execution.receipt)}.bin`)),
      "producer captured execution record/proof");
      for (const [name, raw] of execution.files) {
        const match = /^evidence-([A-Za-z0-9_-]{43})\.bin$/.exec(name);
        requireRelease(raw instanceof Uint8Array && (name === `check-${check}.json` ||
          match && sha256(raw) === match[1]),
        "producer captured raw evidence filename/hash");
        requireRelease(!files.has(name) || Buffer.from(files.get(name)).equals(raw), "conflicting captured producer evidence");
        files.set(name, Buffer.from(raw));
      }
      proofs[check] = execution.executionProof;
    }
    files.set(EXECUTION_ORIGIN_FILE, createProducerExecutionOrigin({ report, files, executionProofs: proofs,
      context: { repository: "tsukasa-u/FUSOU", source_sha: report.commit_sha,
        run_id: report.eligibility_run.run_id, run_attempt: report.eligibility_run.run_attempt, workflow_sha: report.coordinator_sha } }));
  }
  return encodeReleaseTransport(files);
}
export class ReleaseBlocked extends Error {
  constructor(code, status = "BLOCKED_EXTERNAL_INPUTS") {
    super(code); this.name = "ReleaseBlocked"; this.code = code; this.status = status;
  }
}
export function encodeReleaseTransport(files) {
  requireRelease(files instanceof Map && files.size > 0 && files.size <= 64, "transport file inventory");
  const encoded = {};
  for (const [name, bytes] of files) {
    requireRelease(fileName.test(name) && name !== "__proto__" && bytes instanceof Uint8Array, "transport file name/bytes");
    encoded[name] = Buffer.from(bytes).toString("base64url");
  }
  const raw = Buffer.from(canonicalJson({ schema_version: 1, scope: "fusou-release-transport-v1", files: encoded }));
  requireRelease(raw.length <= MAX_TRANSPORT_BYTES, "transport admission limit");
  return raw;
}
export function decodeReleaseTransport(raw) {
  requireRelease(raw instanceof Uint8Array && raw.byteLength <= MAX_TRANSPORT_BYTES, "transport byte limit");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw), value = JSON.parse(text);
  requireRelease(canonicalJson(value) === text && value.schema_version === 1 &&
    value.scope === "fusou-release-transport-v1" &&
    Object.keys(value).sort().join() === "files,schema_version,scope" &&
    value.files && typeof value.files === "object" && !Array.isArray(value.files), "transport canonical schema");
  const files = new Map();
  for (const [name, data] of Object.entries(value.files)) {
    requireRelease(fileName.test(name) && name !== "__proto__" && typeof data === "string", "transport entry");
    const bytes = Buffer.from(data, "base64url");
    requireRelease(bytes.toString("base64url") === data, "transport canonical base64url");
    files.set(name, bytes);
  }
  requireRelease(files.size > 0 && files.size <= 64 && files.has("release-report.json"), "transport required report/inventory");
  return files;
}
export async function readTransportZip(archive) {
  requireRelease(archive instanceof Uint8Array && archive.byteLength > 0 &&
    archive.byteLength <= MAX_ARCHIVE_BYTES, "ZIP admission limit");
  const directory = await mkdtemp(join(tmpdir(), "fusou-release-zip-"));
  try {
    const path = join(directory, "download.zip");
    await writeFile(path, archive, { flag: "wx", mode: 0o600 });
    const listing = await exec("unzip", ["-Z1", path], { maxBuffer: 4096, timeout: 30_000, encoding: "utf8" });
    requireRelease(listing.stdout === "release-transport.json\n", "ZIP must contain exactly one transport entry");
    // Stream only this member to stdout; never extract paths or execute artifact contents.
    const result = await exec("unzip", ["-p", path, "release-transport.json"],
      { maxBuffer: MAX_TRANSPORT_BYTES, timeout: 120_000, encoding: "buffer" });
    return decodeReleaseTransport(result.stdout);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function downloadGithubArtifact({ artifactId, token, fetchImpl = fetch }) {
  requireRelease(Number.isSafeInteger(artifactId) && artifactId > 0 && typeof token === "string" && token.length > 0,
    "artifact download identity/token");
  const response = await fetchImpl(`https://api.github.com/repos/tsukasa-u/FUSOU/actions/artifacts/${artifactId}/zip`, {
    redirect: "manual", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(30_000),
  });
  requireRelease(response.status === 302, `artifact download redirect status ${response.status}`);
  const target = new URL(response.headers.get("location"));
  requireRelease(target.protocol === "https:" && !target.username && !target.password && !target.port && !target.hash,
    "artifact redirect must be HTTPS");
  // The short-lived storage URL comes from authenticated GitHub, not from the artifact.
  const storage = await fetchImpl(target.href, { redirect: "error", signal: AbortSignal.timeout(120_000) });
  requireRelease(storage.ok && storage.body, `artifact storage status ${storage.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of storage.body) {
    size += chunk.byteLength;
    requireRelease(size <= MAX_ARCHIVE_BYTES, "archive download admission limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}
function assertMetadata(a, run, artifactKind = "release") {
  requireRelease(Number.isSafeInteger(a?.id) && a.id > 0 &&
    a.name === (artifactKind === "archive" ? `fusou-archive-${run.id}-${run.run_attempt}` : producerArtifactName(run.id, run.run_attempt)) &&
    a.expired === false && Number.isSafeInteger(a.size_in_bytes) && a.size_in_bytes > 0 &&
    a.size_in_bytes <= MAX_ARCHIVE_BYTES && a.workflow_run?.id === run.id &&
    a.workflow_run.head_sha === run.head_sha && a.workflow_run.head_branch === "main" &&
    a.workflow_run.repository_id === run.repository.id && a.workflow_run.head_repository_id === run.head_repository.id,
  "artifact API metadata/run origin");
  if (a.digest === null || a.digest === undefined) throw new ReleaseBlocked("ARTIFACT_API_DIGEST_UNAVAILABLE");
  requireRelease(/^sha256:[0-9a-f]{64}$/.test(a.digest), "artifact API digest");
}
export async function acquireReleaseTransport({ github, run, downloadArchive, readArchive = readTransportZip, artifactKind = "release" }) {
  requireRelease(["release", "archive"].includes(artifactKind), "unregistered artifact kind");
  const params = { owner: "tsukasa-u", repo: "FUSOU", run_id: run.id, per_page: 100,
    name: artifactKind === "archive" ? `fusou-archive-${run.id}-${run.run_attempt}` : producerArtifactName(run.id, run.run_attempt) };
  const list = (await github.rest.actions.listWorkflowRunArtifacts(params)).data;
  requireRelease(Number.isSafeInteger(list.total_count) && list.total_count >= 0 && Array.isArray(list.artifacts), "artifact listing schema");
  if (artifactKind === "archive" && list.total_count === 0 && list.artifacts.length === 0) {
    throw new ReleaseBlocked("AUTHENTICATED_ARCHIVE_HTTP_ARTIFACT_MISSING");
  }
  requireRelease(list.total_count === 1 && list.artifacts.length === 1, "missing/ambiguous producer artifact");
  const metadata = list.artifacts[0];
  assertMetadata(metadata, run, artifactKind);
  const snapshot = canonicalJson(metadata);
  const archive = Buffer.from(await downloadArchive(metadata.id));
  requireRelease(archive.length > 0 && archive.length <= MAX_ARCHIVE_BYTES &&
    `sha256:${createHash("sha256").update(archive).digest("hex")}` === metadata.digest, "downloaded archive digest mismatch");
  const files = await readArchive(archive);
  requireRelease(`sha256:${createHash("sha256").update(archive).digest("hex")}` === metadata.digest, "archive changed during readback");
  const fresh = (await github.rest.actions.getArtifact({ owner: "tsukasa-u", repo: "FUSOU", artifact_id: metadata.id })).data;
  assertMetadata(fresh, run, artifactKind);
  requireRelease(canonicalJson(fresh) === snapshot, "artifact metadata changed during readback");
  const result = { files: new Map([...files].map(([name, raw]) => [name, Buffer.from(raw)])),
    origin: Object.freeze({ id: metadata.id, name: metadata.name, digest: metadata.digest,
      run_id: run.id, workflow_sha: run.head_sha }), archive_byte_length: archive.length, authenticationProof: Object.freeze({}) };
  authenticatedTransports.set(result.authenticationProof, transportBinding(result, run));
  return result;
}
