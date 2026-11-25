import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { verificationQueueMessageSchema } from "../../FUSOU-TLSN-VERIFICATION-WORKER/src/verification_jobs.ts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const workerRoot = join(repositoryRoot, "packages/FUSOU-TLSN-VERIFICATION-WORKER");
const workerName = "fusou-tlsn-local-queue-test";
const queueName = "fusou-tlsn-local-queue-test";
const queueDispatcherName = "fusou-tlsn-local-queue-dispatch-test";
const adminTokenFileName = "queue-admin-token";

function parseEnvFile(raw) {
  const entries = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) throw new Error("local Worker environment file is malformed");
    entries[line.slice(0, equals)] = line.slice(equals + 1).replace(/^['"]|['"]$/g, "");
  }
  return entries;
}

function loopbackOrigin(value, label) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(`${label} must use a loopback host`);
  }
  return url.origin;
}

async function fetchLocalWorkerDependency(request, allowedOrigins) {
  const url = new URL(request.url);
  if (!allowedOrigins.has(url.origin)) {
    console.log(JSON.stringify({ event: "local-queue-outbound-blocked", path: url.pathname }));
    return new Response("local Queue test outbound request blocked", { status: 502 });
  }
  try {
    const headers = new Headers();
    request.headers.forEach((value, name) => headers.append(name, value));
    const init = {
      method: request.method,
      headers,
      redirect: request.redirect,
    };
    if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
      init.body = new Uint8Array(await request.arrayBuffer());
    }
    const response = await fetch(url.href, init);
    console.log(JSON.stringify({
      event: "local-queue-outbound",
      path: url.pathname,
      status: response.status,
    }));
    return response;
  } catch (error) {
    console.error(JSON.stringify({
      event: "local-queue-outbound-error",
      path: url.pathname,
      error: error instanceof Error ? error.message : "unknown",
    }));
    throw error;
  }
}

async function writePrivateFile(path, contents) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function readRequestBody(request, maximumBytes = 64 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBytes) throw new Error("request body exceeds local harness limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function authorized(request, token) {
  const actual = Buffer.from((request.headers.authorization ?? "").replace(/^Bearer /, ""));
  const expected = Buffer.from(token);
  return request.headers.authorization?.startsWith("Bearer ")
    && actual.length === expected.length
    && timingSafeEqual(actual, expected);
}

