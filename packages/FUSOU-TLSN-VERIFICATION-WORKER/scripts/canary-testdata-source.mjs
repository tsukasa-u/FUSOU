import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const FUSOU_TESTDATA_REPOSITORY = "tsukasa-u/FUSOU-TESTDATA";
export const FUSOU_TESTDATA_COMMIT_SHA = "c4cac63a78771103641f437369d966250a766a15";
export const FUSOU_TESTDATA_SOURCE_PATH = "kcsapi/1751968253S@api_get_member@require_info";
export const FUSOU_TESTDATA_SYNTHETIC_MEMBER_ID = 16189463;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
if (!COMMIT_SHA_PATTERN.test(FUSOU_TESTDATA_COMMIT_SHA)) throw new Error("invalid fixed FUSOU-TESTDATA commit SHA");
const RUNTIME_EXTERNAL_SERVICES = Object.freeze({
  game_server: "NOT_USED",
  fusou_notary: "NOT_USED",
  cloudflare: "NOT_USED",
  supabase: "NOT_USED",
  r2: "NOT_USED",
  trigger_dev: "NOT_USED",
  real_tlsnotary_session: "NOT_USED",
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWithin(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === ""
    || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

function requiredEnvironment(name, expected) {
  const value = process.env[name]?.trim();
  if (value !== expected) {
    throw new Error(`${name} must be the fixed FUSOU-TESTDATA contract value`);
  }
  return value;
}

function assertWorkflowConfiguration() {
  requiredEnvironment("FUSOU_TESTDATA_REPOSITORY", FUSOU_TESTDATA_REPOSITORY);
  requiredEnvironment("FUSOU_TESTDATA_COMMIT_SHA", FUSOU_TESTDATA_COMMIT_SHA);
  requiredEnvironment("FUSOU_TESTDATA_SOURCE_PATH", FUSOU_TESTDATA_SOURCE_PATH);
  const root = process.env.FUSOU_TESTDATA_PATH?.trim();
  if (!root || !isAbsolute(root)) throw new Error("FUSOU_TESTDATA_PATH must be an absolute checkout path");
  return root;
}

function checkoutHead(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error("FUSOU-TESTDATA checkout must be a local Git checkout");
  }
}

function assertDetachedCheckout(root) {
  try {
    const branch = execFileSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    throw new Error(`FUSOU-TESTDATA checkout must be detached, found branch ${branch}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("FUSOU-TESTDATA checkout must be detached")) throw error;
  }
}

export async function loadFusouTestdataSource() {
  const root = assertWorkflowConfiguration();
  const head = checkoutHead(root);
  if (head !== FUSOU_TESTDATA_COMMIT_SHA) {
    throw new Error(`FUSOU-TESTDATA HEAD must equal ${FUSOU_TESTDATA_COMMIT_SHA}`);
  }
  assertDetachedCheckout(root);

  const sourcePath = resolve(root, FUSOU_TESTDATA_SOURCE_PATH);
  if (!isWithin(root, sourcePath) || !FUSOU_TESTDATA_SOURCE_PATH.startsWith("kcsapi/")) {
    throw new Error("FUSOU-TESTDATA source path must remain inside kcsapi/");
  }

  let rawSource;
  try {
    rawSource = await readFile(sourcePath);
  } catch {
    throw new Error(`FUSOU-TESTDATA source is missing: ${FUSOU_TESTDATA_SOURCE_PATH}`);
  }
  let sourceBody;
  try {
    sourceBody = JSON.parse(rawSource.toString("utf8"));
  } catch {
    throw new Error("FUSOU-TESTDATA require_info source must be a JSON response body");
  }
  if (!sourceBody || typeof sourceBody !== "object" || Array.isArray(sourceBody)) {
    throw new Error("FUSOU-TESTDATA require_info source must be a JSON object");
  }
  if (sourceBody.api_result !== 1 || !sourceBody.api_data?.api_basic) {
    throw new Error("FUSOU-TESTDATA require_info source lacks api_result/api_basic");
  }
  if (typeof sourceBody.api_data.api_basic.api_member_id !== "number") {
    throw new Error("FUSOU-TESTDATA require_info source lacks api_member_id");
  }

  const syntheticBody = structuredClone(sourceBody);
  syntheticBody.api_data.api_basic.api_member_id = FUSOU_TESTDATA_SYNTHETIC_MEMBER_ID;
  const syntheticResponse = Buffer.from(`svdata=${canonicalJson(syntheticBody)}`, "utf8");
  const sourceSha256 = sha256Hex(rawSource);
  const syntheticResponseSha256 = sha256Hex(syntheticResponse);
  if (!SHA256_HEX_PATTERN.test(sourceSha256) || !SHA256_HEX_PATTERN.test(syntheticResponseSha256)) {
    throw new Error("synthetic fixture digest generation failed");
  }

  return {
    schema_version: 1,
    artifact: "fusou-testdata-synthetic-require-info-input",
    synthetic_fixture: true,
    evidence_status: "NOT_REAL_EVIDENCE",
    source: {
      repository: FUSOU_TESTDATA_REPOSITORY,
      commit_sha: FUSOU_TESTDATA_COMMIT_SHA,
      path: FUSOU_TESTDATA_SOURCE_PATH,
      semantics: "KCSAPI JSON body only; HTTP status, headers, TLS framing, and TLSNotary session are absent",
      source_body_sha256: sourceSha256,
    },
    transform: {
      operation: "canonical-json-with-fixed-synthetic-member-id",
      masked_member_id_replaced: FUSOU_TESTDATA_SYNTHETIC_MEMBER_ID,
    },
    input: {
      content_type: "synthetic-svdata-response-body",
      body_base64url: syntheticResponse.toString("base64url"),
      body_sha256: syntheticResponseSha256,
      body_bytes: syntheticResponse.length,
      member_id: FUSOU_TESTDATA_SYNTHETIC_MEMBER_ID,
    },
    network_access: {
      source_control_fetch: "ALLOWED",
      ...RUNTIME_EXTERNAL_SERVICES,
    },
  };
}

export function testdataContractConstants() {
  return {
    repository: FUSOU_TESTDATA_REPOSITORY,
    commit_sha: FUSOU_TESTDATA_COMMIT_SHA,
    source_path: FUSOU_TESTDATA_SOURCE_PATH,
  };
}
