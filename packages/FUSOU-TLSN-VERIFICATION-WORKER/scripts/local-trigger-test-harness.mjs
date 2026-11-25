import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
import {
  internalRequestSignature,
  verificationCallbackSchema,
  verificationInputRequestSchema,
  verificationTaskPayloadSchema,
  verificationAttemptArchiveKeys,
} from "../src/verification_jobs.ts";

const taskId = "tlsn-local-verify";
const triggerPath = `/api/v1/tasks/${taskId}/trigger`;
const workerUrl = process.env.FUSOU_LOCAL_WORKER_URL ?? "http://127.0.0.1:8787";
const host = process.env.FUSOU_LOCAL_TRIGGER_HOST ?? "127.0.0.1";
const port = Number(process.env.FUSOU_LOCAL_TRIGGER_PORT ?? "19002");
const expectationPath = process.env.FUSOU_LOCAL_TRIGGER_EXPECTATIONS;
const statePath = process.env.FUSOU_LOCAL_TRIGGER_STATE;
const triggerSecret = process.env.FUSOU_LOCAL_TRIGGER_SECRET;
const callbackSecret = process.env.FUSOU_LOCAL_CALLBACK_SECRET;
const claimedJobs = new Set();

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function equalSecret(actual, expected) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(path, fallback) {
  if (!path) throw new Error("local harness state path is required");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function persistState(state) {
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, statePath);
}

async function readRequestBody(request, maximumBytes = 1_048_576) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBytes) throw new Error("request body exceeds local harness limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function mutateSignature(signature) {
  const replacement = signature[0] === "A" ? "B" : "A";
  return `${replacement}${signature.slice(1)}`;
}

async function signedPost(url, jobId, body, secret) {
  const signature = await internalRequestSignature(secret, jobId, body);
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-FUSOU-TLSN-Job-Id": jobId,
      "X-FUSOU-TLSN-Signature": signature,
    },
    body,
    redirect: "manual",
  });
}