async function startRuntime(runDirectory) {
  const configPath = join(runDirectory, "local-test-config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (config?.schema_version !== 1) throw new Error("local test configuration is absent or invalid");
  const workerEnv = parseEnvFile(await readFile(join(runDirectory, "worker.env"), "utf8"));
  if (
    workerEnv.TLSN_ENVIRONMENT !== "test" ||
    workerEnv.TLSN_DEPLOYMENT_ROLE !== "test" ||
    !["127.0.0.1", "localhost"].includes(new URL(config.worker_url).hostname)
  ) {
    throw new Error("Queue harness accepts only the local test-role Worker");
  }
  const allowedOrigins = new Set([
    loopbackOrigin(workerEnv.TLSN_SUPABASE_URL, "Supabase URL"),
    loopbackOrigin(workerEnv.TLSN_DEVICE_AUTH_URL, "device-auth URL"),
    loopbackOrigin(workerEnv.TLSN_DEVICE_POSSESSION_AUTH_URL, "device-possession URL"),
  ]);
  const workerUrl = new URL(config.worker_url);
  const workerPort = Number(workerUrl.port || (workerUrl.protocol === "https:" ? 443 : 80));
  if (workerUrl.protocol !== "http:" || workerPort < 1 || workerPort > 65535) {
    throw new Error("local Worker URL must use an explicit loopback HTTP endpoint");
  }

  const runtimeRoot = join(runDirectory, "queue-runtime");
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const bundlePath = join(runtimeRoot, "worker.mjs");
  const dispatcherSourcePath = join(runtimeRoot, "queue-dispatcher-entry.mjs");
  const dispatcherPath = join(runtimeRoot, "queue-dispatcher.mjs");
  const dispatcherToken = randomBytes(32).toString("base64url");
  await writePrivateFile(dispatcherSourcePath, [
    'import worker from "./worker.mjs";',
    "export default {",
    "  async fetch(request, env, ctx) {",
    '    if (request.headers.get("authorization") !== `Bearer ${env.TLSN_QUEUE_TEST_DISPATCH_TOKEN}`) {',
    '      return new Response("unauthorized", { status: 401 });',
    "    }",
    "    const input = await request.json();",
    '    if (!input.message || typeof input.message !== "object" || input.attempts !== 1) {',
    '      return Response.json({ error: "invalid test delivery" }, { status: 400 });',
    "    }",
    '    let disposition = "unobserved";',
    "    let retryDelaySeconds = null;",
    "    const message = {",
    "      body: input.message,",
    "      id: crypto.randomUUID(),",
    "      timestamp: new Date(),",
    "      attempts: input.attempts,",
    '      ack() { disposition = "ack"; },',
    '      retry(options = {}) { disposition = "retry"; retryDelaySeconds = options.delaySeconds ?? null; },',
    "    };",
    "    if (typeof worker.queue !== \"function\") throw new Error(\"Worker queue handler is unavailable\");",
    `    await worker.queue({ queue: ${JSON.stringify(queueName)}, messages: [message] }, env, ctx);`,
    "    return Response.json({ disposition, retry_delay_seconds: retryDelaySeconds });",
    "  },",
    "};",
    "",
  ].join("\n"));
  await build({
    entryPoints: [join(workerRoot, "src/index.ts")],
    outfile: bundlePath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers", "./wasm/fusou_tlsn_verifier_bg.wasm"],
    loader: { ".txt": "text" },
    logLevel: "silent",
  });
  await build({
    entryPoints: [dispatcherSourcePath],
    outfile: dispatcherPath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers", "./wasm/fusou_tlsn_verifier_bg.wasm"],
    logLevel: "silent",
  });
  const compiledWasmModule = {
    type: "CompiledWasm",
    path: "wasm/fusou_tlsn_verifier_bg.wasm",
    contents: await readFile(join(workerRoot, "src/wasm/fusou_tlsn_verifier_bg.wasm")),
  };
  const workerModules = [
    { type: "ESModule", path: bundlePath, contents: await readFile(bundlePath, "utf8") },
    compiledWasmModule,
  ];
  const dispatcherModules = [
    { type: "ESModule", path: dispatcherPath, contents: await readFile(dispatcherPath, "utf8") },
    compiledWasmModule,
  ];

  const bindings = {
    ...workerEnv,
    TLSN_EXECUTION_MODE: "queue",
    TLSN_TEST_COMPLETION_DELAY_MS: "5000",
  };
  if (process.env.FUSOU_LOCAL_QUEUE_SEND_ACK_LOST_AFTER_ACCEPTANCE === "true") {
    bindings.TLSN_TEST_QUEUE_SEND_ACK_LOST_AFTER_ACCEPTANCE = "true";
  }
  delete bindings.TLSN_TRIGGER_API_URL;
  delete bindings.TLSN_TRIGGER_TASK_ID;
  delete bindings.TLSN_TRIGGER_SECRET_KEY;
  delete bindings.TLSN_TRIGGER_CALLBACK_SECRET;
  const options = convertV4MiniflareOptions({
    rootPath: runtimeRoot,
    host: "127.0.0.1",
    port: workerPort,
    resourcePersistencePath: join(runtimeRoot, "persistent"),
    isolatedResourcePersistencePath: join(runtimeRoot, "isolated"),
    resourceTmpPath: join(runtimeRoot, "resource-tmp"),
    telemetry: { enabled: false },
    workers: [{
      name: workerName,
      rootPath: runtimeRoot,
      modules: workerModules,
      modulesRoot: runtimeRoot,
      compatibilityDate: "2026-09-07",
      compatibilityFlags: ["nodejs_compat"],
      bindings,
      unsafeEphemeralDurableObjects: false,
      durableObjects: {
        TLSN_BINDINGS: {
          className: "TlsnBindingAuthorityDurableObject",
          scriptName: workerName,
          unsafeUniqueKey: "fusou-tlsn-local-queue-test-v1",
          useSQLite: true,
        },
      },
      r2Buckets: { TLSN_PRESENTATIONS: config.r2_bucket_name },
      queueProducers: { TLSN_VERIFICATION_QUEUE: queueName },
      queueConsumers: {
        [queueName]: {
          maxBatchSize: 1,
          maxBatchTimeout: 1,
          maxRetries: 10,
        },
      },
      serviceBindings: {
        TLSN_LOCAL_QUEUE_TEST_DISPATCHER: { name: queueDispatcherName },
      },
      outboundService: (request) => fetchLocalWorkerDependency(request, allowedOrigins),
    }, {
      name: queueDispatcherName,
      rootPath: runtimeRoot,
      modules: dispatcherModules,
      modulesRoot: runtimeRoot,
      compatibilityDate: "2026-09-07",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        ...bindings,
        TLSN_QUEUE_TEST_DISPATCH_TOKEN: dispatcherToken,
      },
      durableObjects: {
        TLSN_BINDINGS: {
          className: "TlsnBindingAuthorityDurableObject",
          scriptName: workerName,
        },
      },
      r2Buckets: { TLSN_PRESENTATIONS: config.r2_bucket_name },
      outboundService: (request) => fetchLocalWorkerDependency(request, allowedOrigins),
    }],
  });
  const miniflare = new Miniflare(options);
  await miniflare.ready;
  await writePrivateFile(join(runDirectory, "queue-dispatch-token"), `${dispatcherToken}\n`);
  return { config, miniflare, dispatcherToken };
}

