import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attestationConsumeReceiptSigningBytes,
} from "../src/attestation_receipts.ts";
import { tlsnDeviceProofSigningBytes } from "../src/device-proof-framing.ts";
import {
  verificationObjectKey,
  verificationQueueMessageSchema,
} from "../src/verification_jobs.ts";
import {
  derive_verifier_result_signing_bytes,
  initSync as initVerifierWasm,
} from "../src/wasm/fusou_tlsn_verifier.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const runDirectory = process.env.FUSOU_LOCAL_TEST_RUN_DIR;
const sessionPath = process.env.FUSOU_LOCAL_SESSION_FILE;
const presentationPath = process.env.FUSOU_LOCAL_PRESENTATION_FILE;
const mode = process.argv[2] ?? "valid";

function sha256(bytes, encoding = "base64url") {
  return createHash("sha256").update(bytes).digest(encoding);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writePrivateFile(path, contents) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
}

function assertLoopbackUrl(value, label) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(`${label} must use a loopback host`);
  }
  return url;
}

async function adminPost(run, endpoint, message) {
  const token = (await readFile(join(run, "queue-admin-token"), "utf8")).trim();
  const response = await fetch(`http://127.0.0.1:19003/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
    redirect: "manual",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`local Queue ${endpoint} returned HTTP ${response.status}`);
  if (!body || typeof body !== "object") throw new Error(`local Queue ${endpoint} returned invalid JSON`);
  return { ...body, http_status: response.status };
}

async function waitForLeasedJob(run, message) {
  const deadline = Date.now() + 30_000;
  let inspection;
  while (Date.now() < deadline) {
    inspection = await adminPost(run, "inspect", message);
    const leaseExpiresAt = Date.parse(inspection.verification_lease_expires_at ?? "");
    if (inspection.status === "verifying" && Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now()) {
      return inspection;
    }
    if (["consumed", "failed", "expired"].includes(inspection.status)) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Queue consumer did not expose a live verification lease${inspection ? ` (state ${inspection.status})` : ""}`);
}

