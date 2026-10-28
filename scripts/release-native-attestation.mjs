import { createHash } from "node:crypto";
import { isAbsolute, join, normalize, parse as parsePath } from "node:path";
import { assertUniqueResultJsonKeys } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-contract.mjs";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { assertReleaseFileLimits, readBoundedRegularFile } from "./release-files.mjs";
import { ReleaseBlocked } from "./release-transport.mjs";
import { MAX_RELEASE_RECORD_BYTES } from "./release-bytes.mjs";

export const NATIVE_GH_MEDIA_TYPE = "application/vnd.dev.sigstore.verificationresult+json;version=0.1";
export const NATIVE_SLSA_PREDICATE = "https://slsa.dev/provenance/v1";
export const NATIVE_CERTIFICATE_FIELDS = Object.freeze([
  "subjectAlternativeName", "issuer", "buildSignerURI", "buildSignerDigest", "buildConfigURI", "buildConfigDigest",
  "sourceRepositoryURI", "sourceRepositoryIdentifier", "sourceRepositoryOwnerURI", "sourceRepositoryOwnerIdentifier",
  "sourceRepositoryDigest", "sourceRepositoryRef", "runnerEnvironment", "runInvocationURI",
]);
const optionalCertificateFields = ["certificateIssuer", "sourceRepositoryVisibilityAtSigning",
  "githubWorkflowTrigger", "githubWorkflowSHA", "githubWorkflowName", "githubWorkflowRepository", "githubWorkflowRef"];
const limit = 1024 * 1024;
export const NATIVE_GH_IDENTITY_BLOCKER = "NATIVE_GH_EXECUTION_IDENTITY_UNSUPPORTED";
const hex = (raw) => createHash("sha256").update(raw).digest("hex");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const digest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const sha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const keys = (value, required, optional = []) => object(value) &&
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const bytes = (value) => value instanceof Uint8Array && value.byteLength > 0;
const block = (code) => { throw new ReleaseBlocked(code, "BLOCKED_IMPLEMENTATION"); };
const check = (condition, code) => { if (!condition) block(code); };

function assertPolicy(expected) {
  check(object(expected) && expected.approval === "APPROVED", "NATIVE_GH_POLICY_UNAPPROVED");
  check(expected.repository === "tsukasa-u/FUSOU", "NATIVE_GH_REPOSITORY_POLICY_MISSING");
  check(expected.signer_workflow === "tsukasa-u/FUSOU/.github/workflows/tlsn-native-build.yml",
    "NATIVE_GH_SIGNER_POLICY_MISSING");
  check(expected.predicate_type === NATIVE_SLSA_PREDICATE, "NATIVE_GH_PREDICATE_POLICY_MISSING");
  const c = expected.certificate;
  check(keys(c, NATIVE_CERTIFICATE_FIELDS) && Object.values(c).every(nonempty), "NATIVE_GH_CERTIFICATE_POLICY_MISSING");
  check(c.issuer === "https://token.actions.githubusercontent.com" &&
    c.sourceRepositoryURI === `https://github.com/${expected.repository}` &&
    c.sourceRepositoryOwnerURI === "https://github.com/tsukasa-u" &&
    /^[1-9][0-9]*$/.test(c.sourceRepositoryIdentifier) && /^[1-9][0-9]*$/.test(c.sourceRepositoryOwnerIdentifier) &&
    sha(c.buildSignerDigest) && sha(c.buildConfigDigest) && sha(c.sourceRepositoryDigest) &&
    /^refs\/(?:heads|tags)\/[^\s]+$/.test(c.sourceRepositoryRef) &&
    c.subjectAlternativeName === c.buildSignerURI &&
    c.buildSignerURI.startsWith(`https://github.com/${expected.signer_workflow}@`) &&
    /^https:\/\/github\.com\/tsukasa-u\/FUSOU\/\.github\/workflows\/[^@\s]+@/.test(c.buildConfigURI) &&
    c.runnerEnvironment === "github-hosted" &&
    /^https:\/\/github\.com\/tsukasa-u\/FUSOU\/actions\/runs\/[1-9][0-9]*\/attempts\/[1-9][0-9]*$/.test(c.runInvocationURI),
  "NATIVE_GH_CERTIFICATE_POLICY_INVALID");
  const t = expected.timestamps;
  check(keys(t, ["authorities", "not_before_ms", "not_after_ms"]) &&
    Array.isArray(t.authorities) && t.authorities.length > 0 && t.authorities.every((authority) =>
      keys(authority, ["type", "uri"]) && nonempty(authority.type) && nonempty(authority.uri)) &&
    Number.isSafeInteger(t.not_before_ms) && Number.isSafeInteger(t.not_after_ms) && t.not_before_ms <= t.not_after_ms,
  "NATIVE_GH_TIMESTAMP_POLICY_MISSING");
}

