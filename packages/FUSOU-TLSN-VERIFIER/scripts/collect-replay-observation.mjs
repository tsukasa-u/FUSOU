import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { tlsnDeviceProofSigningBytes } from "../../FUSOU-TLSN-VERIFICATION-WORKER/src/device-proof-framing.ts";

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const CANDIDATE_SCOPE = "fusou-tlsn-human-test-play-candidate";
const REQUIRED_CANDIDATE_FILES = [
  "presentation.bin",
  "result.json",
  "result-exact.bin",
  "worker-verification.json",
  "consume-receipt.json",
  "session.json",
  "possession-proof.json",
  "verifier-execution-receipt.bin",
  "verifier-execution-receipt-header.txt",
];
const STORED_PROOF_KEYS = [
  "canonical_user_id",
  "device_id",
  "proof_kind",
  "proof_digest",
  "session_id",
  "binding_sha256",
  "challenge_sha256",
  "consumed_at",
];

export class ReplayCollectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReplayCollectionError";
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest();
}

function parseJson(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new ReplayCollectionError(`${label} is not valid UTF-8 JSON`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ReplayCollectionError(`${label} is missing`);
  }
  return value;
}

function decodeBase64Url(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ReplayCollectionError(`${label} is not canonical base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) {
    throw new ReplayCollectionError(`${label} is not canonical base64url`);
  }
  return bytes;
}

async function readRegularFile(root, name, maximum, budget) {
  const path = resolve(root, name);
  if (dirname(path) !== root) {
    throw new ReplayCollectionError(`candidate path is unsafe: ${name}`);
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximum ||
      metadata.size > budget.remaining) {
    throw new ReplayCollectionError(`candidate file is not a bounded regular file: ${name}`);
  }
  const bytes = await readFile(path);
  if (bytes.length > maximum || bytes.length > budget.remaining) {
    throw new ReplayCollectionError(`candidate file exceeded the read limit: ${name}`);
  }
  budget.remaining -= bytes.length;
  return bytes;
}

async function readCandidate(candidateDirectory) {
  const root = await realpath(candidateDirectory);
  const budget = { remaining: MAX_INPUT_BYTES };
  const manifestBytes = await readRegularFile(root, "candidate-manifest.json", MAX_FILE_BYTES, budget);
  const manifest = parseJson(manifestBytes, "candidate manifest");
  if (manifest.schema_version !== 2 ||
      manifest.scope !== CANDIDATE_SCOPE ||
      manifest.synthetic_fixture !== false ||
      manifest.capture_provenance !== "production-proxy-capture" ||
      manifest.candidate_status !== "CAPTURED_PENDING_OFFLINE_VERIFICATION" ||
      manifest.verifier_execution_receipt_status !== "CAPTURED" ||
      !manifest.artifacts || typeof manifest.artifacts !== "object" || Array.isArray(manifest.artifacts)) {
    throw new ReplayCollectionError("candidate is incomplete or has unsupported provenance/schema");
  }

  const files = new Map();
  for (const name of REQUIRED_CANDIDATE_FILES) {
    const descriptor = manifest.artifacts[name];
    if (!descriptor || !Number.isSafeInteger(descriptor.size_bytes) ||
        typeof descriptor.sha256 !== "string") {
      throw new ReplayCollectionError(`candidate artifact descriptor is missing: ${name}`);
    }
    const bytes = await readRegularFile(root, name, MAX_FILE_BYTES, budget);
    if (descriptor.size_bytes !== bytes.length ||
        descriptor.sha256 !== sha256(bytes).toString("base64url")) {
      throw new ReplayCollectionError(`candidate artifact digest/length mismatch: ${name}`);
    }
    files.set(name, bytes);
  }

  const presentationBytes = files.get("presentation.bin");
  const resultBytes = files.get("result.json");
  const exactResultBytes = files.get("result-exact.bin");
  const result = parseJson(resultBytes, "candidate Result");
  const exactResult = parseJson(exactResultBytes, "exact Result response");
  const workerVerification = parseJson(files.get("worker-verification.json"), "Worker verification response");
  const consumeReceipt = parseJson(files.get("consume-receipt.json"), "consume receipt");
  const session = parseJson(files.get("session.json"), "candidate Session");
  const possession = parseJson(files.get("possession-proof.json"), "candidate possession proof");
  if (exactResult.verified !== true ||
      !isDeepStrictEqual(exactResult.result, result) ||
      !isDeepStrictEqual(exactResult.consume_receipt, consumeReceipt) ||
      !isDeepStrictEqual(exactResult, workerVerification) ||
      exactResult.device_replay_digest_hex !== possession.replay_digest_hex) {
    throw new ReplayCollectionError("candidate Result envelope does not match its saved Result, receipt, and proof");
  }

  for (const [label, value] of [
    ["session ID", session.session_id],
    ["Result session ID", result.attestation_session_id],
    ["device ID", result.canonical_device_id],
    ["canonical user ID", result.canonical_user_id],
    ["binding", result.binding_value],
    ["device challenge", session.device_challenge],
    ["Presentation ID", consumeReceipt.presentation_id],
  ]) {
    requireString(value, label);
  }
  if (session.session_id !== result.attestation_session_id ||
      session.device_id !== result.canonical_device_id ||
      session.canonical_user_id !== result.canonical_user_id ||
      session.binding !== result.binding_value ||
      session.device_challenge !== result.device_challenge ||
      consumeReceipt.session_id !== session.session_id ||
      consumeReceipt.device_id !== session.device_id ||
      consumeReceipt.canonical_user_id !== session.canonical_user_id ||
      consumeReceipt.binding_value !== session.binding ||
      consumeReceipt.presentation_id !== sha256(presentationBytes).toString("base64url")) {
    throw new ReplayCollectionError("candidate Session, Result, Presentation, and consume receipt do not agree");
  }

  const challengeBytes = decodeBase64Url(session.device_challenge, "device challenge");
  if (challengeBytes.length !== 32) {
    throw new ReplayCollectionError("candidate device challenge has an invalid length");
  }
  const proof = {
    device_id: requireString(possession.device_id, "proof device ID"),
    session_id: requireString(possession.session_id, "proof session ID"),
    binding_value: requireString(possession.binding_value, "proof binding"),
    challenge: requireString(possession.challenge, "proof challenge"),
    sig: requireString(possession.sig, "proof signature"),
  };
  if (proof.device_id !== session.device_id ||
      proof.session_id !== session.session_id ||
      proof.binding_value !== session.binding ||
      proof.challenge !== session.device_challenge) {
    throw new ReplayCollectionError("candidate possession proof is bound to another capture context");
  }
  const signingBytes = tlsnDeviceProofSigningBytes(proof, challengeBytes);
  const proofDigest = sha256(signingBytes);
  const proofDigestHex = proofDigest.toString("hex");
  if (possession.replay_digest_hex !== proofDigestHex ||
      possession.message_sha256_hex !== proofDigestHex ||
      exactResult.device_replay_digest_hex !== proofDigestHex) {
    throw new ReplayCollectionError("candidate possession proof digest is inconsistent");
  }

  const receiptBytes = files.get("verifier-execution-receipt.bin");
  const receiptHeader = new TextDecoder("utf-8", { fatal: true }).decode(
    files.get("verifier-execution-receipt-header.txt"),
  );
  if (receiptBytes.length === 0 || receiptHeader !== receiptBytes.toString("base64url")) {
    throw new ReplayCollectionError("candidate execution receipt header differs from its exact bytes");
  }
  for (const [field, bytes] of [
    ["presentation_sha256", presentationBytes],
    ["exact_result_sha256", exactResultBytes],
    ["verifier_execution_receipt_sha256", receiptBytes],
  ]) {
    if (manifest[field] !== sha256(bytes).toString("base64url")) {
      throw new ReplayCollectionError(`candidate top-level digest mismatch: ${field}`);
    }
  }

  return {
    proof,
    result,
    session,
    consumeReceipt,
    presentationId: consumeReceipt.presentation_id,
    challengeBytes,
    proofDigest,
    proofDigestHex,
  };
}

async function readBoundedResponse(response) {
  const declared = response.headers.get("Content-Length");
  if (declared !== null &&
      (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) ||
       Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    throw new ReplayCollectionError("replay observation response length exceeds the limit");
  }
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > MAX_RESPONSE_BYTES - length) {
        await reader.cancel();
        throw new ReplayCollectionError("replay observation response exceeds the streamed byte limit");
      }
      length += value.length;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function validateEndpoint(endpoint) {
  const url = new URL(endpoint);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
      url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" ||
      !url.pathname.endsWith("/anonymous-sync/v2/tlsn-device-proof")) {
    throw new ReplayCollectionError("endpoint must be the TLSN device-proof owner endpoint over HTTPS");
  }
  return url;
}

export async function collectReplayObservation(
  candidateDirectory,
  endpoint,
  bearerToken,
  fetcher = fetch,
) {
  if (typeof bearerToken !== "string" || bearerToken.length === 0 ||
      bearerToken.length > 8192 || /[\r\n]/.test(bearerToken)) {
    throw new ReplayCollectionError("an explicit bounded owner bearer token is required");
  }
  const url = validateEndpoint(endpoint);
  const candidate = await readCandidate(candidateDirectory);
  let response;
  try {
    response = await fetcher(url, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "Authorization": `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
        "X-FUSOU-TLSN-Replay-Observation": "true",
      },
      body: JSON.stringify(candidate.proof),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ReplayCollectionError(`single replay observation request failed: ${message}`);
  }

  const responseBytes = await readBoundedResponse(response);
  if (response.status !== 409) {
    throw new ReplayCollectionError(`replay observation requires HTTP 409; received ${response.status}`);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "")) {
    throw new ReplayCollectionError("replay observation response is not JSON");
  }
  const body = parseJson(responseBytes, "replay observation response");
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).sort().join(",") !== "error,stored_proof" ||
      body.error !== "device_proof_replayed" ||
      !body.stored_proof || typeof body.stored_proof !== "object" ||
      Array.isArray(body.stored_proof) ||
      Object.keys(body.stored_proof).sort().join(",") !== [...STORED_PROOF_KEYS].sort().join(",")) {
    throw new ReplayCollectionError("HTTP 409 is not the expected stored-proof replay rejection");
  }

  const stored = body.stored_proof;
  const bindingDigest = sha256(new TextEncoder().encode(candidate.proof.binding_value)).toString("hex");
  const challengeDigest = sha256(candidate.challengeBytes).toString("hex");
  if (stored.canonical_user_id !== candidate.result.canonical_user_id ||
      stored.device_id !== candidate.proof.device_id ||
      stored.proof_kind !== "possession" ||
      stored.proof_digest !== candidate.proofDigestHex ||
      stored.session_id !== candidate.proof.session_id ||
      stored.binding_sha256 !== bindingDigest ||
      stored.challenge_sha256 !== challengeDigest ||
      typeof stored.consumed_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(stored.consumed_at) ||
      !Number.isFinite(Date.parse(stored.consumed_at))) {
    throw new ReplayCollectionError("HTTP 409 stored proof does not match this candidate's user/device/session/proof");
  }

  const responseHash = sha256(responseBytes);
  return {
    schema_version: 1,
    observation_type: "tlsn-device-proof-replay-observation",
    observation_source: "authenticated_web_read_only_observation",
    authority_observation_signed: false,
    status: response.status,
    error: body.error,
    session_id: candidate.proof.session_id,
    device_id: candidate.proof.device_id,
    binding: candidate.proof.binding_value,
    replay_digest: candidate.proofDigest.toString("base64url"),
    replay_digest_hex: candidate.proofDigestHex,
    stored_replay_digest_hex: stored.proof_digest,
    consume_receipt_presentation_id: candidate.presentationId,
    response_body_base64url: Buffer.from(responseBytes).toString("base64url"),
    response_body_byte_length: responseBytes.length,
    response_body_sha256: responseHash.toString("base64url"),
    response_body_sha256_hex: responseHash.toString("hex"),
    authority_observation: stored,
  };
}