async function waitForQueueDrain(run, message, expectedStatus) {
  const deadline = Date.now() + 30_000;
  let inspection;
  while (Date.now() < deadline) {
    inspection = await adminPost(run, "inspect", message);
    if (inspection.status === expectedStatus && inspection.queue_backlog_count === 0) return inspection;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Queue did not drain for ${expectedStatus} job${inspection ? ` (state ${inspection.status}, backlog ${inspection.queue_backlog_count})` : ""}`);
}

async function statusRequest(config, identity, session, jobId, bindingId) {
  return fetch(`${config.worker_url}/verify/tlsn/status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${identity.access_token}`,
      apikey: config.supabase_anon_key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      job_id: jobId,
      session_id: session.session_id,
      binding_id: bindingId,
      canonical_user_id: identity.user_id,
      device_id: identity.device_id,
      profile: "complete",
    }),
    redirect: "manual",
  });
}

async function verifyPositiveResult(config, session, job, statusBytes, r2Bytes) {
  if (!statusBytes.equals(r2Bytes)) {
    throw new Error("status Result bytes differ from the exact R2 Result bytes");
  }
  const outer = JSON.parse(statusBytes.toString("utf8"));
  if (
    outer.verified !== true ||
    outer.signature_algorithm !== "Ed25519" ||
    outer.signer_key_id !== config.result_signer_key_id ||
    outer.result?.attestation_session_id !== job.session_id ||
    outer.result?.canonical_user_id !== job.canonical_user_id ||
    outer.result?.device_id !== job.device_id ||
    outer.result?.device_challenge !== session.device_challenge ||
    outer.result?.binding_value !== job.binding_value ||
    outer.result?.presentation_sha256 !== job.presentation_sha256 ||
    outer.result?.version !== 2 ||
    outer.result?.profile_id !== config.profile_id ||
    outer.result?.profile_sha256 !== config.profile_sha256 ||
    outer.result?.server_identity !== config.server_identity
  ) {
    throw new Error("Queue Result does not match the exact Session and Presentation");
  }
  const metadata = await readJson(config.presentation_metadata_file);
  if (
    outer.result.request_transcript_sha256 !== metadata.request_transcript_sha256 ||
    Number(outer.result.request_transcript_size) !== metadata.request_transcript_bytes ||
    outer.result.response_transcript_sha256 !== metadata.response_transcript_sha256 ||
    Number(outer.result.response_transcript_size) !== metadata.response_transcript_bytes
  ) {
    throw new Error("Queue Result transcript metadata differs from the independent Presentation fixture");
  }

  initVerifierWasm({
    module: new Uint8Array(await readFile(
      resolve(scriptDirectory, "../src/wasm/fusou_tlsn_verifier_bg.wasm"),
    )),
  });
  const resultPublicKey = createPublicKey({
    key: Buffer.from(config.result_public_key_spki, "base64url"),
    format: "der",
    type: "spki",
  });
  const signingBytes = derive_verifier_result_signing_bytes(JSON.stringify(outer.result));
  if (
    typeof outer.result.signature !== "string" ||
    !verify(
      null,
      Buffer.from(signingBytes),
      resultPublicKey,
      Buffer.from(outer.result.signature, "base64url"),
    )
  ) {
    throw new Error("Queue Result inner Ed25519 signature is invalid");
  }

  const receipt = outer.consume_receipt;
  const bindingAuthorityKey = createPublicKey({
    key: Buffer.from(config.binding_authority_public_key_spki, "base64url"),
    format: "der",
    type: "spki",
  });
  const receiptSigningBytes = attestationConsumeReceiptSigningBytes({
    signerKeyId: receipt.signer_key_id,
    sessionId: receipt.session_id,
    canonicalUserId: receipt.canonical_user_id,
    deviceId: receipt.device_id,
    nonce: receipt.nonce,
    bindingValue: receipt.binding_value,
    presentationId: receipt.presentation_id,
    usedAt: receipt.used_at,
  });
  if (
    receipt.type !== "attestation-binding-consumed" ||
    receipt.signer_key_id !== config.binding_authority_key_id ||
    receipt.session_id !== job.session_id ||
    receipt.canonical_user_id !== job.canonical_user_id ||
    receipt.device_id !== job.device_id ||
    receipt.presentation_id !== job.presentation_sha256 ||
    !verify(
      null,
      Buffer.from(receiptSigningBytes),
      bindingAuthorityKey,
      Buffer.from(receipt.signature, "base64url"),
    )
  ) {
    throw new Error("Queue consume receipt is not bound to this job or its trusted signer");
  }
}

async function run() {
  if (!runDirectory || !sessionPath || !presentationPath || !["valid", "corrupt", "uncertain"].includes(mode)) {
    throw new Error("run directory, fresh Session file, Presentation file, and valid|corrupt|uncertain mode are required");
  }
  const run = resolve(runDirectory);
  const config = await readJson(join(run, "local-test-config.json"));
  const identity = await readJson(config.identity_file);
  const session = await readJson(sessionPath);
  const triggerStateBefore = mode === "uncertain"
    ? await readJson(config.trigger_state_file)
    : null;
  assertLoopbackUrl(config.worker_url, "Worker URL");
  if (
    Date.parse(session.expires_at) <= Date.now() ||
    session.canonical_user_id !== identity.user_id ||
    session.device_id !== identity.device_id
  ) {
    throw new Error("a fresh Worker Session bound to the local Auth user and device is required");
  }
  const original = await readFile(presentationPath);
  const presentation = Buffer.from(original);
  if (mode === "corrupt") presentation[0] ^= 0x01;
  const presentationId = sha256(presentation);
  const challenge = Buffer.from(session.device_challenge, "base64url");
  const privateKey = createPrivateKey({
    key: Buffer.from(identity.device_private_key_pkcs8, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  const possessionBytes = tlsnDeviceProofSigningBytes({
    device_id: identity.device_id,
    session_id: session.session_id,
    binding_value: session.binding,
  }, challenge);
  const verificationPayload = {
    presentation_base64: presentation.toString("base64url"),
    session_id: session.session_id,
    binding: session.binding,
    device_id: identity.device_id,
    device_proof: {
      challenge: session.device_challenge,
      sig: sign(null, Buffer.from(possessionBytes), privateKey).toString("base64"),
    },
  };
  const request = await fetch(`${config.worker_url}/verify/tlsn`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${identity.access_token}`,
      apikey: config.supabase_anon_key,
      "Content-Type": "application/json",
      "X-FUSOU-TLSN-Response-Mode": "async",
    },
    body: JSON.stringify(verificationPayload),
    redirect: "manual",
  });
  const accepted = await request.json().catch(() => null);
  const uncertainSubmission = mode === "uncertain";
  if (
    (uncertainSubmission && (
      request.status !== 503 ||
      accepted?.error !== "queue_enqueue_unconfirmed" ||
      typeof accepted?.job_id !== "string"
    )) ||
    (!uncertainSubmission && (
      request.status !== 202 ||
      typeof accepted?.job_id !== "string"
    ))
  ) {
    throw new Error(`/verify/tlsn returned HTTP ${request.status}${accepted?.error ? ` (${accepted.error})` : ""}`);
  }
  const jobId = accepted.job_id;
  let submissionReplay = null;
  if (uncertainSubmission) {
    const replay = await fetch(`${config.worker_url}/verify/tlsn`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${identity.access_token}`,
        apikey: config.supabase_anon_key,
        "Content-Type": "application/json",
        "X-FUSOU-TLSN-Response-Mode": "async",
      },
      body: JSON.stringify(verificationPayload),
      redirect: "manual",
    });
    const replayBody = await replay.json().catch(() => null);
    if (
      replay.status === 202 ||
      (typeof replayBody?.job_id === "string" && replayBody.job_id !== jobId)
    ) {
      throw new Error("replaying the uncertain Queue submission created or returned a different job");
    }
    submissionReplay = {
      http_status: replay.status,
      error: replayBody?.error ?? null,
      same_job_id: replayBody?.job_id === jobId,
    };
  }
  const bindingId = sha256(Buffer.from(session.binding));
  const queueMessage = verificationQueueMessageSchema.parse({
    job_id: jobId,
    binding_id: bindingId,
    session_id: session.session_id,
    canonical_user_id: identity.user_id,
    device_id: identity.device_id,
    device_challenge: session.device_challenge,
    verification_input_source: "r2",
    verification_input_key: verificationObjectKey(jobId, "presentation"),
    verification_result_key: verificationObjectKey(jobId, "result"),
    origin_policy: "fixed",
    deployment_role: "test",
    profile: "complete",
    disclosure_mode: "full",
    message_type: "tlsn-verification-v1",
    presentation_id: presentationId,
  });
  const jobDirectory = join(config.jobs_directory, jobId);
  await mkdir(jobDirectory, { recursive: true, mode: 0o700 });
  const job = {
    schema_version: 1,
    mode,
    job_id: jobId,
    session_id: session.session_id,
    canonical_user_id: identity.user_id,
    device_id: identity.device_id,
    binding_value: session.binding,
    binding_id: bindingId,
    presentation_sha256: presentationId,
    presentation_bytes: presentation.length,
    verification_input_key: queueMessage.verification_input_key,
    verification_job_result_key: queueMessage.verification_result_key,
    initial_http_status: request.status,
    initial_response: accepted,
    submission_replay: submissionReplay,
  };
  await writePrivateFile(join(jobDirectory, "presentation.bin"), presentation);
  await writePrivateFile(join(jobDirectory, "job.json"), `${JSON.stringify(job)}\n`);

  const callbackProbe = await fetch(`${config.worker_url}/internal/tlsn/verification-complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-FUSOU-TLSN-Execution-Mode": "queue",
      "X-FUSOU-TLSN-Job-Id": jobId,
    },
    body: "{}",
    redirect: "manual",
  });
  if (callbackProbe.status !== 404) {
    throw new Error(`external completion callback was not isolated from Queue mode: HTTP ${callbackProbe.status}`);
  }

  const liveLease = await waitForLeasedJob(run, queueMessage);
  const inFlightDuplicate = await adminPost(run, "publish", queueMessage);
  if (
    inFlightDuplicate?.accepted !== true ||
    inFlightDuplicate.job_id !== jobId ||
    inFlightDuplicate.http_status !== 202
  ) {
    throw new Error("local Queue did not accept the same-job delivery while a live lease was observed");
  }
  const mismatchedJobId = randomUUID();
  const mismatchCases = [
    {
      name: "production-role-and-runtime-trust",
      message: {
        ...queueMessage,
        deployment_role: "production",
        origin_policy: "inventory",
        origin_inventory_sha256: "c".repeat(43),
        target_approval_artifact_sha256: "d".repeat(43),
        security_registry_set_sha256: "e".repeat(43),
      },
    },
    {
      name: "origin-policy-schema",
      raw: true,
      message: { ...queueMessage, origin_policy: "inventory" },
    },
    {
      name: "job-id",
      message: {
        ...queueMessage,
        job_id: mismatchedJobId,
        verification_input_key: verificationObjectKey(mismatchedJobId, "presentation"),
        verification_result_key: verificationObjectKey(mismatchedJobId, "result"),
      },
    },
    {
      name: "session-id",
      message: { ...queueMessage, session_id: randomUUID() },
    },
    {
      name: "presentation-digest",
      message: { ...queueMessage, presentation_id: sha256(Buffer.from(randomUUID())) },
    },
    {
      name: "input-key",
      message: {
        ...queueMessage,
        verification_input_key: verificationObjectKey(jobId, "result"),
      },
    },
    {
      name: "binding-id",
      message: { ...queueMessage, binding_id: "A".repeat(43) },
    },
  ];
  const mismatchRejections = [];
  for (const mismatch of mismatchCases) {
    const dispatched = await adminPost(
      run,
      mismatch.raw ? "dispatch-raw" : "dispatch-concurrent",
      mismatch.message,
    );
    const currentJob = await adminPost(run, "inspect", queueMessage);
    const currentLease = Date.parse(currentJob.verification_lease_expires_at ?? "");
    if (
      dispatched.disposition !== "ack" ||
      currentJob.status !== "verifying" ||
      !Number.isFinite(currentLease) ||
      currentLease <= Date.now()
    ) {
      throw new Error(`Queue ${mismatch.name} mismatch changed or failed the legitimate active job`);
    }
    mismatchRejections.push(mismatch.name);
  }
  const concurrentDuplicate = await adminPost(run, "dispatch-concurrent", queueMessage);
  const afterConcurrentDuplicate = await adminPost(run, "inspect", queueMessage);
  const leaseExpiresAfterConcurrent = Date.parse(
    afterConcurrentDuplicate.verification_lease_expires_at ?? "",
  );
  if (
    concurrentDuplicate.disposition !== "ack" ||
    liveLease.status !== "verifying" ||
    afterConcurrentDuplicate.status !== "verifying" ||
    !Number.isFinite(leaseExpiresAfterConcurrent) ||
    leaseExpiresAfterConcurrent <= Date.now()
  ) {
    throw new Error("the concurrent real consumer did not observe and preserve the active DO lease");
  }

  const deadline = Date.now() + 120_000;
  let finalStatus;
  let finalBytes;
  let finalBody;
  while (Date.now() < deadline) {
    const status = await statusRequest(config, identity, session, jobId, bindingId);
    finalBytes = Buffer.from(await status.arrayBuffer());
    try {
      finalBody = JSON.parse(finalBytes.toString("utf8"));
    } catch {
      finalBody = null;
    }
    finalStatus = status.status;
    if (finalStatus === 200 && (finalBody?.verified === true || finalBody?.status === "not_verified")) break;
    if (finalStatus !== 202) {
      throw new Error(`Worker status returned unexpected HTTP ${finalStatus}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  if (finalStatus !== 200 || !finalBody) throw new Error("Queue job did not reach a terminal status");
  await writePrivateFile(join(jobDirectory, "status-response.bin"), finalBytes);

  let inspection;
  const inspectDeadline = Date.now() + 30_000;
  while (Date.now() < inspectDeadline) {
    inspection = await adminPost(run, "inspect", queueMessage);
    if (
      inspection?.status === "consumed" ||
      inspection?.status === "failed" ||
      inspection?.status === "expired"
    ) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  if (!inspection || !["consumed", "failed", "expired"].includes(inspection.status)) {
    throw new Error("Queue DO state did not reach a terminal status");
  }
  inspection = await waitForQueueDrain(run, queueMessage, inspection.status);

  let committedDuplicate;
  let committedConsumerReplay;
  if (mode === "valid" || mode === "uncertain") {
    if (finalBody.verified !== true || inspection.status !== "consumed") {
      throw new Error("valid Complete Presentation did not produce a consumed signed Result");
    }
    if (typeof inspection.result_bytes_base64 !== "string") {
      throw new Error("the committed exact Result bytes are absent from local R2");
    }
    const r2Bytes = Buffer.from(inspection.result_bytes_base64, "base64");
    if (
      sha256(r2Bytes) !== inspection.result_sha256 ||
      sha256(r2Bytes, "hex") !== inspection.result_bytes_sha256
    ) {
      throw new Error("DO Result digest does not match the exact R2 bytes");
    }
    await writePrivateFile(join(jobDirectory, "result-from-r2.bin"), r2Bytes);
    await verifyPositiveResult(config, session, job, finalBytes, r2Bytes);
    job.verification_attempt_id = inspection.verification_attempt_id;
    job.verification_attempt_result_key = inspection.result_object_key;
    await writePrivateFile(join(jobDirectory, "job.json"), `${JSON.stringify(job)}\n`);
    const beforeDuplicateReplay = JSON.stringify({
      result_sha256: inspection.result_sha256,
      result_object_key: inspection.result_object_key,
      objects: inspection.job_verification_objects,
      r2_bytes_sha256: inspection.result_bytes_sha256,
    });
    committedDuplicate = await adminPost(run, "publish", queueMessage);
    if (committedDuplicate.accepted !== true || committedDuplicate.http_status !== 202) {
      throw new Error("local Queue did not accept the committed same-job redelivery");
    }
    committedConsumerReplay = await adminPost(run, "dispatch-concurrent", queueMessage);
    if (committedConsumerReplay.disposition !== "ack") {
      throw new Error("the real consumer did not acknowledge the already-consumed job");
    }
    const afterDuplicateReplay = await waitForQueueDrain(run, queueMessage, "consumed");
    const afterSnapshot = JSON.stringify({
      result_sha256: afterDuplicateReplay.result_sha256,
      result_object_key: afterDuplicateReplay.result_object_key,
      objects: afterDuplicateReplay.job_verification_objects,
      r2_bytes_sha256: afterDuplicateReplay.result_bytes_sha256,
    });
    if (
      afterDuplicateReplay.status !== "consumed" ||
      afterDuplicateReplay.queue_backlog_count !== 0 ||
      beforeDuplicateReplay !== afterSnapshot
    ) {
      throw new Error("same-job redelivery changed the committed Result or R2 objects");
    }
  } else if (
    finalBody.verified !== false ||
    finalBody.status !== "not_verified" ||
    inspection.status !== "failed" ||
    inspection.result_bytes_base64 !== null ||
    inspection.job_verification_objects.includes(queueMessage.verification_result_key)
  ) {
    throw new Error("corrupted Presentation was not rejected without a signed Result or archive");
  }
  const triggerStateUnchanged = uncertainSubmission
    ? JSON.stringify(await readJson(config.trigger_state_file)) === JSON.stringify(triggerStateBefore)
    : null;
  if (uncertainSubmission && !triggerStateUnchanged) {
    throw new Error("uncertain Queue submission changed local Trigger executor state");
  }

  console.log(JSON.stringify({
    mode,
    job_id: jobId,
    session_id: session.session_id,
    initial_status: request.status,
    initial_error: accepted?.error ?? null,
    submission_replay: submissionReplay,
    trigger_executor_state_unchanged: triggerStateUnchanged,
    in_flight_duplicate_publish_http_status: inFlightDuplicate.http_status,
    in_flight_duplicate_queue_accepted: inFlightDuplicate.accepted,
    concurrent_consumer_disposition: concurrentDuplicate.disposition,
    live_lease_preserved: afterConcurrentDuplicate.status === "verifying",
    mismatch_rejections_during_active_lease: mismatchRejections,
    active_lease_preserved_after_mismatches: mismatchRejections.length === mismatchCases.length,
    committed_duplicate_publish_http_status: mode !== "corrupt" ? committedDuplicate.http_status : null,
    committed_consumer_replay_disposition: mode !== "corrupt" ? committedConsumerReplay.disposition : null,
    external_completion_callback_status: callbackProbe.status,
    final_status: finalStatus,
    verified: finalBody.verified === true,
    durable_object_status: inspection.status,
    presentation_sha256: presentationId,
    result_sha256: inspection.result_sha256 ?? null,
    result_bytes_equal_status_and_r2: mode !== "corrupt",
    result_signature_verified: mode !== "corrupt",
    consume_receipt_verified: mode !== "corrupt",
    duplicate_redelivery_idempotent: mode !== "corrupt",
    result_archive_absent: !inspection.job_verification_objects.includes(queueMessage.verification_result_key),
    presentation_input_retained: inspection.job_verification_objects.includes(queueMessage.verification_input_key),
    queue_consumer_terminal_state_observed: ["consumed", "failed"].includes(inspection.status),
    job_verification_objects: inspection.job_verification_objects,
    queue_backlog_count: inspection.queue_backlog_count,
  }));
}

try {
  await run();
} catch (error) {
  console.error(JSON.stringify({
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  }));
  process.exitCode = 1;
}