export function assertNativeGhVersion(raw) {
  check(bytes(raw), "NATIVE_GH_VERSION_UNKNOWN");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
  catch (error) { if (!(error instanceof TypeError)) throw error; block("NATIVE_GH_VERSION_UNKNOWN"); }
  const lines = text.trimEnd().split(/\r?\n/);
  const match = lines[0].match(/^gh version (\d+)\.(\d+)\.(\d+)(-[A-Za-z0-9.-]+)?(?: \([^\r\n]*\))?$/);
  check(match, "NATIVE_GH_VERSION_UNKNOWN");
  check(match[1] === "2" && !match[4] && Number.isSafeInteger(Number(match[2])) &&
    Number.isSafeInteger(Number(match[3])) && Number(match[2]) >= 102, "NATIVE_GH_VERSION_UNSUPPORTED");
  const version = `${match[1]}.${match[2]}.${match[3]}`;
  check(lines.length === 1 || (lines.length === 2 &&
    lines[1] === `https://github.com/cli/cli/releases/tag/v${version}`), "NATIVE_GH_VERSION_UNSUPPORTED");
  return version;
}

function timestampMilliseconds(value) {
  const parts = typeof value === "string" && value.match(
    /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?(?:Z|[+-](\d\d):(\d\d))$/);
  if (!parts) return NaN;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 ||
    second > 59 || Number(parts[7] ?? 0) > 23 || Number(parts[8] ?? 0) > 59) return NaN;
  return Date.parse(value);
}

export function nativeGhVerifyCommand(artifactPath, expected) {
  assertPolicy(expected);
  check(typeof artifactPath === "string" && isAbsolute(artifactPath) && !artifactPath.includes("\0"),
    "NATIVE_GH_ARTIFACT_PATH_INVALID");
  const c = expected.certificate;
  return ["attestation", "verify", artifactPath, "--repo", expected.repository,
    "--signer-workflow", expected.signer_workflow, "--signer-digest", c.buildSignerDigest,
    "--predicate-type", expected.predicate_type, "--source-digest", c.sourceRepositoryDigest,
    "--source-ref", c.sourceRepositoryRef, "--format", "json"];
}

export function parseNativeGhVerification(stdout, { expected, artifactSha256 }) {
  assertPolicy(expected);
  check(digest(artifactSha256), "NATIVE_GH_ARTIFACT_DIGEST_INVALID");
  check(bytes(stdout) && stdout.byteLength <= limit, "NATIVE_GH_OUTPUT_MISSING_OR_OVERSIZED");
  let entries;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(stdout);
    entries = JSON.parse(text);
    assertUniqueResultJsonKeys(text);
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof TypeError ||
      error.message === "Result bytes contain a duplicate JSON object key")) throw error;
    block("NATIVE_GH_JSON_INVALID");
  }
  check(Array.isArray(entries) && entries.length === 1, "NATIVE_GH_RESULTS_EMPTY_OR_AMBIGUOUS");
  const entry = entries[0];
  check(keys(entry, ["attestation", "verificationResult"]) && object(entry.attestation), "NATIVE_GH_ENTRY_INVALID");
  const v = entry.verificationResult;
  check(keys(v, ["mediaType", "statement", "signature", "verifiedTimestamps"], ["verifiedIdentity"]) &&
    v.mediaType === NATIVE_GH_MEDIA_TYPE && (v.verifiedIdentity === undefined || object(v.verifiedIdentity)),
  "NATIVE_GH_SCHEMA_UNSUPPORTED");
  const s = v.statement;
  check(keys(s, ["_type", "subject", "predicateType", "predicate"]) &&
    s._type === "https://in-toto.io/Statement/v1" && object(s.predicate), "NATIVE_GH_STATEMENT_INVALID");
  check(s.predicateType === expected.predicate_type, "NATIVE_GH_PREDICATE_MISMATCH");
  check(Array.isArray(s.subject) && s.subject.length > 0 && s.subject.every((subject) =>
    keys(subject, ["name", "digest"]) && nonempty(subject.name) && object(subject.digest) && digest(subject.digest.sha256)) &&
    s.subject.filter((subject) => subject.digest.sha256 === artifactSha256).length === 1 &&
    new Set(s.subject.map((subject) => subject.name)).size === s.subject.length, "NATIVE_GH_SUBJECT_MISMATCH");
  check(keys(v.signature, ["certificate"], ["publicKeyId"]) &&
    (v.signature.publicKeyId === undefined || nonempty(v.signature.publicKeyId)), "NATIVE_GH_CERTIFICATE_MISSING");
  const certificate = v.signature.certificate;
  check(keys(certificate, NATIVE_CERTIFICATE_FIELDS, optionalCertificateFields) &&
    Object.values(certificate).every(nonempty), "NATIVE_GH_CERTIFICATE_MISSING");
  // Only verifier certificate fields, never producer-controlled predicate fields, supply identity.
  check(NATIVE_CERTIFICATE_FIELDS.every((field) => certificate[field] === expected.certificate[field]),
    "NATIVE_GH_CERTIFICATE_MISMATCH");
  const timestamps = v.verifiedTimestamps, seen = new Set();
  check(Array.isArray(timestamps) && timestamps.length > 0 && timestamps.every((t) => {
    if (!keys(t, ["type", "uri", "timestamp"])) return false;
    const time = timestampMilliseconds(t.timestamp), identity = canonicalJson(t);
    if (!Number.isFinite(time) || time < expected.timestamps.not_before_ms || time > expected.timestamps.not_after_ms ||
      !expected.timestamps.authorities.some((a) => a.type === t.type && a.uri === t.uri) || seen.has(identity)) return false;
    seen.add(identity); return true;
  }), "NATIVE_GH_TIMESTAMP_INVALID");
  return { schema_consistency: "VERIFIED", subject_sha256: artifactSha256,
    certificate: structuredClone(certificate), verified_timestamps: structuredClone(timestamps),
    signature_verification: "UNVERIFIED", authenticated: false };
}