async function processJob(jobId, payload, expectation, state) {
  const record = state.jobs[jobId];
  try {
    record.input_request_count = (record.input_request_count ?? 0) + 1;
    await persistState(state);
    const inputRequest = verificationInputRequestSchema.parse({
      job_id: payload.job_id,
      binding_id: payload.binding_id,
      session_id: payload.session_id,
      canonical_user_id: payload.canonical_user_id,
      device_id: payload.device_id,
      verification_input_source: "r2",
      verification_input_key: payload.verification_input_key,
    });
    const inputBody = JSON.stringify(inputRequest);
    const inputResponse = await signedPost(
      `${workerUrl}/internal/tlsn/verification-input`,
      jobId,
      inputBody,
      callbackSecret,
    );
    if (!inputResponse.ok) {
      record.stage = "input-rejected";
      record.input_status = inputResponse.status;
      await persistState(state);
      return;
    }

    const inputBytes = new Uint8Array(await inputResponse.arrayBuffer());
    const inputDigest = digest(inputBytes);
    record.stage = "input-fetched";
    record.input_sha256 = inputDigest;
    record.input_bytes = inputBytes.length;
    if (inputDigest !== expectation.sha256 || inputBytes.length !== expectation.bytes) {
      record.stage = "input-mismatch";
      await persistState(state);
      return;
    }
    const verificationAttemptId = randomUUID();
    record.verification_attempt_id = verificationAttemptId;
    record.verification_attempt_result_key = verificationAttemptArchiveKeys(verificationAttemptId).result;
    await persistState(state);

    const callback = verificationCallbackSchema.parse({
      job_id: payload.job_id,
      binding_id: payload.binding_id,
      session_id: payload.session_id,
      canonical_user_id: payload.canonical_user_id,
      device_id: payload.device_id,
      presentation_id: inputDigest,
      profile: payload.profile,
      disclosure_mode: payload.disclosure_mode,
      verification_attempt_id: verificationAttemptId,
      verification_status: "verified",
    });
    const callbackBody = JSON.stringify(callback);
    const validSignature = await internalRequestSignature(callbackSecret, jobId, callbackBody);
    const callbackSignature = expectation.completion === "invalid-hmac"
      ? mutateSignature(validSignature)
      : validSignature;
    record.callback_body = callbackBody;
    record.callback_signature = callbackSignature;
    record.completion_request_count = (record.completion_request_count ?? 0) + 1;
    record.stage = "completion-sent";
    await persistState(state);

    const callbackResponse = await fetch(`${workerUrl}/internal/tlsn/verification-complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FUSOU-TLSN-Job-Id": jobId,
        "X-FUSOU-TLSN-Signature": callbackSignature,
      },
      body: callbackBody,
      redirect: "manual",
    });
    const responseText = await callbackResponse.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }
    record.stage = "completion-returned";
    record.callback_status = callbackResponse.status;
    record.callback_error = typeof responseJson?.error === "string" ? responseJson.error : null;
    record.callback_verified = responseJson?.verified === true;
    await persistState(state);
  } catch (error) {
    record.stage = "executor-error";
    record.error_name = error instanceof Error ? error.name : "unknown";
    await persistState(state);
    console.error(JSON.stringify({
      event: "local-trigger-job-failed",
      job_id: jobId,
      stage: record.stage,
      error_name: record.error_name,
    }));
  }
}

async function handleTrigger(request, response, state) {
  if (request.method !== "POST" || request.url !== triggerPath) {
    response.writeHead(404).end();
    return;
  }
  const authorization = request.headers.authorization ?? "";
  if (!authorization.startsWith("Bearer ") ||
      !equalSecret(authorization.slice(7), triggerSecret)) {
    response.writeHead(401).end();
    return;
  }

  let wrapper;
  let payload;
  try {
    wrapper = JSON.parse(await readRequestBody(request));
    payload = verificationTaskPayloadSchema.parse(wrapper.payload);
  } catch {
    response.writeHead(400).end();
    return;
  }
  if (
    wrapper.options?.idempotencyKey !== payload.job_id ||
    payload.deployment_role !== "test" ||
    payload.origin_policy !== "fixed" ||
    (payload.verification_input_source ?? "r2") !== "r2" ||
    !payload.verification_input_key
  ) {
    response.writeHead(400).end();
    return;
  }
  if (Object.hasOwn(state.jobs, payload.job_id) || claimedJobs.has(payload.job_id)) {
    response.writeHead(409).end();
    return;
  }
  claimedJobs.add(payload.job_id);

  let expectations;
  try {
    expectations = await readJson(expectationPath, {});
  } catch (error) {
    claimedJobs.delete(payload.job_id);
    throw error;
  }
  const expectation = expectations[payload.session_id];
  if (
    !expectation ||
    !/^[A-Za-z0-9_-]{43}$/.test(expectation.sha256) ||
    !Number.isSafeInteger(expectation.bytes) ||
    !["valid", "invalid-hmac"].includes(expectation.completion)
  ) {
    claimedJobs.delete(payload.job_id);
    response.writeHead(409).end();
    return;
  }
  state.jobs[payload.job_id] = {
    stage: "accepted",
    execution_count: 1,
    trigger_payload: payload,
    session_id: payload.session_id,
    binding_id: payload.binding_id,
    verification_input_key: payload.verification_input_key,
    verification_result_key: payload.verification_result_key,
    expected_input_sha256: expectation.sha256,
    completion: expectation.completion,
  };
  try {
    await persistState(state);
  } catch (error) {
    delete state.jobs[payload.job_id];
    claimedJobs.delete(payload.job_id);
    throw error;
  }
  response.writeHead(202, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ id: `local-${payload.job_id}`, status: "accepted" }));
  void processJob(payload.job_id, payload, expectation, state);
}

async function startServer() {
  if (
    !expectationPath ||
    !statePath ||
    !triggerSecret ||
    !callbackSecret ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    new URL(workerUrl).hostname !== "127.0.0.1"
  ) {
    throw new Error("local Trigger harness requires loopback URLs and private state paths");
  }
  const state = await readJson(statePath, { schema_version: 1, jobs: {} });
  if (state.schema_version !== 1 || typeof state.jobs !== "object" || Array.isArray(state.jobs)) {
    throw new Error("local Trigger harness state is invalid");
  }
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, task_id: taskId }));
      return;
    }
    void handleTrigger(request, response, state).catch((error) => {
      console.error(JSON.stringify({
        event: "local-trigger-request-failed",
        error_name: error instanceof Error ? error.name : "unknown",
      }));
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  console.log(JSON.stringify({ event: "local-trigger-ready", host, port, task_id: taskId }));
  const close = () => server.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

async function replayCompletion(jobId) {
  if (!workerUrl || !statePath) throw new Error("local replay configuration is missing");
  const state = await readJson(statePath, null);
  const record = state?.jobs?.[jobId];
  if (!record?.callback_body || !record?.callback_signature) {
    throw new Error("job has no captured completion request");
  }
  const response = await fetch(`${workerUrl}/internal/tlsn/verification-complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-FUSOU-TLSN-Job-Id": jobId,
      "X-FUSOU-TLSN-Signature": record.callback_signature,
    },
    body: record.callback_body,
    redirect: "manual",
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  console.log(JSON.stringify({
    job_id: jobId,
    status: response.status,
    completion_accepted: body?.accepted === true,
    error: typeof body?.error === "string" ? body.error : null,
  }));
  if (response.status !== 200 || body?.accepted !== true) process.exitCode = 1;
}

async function replayTrigger(jobId) {
  const state = await readJson(statePath, null);
  const record = state?.jobs?.[jobId];
  if (!record?.trigger_payload) throw new Error("job has no captured Trigger payload");
  const before = JSON.stringify(record);
  const response = await fetch(`http://${host}:${port}${triggerPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${triggerSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payload: record.trigger_payload,
      options: { idempotencyKey: jobId },
    }),
    redirect: "manual",
  });
  const afterState = await readJson(statePath, null);
  const afterRecord = afterState?.jobs?.[jobId];
  const stateUnchanged = JSON.stringify(afterRecord) === before;
  console.log(JSON.stringify({
    job_id: jobId,
    status: response.status,
    duplicate_rejected: response.status === 409,
    state_unchanged: stateUnchanged,
    execution_count: afterRecord?.execution_count ?? null,
    input_request_count: afterRecord?.input_request_count ?? null,
    completion_request_count: afterRecord?.completion_request_count ?? null,
  }));
  if (response.status !== 409 || !stateUnchanged) process.exitCode = 1;
}

async function showEvents() {
  const state = await readJson(statePath, { jobs: {} });
  const jobs = Object.entries(state.jobs).map(([job_id, record]) => ({
    job_id,
    stage: record.stage,
    session_id: record.session_id,
    input_sha256: record.input_sha256 ?? null,
    input_bytes: record.input_bytes ?? null,
    callback_status: record.callback_status ?? null,
    callback_error: record.callback_error ?? null,
    verification_attempt_id: record.verification_attempt_id ?? null,
    verification_attempt_result_key: record.verification_attempt_result_key ?? null,
    execution_count: record.execution_count ?? null,
    input_request_count: record.input_request_count ?? null,
    completion_request_count: record.completion_request_count ?? null,
  }));
  console.log(JSON.stringify({ jobs }, null, 2));
}

const [command, argument] = process.argv.slice(2);
if (command === "serve") {
  await startServer();
} else if (command === "replay-completion" && argument) {
  await replayCompletion(argument);
} else if (command === "replay-trigger" && argument) {
  await replayTrigger(argument);
} else if (command === "events") {
  await showEvents();
} else {
  console.error(`Usage: node --experimental-strip-types ${fileURLToPath(import.meta.url)} <serve|events|replay-trigger JOB_ID|replay-completion JOB_ID>`);
  process.exitCode = 2;
}