async function startAdminServer(runDirectory, runtime) {
  const token = randomBytes(32).toString("base64url");
  await writePrivateFile(join(runDirectory, adminTokenFileName), `${token}\n`);
  const queue = await runtime.miniflare.getQueueProducer("TLSN_VERIFICATION_QUEUE", workerName);
  const namespace = await runtime.miniflare.getDurableObjectNamespace("TLSN_BINDINGS", workerName);
  const bucket = await runtime.miniflare.getR2Bucket("TLSN_PRESENTATIONS", workerName);
  const bindings = await runtime.miniflare.getBindings(workerName);
  const dispatcher = bindings.TLSN_LOCAL_QUEUE_TEST_DISPATCHER;
  const server = http.createServer((request, response) => {
    void (async () => {
      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, execution_mode: "queue", queue: queueName }));
        return;
      }
      if (!authorized(request, token)) {
        response.writeHead(401).end();
        return;
      }
      const body = JSON.parse(await readRequestBody(request));
      if (request.method === "POST" && request.url === "/dispatch-raw") {
        if (!body.message || typeof body.message !== "object" || Array.isArray(body.message)) {
          response.writeHead(400).end();
          return;
        }
        const dispatched = await dispatcher.fetch("http://local-queue-dispatch/dispatch", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${runtime.dispatcherToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: body.message, attempts: 1 }),
        });
        const dispatchedBody = await dispatched.json();
        response.writeHead(dispatched.status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(dispatchedBody));
        return;
      }
      const parsed = verificationQueueMessageSchema.safeParse(body.message);
      if (!parsed.success) {
        response.writeHead(400).end();
        return;
      }
      if (request.method === "POST" && request.url === "/publish") {
        await queue.send(parsed.data);
        response.writeHead(202, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ accepted: true, job_id: parsed.data.job_id }));
        return;
      }
      if (request.method === "POST" && request.url === "/dispatch-concurrent") {
        const dispatched = await dispatcher.fetch("http://local-queue-dispatch/dispatch", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${runtime.dispatcherToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: parsed.data, attempts: 1 }),
        });
        const dispatchedBody = await dispatched.json();
        response.writeHead(dispatched.status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(dispatchedBody));
        return;
      }
      if (request.method === "POST" && request.url === "/inspect") {
        const authorityResponse = await namespace.getByName(parsed.data.binding_id).fetch(
          "https://binding.internal/job",
          {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
          session_id: parsed.data.session_id,
          canonical_user_id: parsed.data.canonical_user_id,
          device_id: parsed.data.device_id,
          verification_job_id: parsed.data.job_id,
          now: Date.now(),
          }),
          },
        );
        const authorityBody = await authorityResponse.json();
        if (!authorityResponse.ok || authorityBody?.ok !== true) {
          throw new Error("Durable Object verification job lookup failed");
        }
        const record = authorityBody.record;
        const objects = await bucket.list({ prefix: "tlsn-verification/", limit: 1000 });
        const jobObjectPrefixes = [
          `tlsn-verification/${parsed.data.job_id}/`,
          ...(record.verification_attempt_id
            ? [`tlsn-verification/${record.verification_attempt_id}/`]
            : []),
        ];
        const resultObject = record.result_object_key
          ? await bucket.get(record.result_object_key)
          : null;
        const resultBytes = resultObject
          ? Buffer.from(await resultObject.arrayBuffer())
          : null;
        const metrics = await queue.metrics();
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          job_id: parsed.data.job_id,
          status: record.status,
          verification_failure_code: record.verification_failure_code ?? null,
          verification_attempt_id: record.verification_attempt_id ?? null,
          verification_lease_expires_at: record.verification_lease_expires_at ?? null,
          presentation_id: record.presentation_id ?? null,
          result_sha256: record.result_sha256 ?? null,
          result_object_key: record.result_object_key ?? null,
          result_bytes_base64: resultBytes?.toString("base64") ?? null,
          result_bytes_sha256: resultBytes
            ? createHash("sha256").update(resultBytes).digest("hex")
            : null,
          job_verification_objects: objects.objects
            .map((object) => object.key)
            .filter((key) => jobObjectPrefixes.some((prefix) => key.startsWith(prefix))),
          queue_backlog_count: metrics.backlogCount,
        }));
        return;
      }
      response.writeHead(404).end();
    })().catch((error) => {
      console.error("Local Queue harness request failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(19003, "127.0.0.1", resolveListen);
  });
  return { server, token };
}

async function serve() {
  const runDirectory = process.env.FUSOU_LOCAL_TEST_RUN_DIR;
  if (!runDirectory) throw new Error("FUSOU_LOCAL_TEST_RUN_DIR is required");
  const resolvedRunDirectory = resolve(runDirectory);
  const runtime = await startRuntime(resolvedRunDirectory);
  const admin = await startAdminServer(resolvedRunDirectory, runtime);
  console.log(JSON.stringify({
    event: "local-queue-worker-ready",
    worker_url: runtime.config.worker_url,
    admin_url: "http://127.0.0.1:19003",
    execution_mode: "queue",
    outbound_origins: "loopback-only",
  }));
  await new Promise((resolveClose) => {
    const close = async () => {
      await new Promise((resolveServer) => admin.server.close(resolveServer));
      await runtime.miniflare.dispose();
      resolveClose();
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

const [command] = process.argv.slice(2);
if (command === "serve") {
  await serve();
} else {
  console.error(`Usage: node --experimental-strip-types ${fileURLToPath(import.meta.url)} serve`);
  process.exitCode = 2;
}