// No fd-bound/immutable execution provider is registered for Linux, macOS or Windows.
// Real execution is disabled on every OS; injected runners only exercise a mock contract.
export function prepareNativeGhInspection({ execution, fileLimits }, { mockRunner, mockReadFile } = {}) {
  check(typeof mockRunner === "function", NATIVE_GH_IDENTITY_BLOCKER);
  check(mockReadFile === undefined || typeof mockReadFile === "function", "NATIVE_GH_MOCK_BOUNDARY_INVALID");
  check(keys(execution, ["host", "config_root", "config_source", "credential_source"]),
    "NATIVE_GH_ENVIRONMENT_CONTRACT_MISSING");
  check(execution.host === "github.com", "NATIVE_GH_HOST_UNSUPPORTED");
  check(execution.config_source === "EMPTY_ISOLATED" &&
    typeof execution.config_root === "string" && isAbsolute(execution.config_root) &&
    !/[\0\r\n]/.test(execution.config_root) && normalize(execution.config_root) === execution.config_root &&
    execution.config_root !== parsePath(execution.config_root).root, "NATIVE_GH_CONFIG_CONTRACT_INVALID");
  check(execution.credential_source === "NONE", "NATIVE_GH_CREDENTIAL_PROVIDER_NOT_REGISTERED");
  check(keys(fileLimits, ["verifier_executable", "native_artifact", "build_metadata"]),
    "NATIVE_GH_FILE_LIMITS_MISSING");
  for (const maxBytes of Object.values(fileLimits)) assertReleaseFileLimits({ maxBytes });
  check(fileLimits.build_metadata <= MAX_RELEASE_RECORD_BYTES, "NATIVE_GH_METADATA_LIMIT_INVALID");
  const snapshot = canonicalJson({ execution, fileLimits }), limits = Object.freeze({ ...fileLimits });
  const settings = Object.freeze({ encoding: "buffer", shell: false, timeout: 15_000, maxBuffer: limit,
    windowsHide: true, cwd: execution.config_root, env: Object.freeze({
      GH_HOST: execution.host, GH_CONFIG_DIR: join(execution.config_root, "gh"),
      HOME: join(execution.config_root, "home"), XDG_CONFIG_HOME: join(execution.config_root, "xdg"),
      GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
      LANG: "C", LC_ALL: "C",
    }) });
  const assertUnchanged = () => check(canonicalJson({ execution, fileLimits }) === snapshot, "NATIVE_GH_INPUT_CHANGED");
  const checkBytes = (raw, role) => {
    check(Object.hasOwn(limits, role), "NATIVE_GH_FILE_ROLE_INVALID");
    check(bytes(raw), "NATIVE_GH_FILE_EMPTY_OR_INVALID");
    check(raw.byteLength <= limits[role], "NATIVE_GH_FILE_TOO_LARGE");
  };
  const read = async (path, role) => {
    assertUnchanged();
    check(Object.hasOwn(limits, role), "NATIVE_GH_FILE_ROLE_INVALID");
    const bounds = Object.freeze({ maxBytes: limits[role], minBytes: 1 });
    const raw = await (mockReadFile ? mockReadFile(path, bounds) : readBoundedRegularFile(path, bounds));
    assertUnchanged();
    checkBytes(raw, role);
    return mockReadFile ? Buffer.from(raw) : raw;
  };
  return { settings, assertUnchanged, checkBytes, read };
}