export async function writeReplayObservation(path, material) {
  const bytes = Buffer.from(`${JSON.stringify(material)}\n`, "utf8");
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    let cleanupMessage = "";
    if (handle) {
      try {
        await handle.close();
      } catch (closeError) {
        cleanupMessage = `; close failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`;
      }
      handle = undefined;
      try {
        await unlink(path);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          cleanupMessage += `; cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
        }
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ReplayCollectionError(
      `could not create replay sidecar without overwriting: ${message}${cleanupMessage}`,
    );
  } finally {
    await handle?.close();
  }
  return bytes;
}

async function main() {
  const [candidateDirectory, outputPath, ...extra] = process.argv.slice(2);
  if (!candidateDirectory || !outputPath || extra.length > 0) {
    throw new ReplayCollectionError(
      "usage: node collect-replay-observation.mjs CANDIDATE_DIRECTORY NEW_REPLAY_SIDECAR_PATH",
    );
  }
  const endpoint = process.env.FUSOU_REPLAY_OBSERVATION_ENDPOINT;
  const bearerToken = process.env.FUSOU_REPLAY_OBSERVATION_BEARER_TOKEN;
  if (!endpoint || !bearerToken) {
    throw new ReplayCollectionError(
      "FUSOU_REPLAY_OBSERVATION_ENDPOINT and FUSOU_REPLAY_OBSERVATION_BEARER_TOKEN are required",
    );
  }
  const material = await collectReplayObservation(candidateDirectory, endpoint, bearerToken);
  await writeReplayObservation(outputPath, material);
  console.log("Saved one matching HTTP 409 replay observation; no retry or origin request was made.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`replay observation collection failed: ${message}`);
    process.exitCode = 1;
  });
}