async function capturedRun(runner, executable, argv, settings) {
  let result;
  try {
    result = await runner(executable, argv, settings);
  } catch (error) {
    if (error?.code === "ENOENT") block("NATIVE_GH_NOT_FOUND");
    if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") block("NATIVE_GH_OUTPUT_MISSING_OR_OVERSIZED");
    if (error?.killed || error?.code === "ETIMEDOUT" || error?.code === "ABORT_ERR") block("NATIVE_GH_TIMEOUT");
    block(typeof error?.code === "number" ? "NATIVE_GH_EXIT_NONZERO" : "NATIVE_GH_EXECUTION_FAILED");
  }
  check(result && result.code === 0 && !result.signal, "NATIVE_GH_EXIT_NONZERO");
  check(result.stdout instanceof Uint8Array && result.stderr instanceof Uint8Array &&
    result.stdout.byteLength <= limit && result.stderr.byteLength <= limit, "NATIVE_GH_CAPTURE_INVALID");
  return result;
}

export async function inspectNativeGhArtifact({ artifactPath, expected, verifier, execution, fileLimits,
  artifactRole = "native_artifact" }, options = {}) {
  const argv = nativeGhVerifyCommand(artifactPath, expected);
  check(object(verifier) && typeof verifier.path === "string" && isAbsolute(verifier.path) && digest(verifier.sha256),
    "NATIVE_GH_EXECUTABLE_PIN_MISSING");
  const io = prepareNativeGhInspection({ execution, fileLimits }, options), { read, settings } = io;
  check(["native_artifact", "build_metadata"].includes(artifactRole), "NATIVE_GH_FILE_ROLE_INVALID");
  const expectedSnapshot = canonicalJson(expected), verifierSnapshot = canonicalJson(verifier);
  const executablePath = verifier.path;
  const assertUnchanged = () => {
    io.assertUnchanged();
    check(canonicalJson(expected) === expectedSnapshot && canonicalJson(verifier) === verifierSnapshot, "NATIVE_GH_INPUT_CHANGED");
  };
  let executable;
  try { executable = await read(executablePath, "verifier_executable"); }
  catch (error) { if (error.code !== "ENOENT") throw error; block("NATIVE_GH_NOT_FOUND"); }
  check(bytes(executable) && hex(executable) === verifier.sha256, "NATIVE_GH_EXECUTABLE_MISMATCH");
  const executableSha256 = hex(executable);
  const raw = await read(artifactPath, artifactRole);
  check(bytes(raw), "NATIVE_GH_ARTIFACT_MISSING");
  const artifactSha256 = hex(raw);
  assertUnchanged();
  const version = assertNativeGhVersion((await capturedRun(options.mockRunner, executablePath, ["--version"], settings)).stdout);
  assertUnchanged();
  const capture = await capturedRun(options.mockRunner, executablePath, argv, settings);
  assertUnchanged();
  check(hex(await read(executablePath, "verifier_executable")) === executableSha256 &&
    hex(await read(artifactPath, artifactRole)) === artifactSha256,
  "NATIVE_GH_INPUT_CHANGED");
  assertUnchanged();
  const parsed = parseNativeGhVerification(capture.stdout, { expected, artifactSha256 });
  return { ...parsed, status: "BLOCKED_IMPLEMENTATION", verification_mode: "MOCK_PROCESS",
    executable_identity: "UNVERIFIED", execution_identity_blocker: NATIVE_GH_IDENTITY_BLOCKER,
    gh_version: version, gh_executable_sha256: executableSha256, argv,
    stdout_sha256: hex(capture.stdout), stderr_sha256: hex(capture.stderr),
    blocker: "FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED",
    publication_authorized: false, deployment: "NOT_CHECKED", production_acceptance: "BLOCKED" };
}
