import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { connect as createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const MIGRATIONS_PATH = resolve(PACKAGE_ROOT, "supabase/migrations");
const BOOTSTRAP_SQL = resolve(PACKAGE_ROOT, "supabase/tlsn-testplay/legacy-user-member-map.sql");
const SUPABASE_VERSION = "3.2.0";
const WORKDIR_PREFIX = "fusou-tlsn-testplay-supabase-";
const OWNER_FILE = ".fusou-tlsn-testplay-owner.json";
const PREFIX_VERSION = "20260417183000";
const RELAY_IMAGE = "node:22.16.0-bookworm";
const RELAY_PROBE_PORT = 19437;
const OWNER_LABEL = "org.fusou.tlsn.testplay.owner";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const EXCLUDED_SERVICES = [
  "realtime",
  "storage-api",
  "imgproxy",
  "studio",
  "mailpit",
  "postgres-meta",
  "edge-runtime",
  "logflare",
  "vector",
  "supavisor",
];
const PORT_KEYS = new Map([
  ["api:port", "api"],
  ["db:port", "db"],
  ["db:shadow_port", "shadow"],
  ["db.pooler:port", "pooler"],
  ["studio:port", "studio"],
  ["local_smtp:port", "smtp"],
  ["analytics:port", "analytics"],
]);

function safeEnvironment() {
  const allowed = ["HOME", "PATH", "TMP", "TEMP", "TMPDIR", "npm_config_cache", "CI"];
  return Object.fromEntries(allowed.flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]]));
}

function runSupabase(workdir, args, label, { allowFailure = false, networkId } = {}) {
  const result = spawnSync("npx", [
    "--offline",
    "--yes",
    `supabase@${SUPABASE_VERSION}`,
    "--workdir",
    workdir,
    ...(networkId ? ["--network-id", networkId] : []),
    ...args,
  ], {
    cwd: REPO_ROOT,
    env: safeEnvironment(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
  if (result.error) throw new Error(`${label} could not run: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? result.signal ?? "unknown"}); raw CLI output was suppressed to protect local credentials`);
  }
  return result;
}

function runDocker(args, label) {
  const result = spawnSync("docker", args, {
    cwd: REPO_ROOT,
    env: safeEnvironment(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error) throw new Error(`${label} could not run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status ?? result.signal ?? "unknown"})`);
  return result.stdout.trim();
}

function assertDockerVersion() {
  const version = runDocker(
    ["version", "--format", "{{.Server.Version}}"],
    "Docker server version check",
  );
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error("could not identify the Docker server version");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (
    major < 29 ||
    (major === 29 && minor < 10)
  ) {
    throw new Error("internal-isolated mode requires Docker 29.10.0 or later");
  }
  runDocker(["image", "inspect", RELAY_IMAGE], "local TCP relay image check");
}

function assertInternalNetwork(networkId) {
  const network = JSON.parse(runDocker([
    "network",
    "inspect",
    "--format",
    "{{json .}}",
    networkId,
  ], "Docker internal network verification"));
  if (
    network.Internal !== true ||
    network.Options?.["com.docker.network.bridge.gateway_mode_ipv4"] !== "isolated" ||
    network.Labels?.[OWNER_LABEL] !== networkId
  ) {
    throw new Error("Docker did not create the owned internal isolated-gateway network");
  }
}

function inspectContainer(containerId, label) {
  return JSON.parse(runDocker([
    "inspect",
    "--format",
    "{{json .}}",
    containerId,
  ], label));
}

function assertInternalContainerMembership(containerIds, networkId) {
  for (const id of containerIds) {
    const container = inspectContainer(id, "internal Supabase container inspection");
    const networkNames = Object.keys(container.NetworkSettings?.Networks ?? {});
    if (networkNames.length !== 1 || networkNames[0] !== networkId) {
      throw new Error("a disposable Supabase container is attached outside its owned internal network");
    }
    for (const entries of Object.values(container.NetworkSettings?.Ports ?? {})) {
      for (const entry of entries ?? []) {
        if (entry.HostPort) {
          throw new Error("Docker published a Supabase port; internal mode requires the TCP relay");
        }
      }
    }
  }
}

function createInternalNetwork(networkId) {
  assertDockerVersion();
  runDocker([
    "network",
    "create",
    "--driver",
    "bridge",
    "--internal",
    "--opt",
    "com.docker.network.bridge.gateway_mode_ipv4=isolated",
    "--label",
    `${OWNER_LABEL}=${networkId}`,
    networkId,
  ], "creation of owned internal isolated-gateway network");
  assertInternalNetwork(networkId);
}

const RELAY_ECHO_SERVER = [
  'const net = require("node:net");',
  `net.createServer((socket) => socket.pipe(socket)).listen(${RELAY_PROBE_PORT}, "127.0.0.1");`,
].join(" ");

function createRelayContainer(projectId, networkId) {
  const name = `${projectId}-relay`;
  const id = runDocker([
    "run",
    "--detach",
    "--name",
    name,
    "--network",
    networkId,
    "--label",
    `${OWNER_LABEL}=${projectId}`,
    "--label",
    "org.fusou.tlsn.testplay.role=tcp-relay",
    "--entrypoint",
    "node",
    RELAY_IMAGE,
    "-e",
    RELAY_ECHO_SERVER,
  ], "creation of internal TCP relay container");
  const container = inspectContainer(id, "internal TCP relay verification");
  if (
    container.Config?.Labels?.[OWNER_LABEL] !== projectId ||
    container.Config?.Labels?.["org.fusou.tlsn.testplay.role"] !== "tcp-relay"
  ) {
    throw new Error("internal TCP relay ownership labels do not match");
  }
  assertInternalContainerMembership([id], networkId);
  return { name, id };
}

function relayBridgeScript(host, port) {
  return [
    'const net = require("node:net");',
    `const socket = net.connect({host: ${JSON.stringify(host)}, port: ${port}});`,
    "process.stdin.pipe(socket);",
    "socket.pipe(process.stdout);",
    'socket.on("error", () => { process.exitCode = 1; });',
  ].join(" ");
}

function startRelayWorker(relayName, mode, ports) {
  const child = spawn(
    process.execPath,
    [SCRIPT_PATH, "--relay-worker", relayName, mode, JSON.stringify(ports)],
    {
      cwd: REPO_ROOT,
      env: safeEnvironment(),
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  return new Promise((resolveWorker, rejectWorker) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectWorker(new Error("loopback TCP relay did not become ready"));
    }, 5_000);
    child.once("message", (message) => {
      clearTimeout(timeout);
      if (message?.ready === true) {
        resolveWorker(child);
      } else {
        child.kill("SIGTERM");
        rejectWorker(new Error("loopback TCP relay failed to start"));
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectWorker(new Error(`loopback TCP relay could not start: ${error.message}`));
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectWorker(new Error(`loopback TCP relay exited before readiness (${code ?? "signal"})`));
    });
  });
}

function stopRelayWorker(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
    child.kill("SIGTERM");
  });
}

async function relayProbeOnce(port, challenge) {
  await new Promise((resolveProbe, rejectProbe) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const chunks = [];
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectProbe(new Error("loopback TCP relay round-trip timed out"));
    }, 3_000);
    socket.once("connect", () => socket.end(challenge));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.once("error", (error) => {
      clearTimeout(timeout);
      rejectProbe(new Error(`loopback TCP relay round-trip failed: ${error.code ?? "connection error"}`));
    });
    socket.once("end", () => {
      clearTimeout(timeout);
      const response = Buffer.concat(chunks).toString("utf8");
      if (response !== challenge) {
        rejectProbe(new Error("loopback TCP relay round-trip returned unexpected bytes"));
        return;
      }
      resolveProbe();
    });
  });
}

async function waitForRelayProbe(port) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await relayProbeOnce(port, `fusou-tlsn-relay-${randomUUID()}`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  const reason = lastError instanceof Error ? lastError.message : "unknown relay error";
  throw new Error(`loopback TCP relay preflight failed: ${reason}`);
}

async function prepareInternalRelay(workdir, owner) {
  const relay = createRelayContainer(owner.project_id, owner.network_id);
  owner.relay_container_name = relay.name;
  owner.relay_container_id = relay.id;
  owner.relay_container_created = true;
  writeOwner(workdir, owner);

  const probePort = await unusedPort();
  let probeWorker;
  try {
    probeWorker = await startRelayWorker(relay.name, "probe", { probe: probePort });
    await waitForRelayProbe(probePort);
  } finally {
    await stopRelayWorker(probeWorker);
  }

  return startRelayWorker(relay.name, "supabase", {
    api: owner.ports.api,
    db: owner.ports.db,
  });
}

function runRelayWorker(relayName, mode, rawPorts) {
  const ports = JSON.parse(rawPorts);
  const targetByRole = mode === "probe"
    ? { probe: { host: "127.0.0.1", port: RELAY_PROBE_PORT } }
    : mode === "supabase"
      ? {
          api: { host: "kong", port: 8000 },
          db: { host: "db", port: 5432 },
        }
      : undefined;
  if (!targetByRole || Object.keys(ports).sort().join(",") !== Object.keys(targetByRole).sort().join(",")) {
    throw new Error("invalid internal relay mode");
  }

  const servers = [];
  for (const [role, localPort] of Object.entries(ports)) {
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
      throw new Error("invalid loopback relay listener port");
    }
    const target = targetByRole[role];
    const server = createServer({ allowHalfOpen: true }, (client) => {
      const bridge = spawn("docker", [
        "exec",
        "-i",
        relayName,
        "node",
        "-e",
        relayBridgeScript(target.host, target.port),
      ], {
        env: safeEnvironment(),
        stdio: ["pipe", "pipe", "ignore"],
      });
      bridge.stdin.on("error", () => client.destroy());
      bridge.on("error", () => client.destroy());
      client.on("error", () => bridge.kill("SIGTERM"));
      bridge.stdout.pipe(client);
      bridge.once("close", () => {
        if (!client.destroyed) client.end();
      });
      client.once("close", () => {
        bridge.stdin.destroy();
        if (bridge.exitCode === null && bridge.signalCode === null) {
          bridge.kill("SIGTERM");
        }
      });
      client.pipe(bridge.stdin);
    });
    server.once("error", (error) => {
      if (typeof process.send === "function") {
        process.send({ error: error.code ?? "listener error" });
      }
      process.exitCode = 1;
    });
    servers.push({ server, localPort });
  }

  let listening = 0;
  for (const { server, localPort } of servers) {
    server.listen(localPort, "127.0.0.1", () => {
      listening += 1;
      if (listening === servers.length && typeof process.send === "function") {
        process.send({ ready: true });
      }
    });
  }
  const closeServers = () => {
    for (const { server } of servers) server.close();
  };
  process.once("SIGTERM", closeServers);
  process.once("SIGINT", closeServers);
}

function assertInternalServiceDns(owner) {
  const containers = getContainerIds(owner.project_id).map((id) =>
    inspectContainer(id, "internal Supabase service DNS inspection"));
  for (const alias of ["kong", "db"]) {
    const container = containers.find((candidate) =>
      candidate.NetworkSettings?.Networks?.[owner.network_id]?.Aliases?.includes(alias));
    if (!container) {
      throw new Error(`expected Supabase ${alias} service alias was not found on the owned network`);
    }
    const expectedAddress = container.NetworkSettings.Networks[owner.network_id].IPAddress;
    const lookupScript = [
      'require("node:dns").lookup(process.argv[1], (error, address) => {',
      'if (error) process.exit(1);',
      'process.stdout.write(address);',
      '});',
    ].join(" ");
    const resolvedAddress = runDocker([
      "exec",
      owner.relay_container_name,
      "node",
      "-e",
      lookupScript,
      alias,
    ], `internal ${alias} DNS lookup`);
    if (resolvedAddress !== expectedAddress) {
      throw new Error(`internal ${alias} DNS did not resolve to the current container address`);
    }
  }
}

function migrationDigests() {
  return readdirSync(MIGRATIONS_PATH)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sha256: createHash("sha256").update(readFileSync(join(MIGRATIONS_PATH, name))).digest("hex"),
    }));
}

function readConfig(workdir) {
  return readFileSync(join(workdir, "supabase/config.toml"), "utf8");
}

function setConfig(workdir, { ports, migrationsEnabled }) {
  const configPath = join(workdir, "supabase/config.toml");
  let section = "";
  const seen = new Set();
  const lines = readConfig(workdir).split(/\r?\n/).map((line) => {
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) section = header[1];
    if (section === "db.migrations" && /^enabled\s*=/.test(line)) {
      seen.add("migrations");
      return `enabled = ${migrationsEnabled}`;
    }
    const portMatch = line.match(/^([a-z_]+)\s*=\s*[0-9]+$/);
    if (!portMatch) return line;
    const key = PORT_KEYS.get(`${section}:${portMatch[1]}`);
    if (!key) return line;
    seen.add(key);
    return `${portMatch[1]} = ${ports[key]}`;
  });
  for (const required of [...PORT_KEYS.values(), "migrations"]) {
    if (!seen.has(required)) throw new Error(`Supabase CLI template is missing expected config field: ${required}`);
  }
  writeFileSync(configPath, `${lines.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
  chmodSync(configPath, 0o600);
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("could not reserve a local Supabase port");
  }
  const port = address.port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function allocatePorts() {
  const ports = {};
  for (const name of new Set(PORT_KEYS.values())) ports[name] = await unusedPort();
  if (new Set(Object.values(ports)).size !== Object.keys(ports).length) {
    throw new Error("local port allocator returned duplicate ports");
  }
  return ports;
}

function assertSafeWorkdir(workdir) {
  const tempRoot = realpathSync(tmpdir());
  const resolved = resolve(workdir);
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("TLSN testplay workdir must be a real directory, not a symlink");
  }
  const actual = realpathSync(resolved);
  if (
    dirname(actual) !== tempRoot ||
    !basename(actual).startsWith(WORKDIR_PREFIX) ||
    actual === REPO_ROOT ||
    actual.startsWith(`${REPO_ROOT}${sep}`)
  ) {
    throw new Error("TLSN testplay workdir must be a script-owned direct child of the system temp directory");
  }
  return actual;
}

function loadOwner(workdir) {
  const ownerPath = join(workdir, OWNER_FILE);
  if (!existsSync(ownerPath)) {
    throw new Error("workdir has no TLSN testplay ownership record; arbitrary local or linked projects are not accepted");
  }
  const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
  if (
    owner.schema_version !== 1 ||
    owner.project_id !== basename(workdir) ||
    JSON.stringify(owner.migrations) !== JSON.stringify(migrationDigests())
  ) {
    throw new Error("TLSN testplay ownership record or migration digest baseline does not match");
  }
  if (!readConfig(workdir).includes(`project_id = "${owner.project_id}"`)) {
    throw new Error("TLSN testplay Supabase project ID does not match its ownership record");
  }
  const migrationsLink = join(workdir, "supabase/migrations");
  if (
    !lstatSync(migrationsLink).isSymbolicLink() ||
    realpathSync(migrationsLink) !== realpathSync(MIGRATIONS_PATH)
  ) {
    throw new Error("temporary Supabase migrations must resolve to the repository's original migration directory");
  }
  const linkedProject = join(workdir, "supabase/.temp/linked-project.json");
  if (existsSync(linkedProject)) {
    throw new Error("linked Supabase projects are not accepted by the TLSN testplay initializer");
  }
  return owner;
}

function writeOwner(workdir, owner) {
  const ownerPath = join(workdir, OWNER_FILE);
  writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, { mode: 0o600 });
  chmodSync(ownerPath, 0o600);
}

function parseQueryResult(result, expectedPort) {
  if (!result.stderr.includes(`Target: local stack (127.0.0.1:${expectedPort})`)) {
    throw new Error("Supabase CLI did not confirm the expected local database target");
  }
  const jsonStart = result.stdout.indexOf("[");
  if (jsonStart < 0) throw new Error("local Supabase query returned no JSON rows");
  const rows = JSON.parse(result.stdout.slice(jsonStart));
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("local Supabase query returned an unexpected row count");
  }
  return rows[0];
}

function localQuery(workdir, dbPort, networkId, sql) {
  const result = runSupabase(workdir, [
    "db",
    "query",
    "--read-only",
    "--output-format",
    "json",
    sql,
  ], "read-only local database inspection", { networkId });
  return parseQueryResult(result, dbPort);
}

function inspectDatabase(workdir, dbPort, networkId) {
  const row = localQuery(workdir, dbPort, networkId, `
    SELECT
      to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS history_table_exists,
      (SELECT count(*)::integer FROM pg_catalog.pg_tables WHERE schemaname = 'public') AS public_table_count,
      (SELECT count(*)::integer FROM auth.users) AS auth_user_count
  `);
  let historyCount = 0;
  if (row.history_table_exists) {
    const history = localQuery(workdir, dbPort, networkId,
      "SELECT count(*)::integer AS migration_count FROM supabase_migrations.schema_migrations");
    historyCount = history.migration_count;
  }
  return {
    historyTableExists: row.history_table_exists,
    migrationCount: historyCount,
    publicTableCount: row.public_table_count,
    authUserCount: row.auth_user_count,
  };
}

function assertDatabaseIsEmpty(state) {
  if (
    state.migrationCount !== 0 ||
    state.publicTableCount !== 0 ||
    state.authUserCount !== 0
  ) {
    throw new Error(
      `refusing initialized Supabase database before writes (migration rows=${state.migrationCount}, public tables=${state.publicTableCount}, Auth users=${state.authUserCount})`,
    );
  }
}

function verifyPostMigration(workdir, dbPort, networkId, expectedVersions) {
  const row = localQuery(workdir, dbPort, networkId, `
    SELECT json_build_object(
      'versions', (SELECT array_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),
      'user_member_map_uuid_shape',
        to_regclass('public.user_member_map') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_member_map' AND column_name='public_id')
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_member_map' AND column_name='member_id_hash'),
      'user_devices_uuid_shape',
        to_regclass('public.user_devices') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_devices' AND column_name='public_id'),
      'nonce_consumptions', to_regclass('public.anon_sync_nonce_consumptions') IS NOT NULL,
      'proof_consumptions', to_regclass('public.tlsn_device_proof_consumptions') IS NOT NULL,
      'rate_limits', to_regclass('public.anon_sync_rate_limits') IS NOT NULL,
      'consume_proof_rpc',
        to_regprocedure('public.rpc_consume_tlsn_device_proof(text,uuid,uuid,bytea,text,text,uuid,text,text)') IS NOT NULL
        AND has_function_privilege('service_role', 'public.rpc_consume_tlsn_device_proof(text,uuid,uuid,bytea,text,text,uuid,text,text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.rpc_consume_tlsn_device_proof(text,uuid,uuid,bytea,text,text,uuid,text,text)', 'EXECUTE'),
      'register_device_rpc',
        to_regprocedure('public.rpc_register_user_device(uuid,text)') IS NOT NULL
        AND has_function_privilege('service_role', 'public.rpc_register_user_device(uuid,text)', 'EXECUTE'),
      'replay_observation_rpc',
        to_regprocedure('public.rpc_observe_tlsn_device_proof_replay(uuid,uuid,bytea,text,uuid,text,text)') IS NOT NULL
        AND has_function_privilege('service_role', 'public.rpc_observe_tlsn_device_proof_replay(uuid,uuid,bytea,text,uuid,text,text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.rpc_observe_tlsn_device_proof_replay(uuid,uuid,bytea,text,uuid,text,text)', 'EXECUTE')
    ) AS verification
  `);
  const verification = typeof row.verification === "string"
    ? JSON.parse(row.verification)
    : row.verification;
  if (JSON.stringify(verification.versions) !== JSON.stringify(expectedVersions)) {
    throw new Error("applied migration history does not exactly match the repository migration IDs");
  }
  for (const key of [
    "user_member_map_uuid_shape",
    "user_devices_uuid_shape",
    "nonce_consumptions",
    "proof_consumptions",
    "rate_limits",
    "consume_proof_rpc",
    "register_device_rpc",
    "replay_observation_rpc",
  ]) {
    if (verification[key] !== true) throw new Error(`post-migration contract is missing: ${key}`);
  }
}

function parseArgs(args) {
  if (args[0] === "--") return parseArgs(args.slice(1));
  if (args.length === 0) return { networkMode: "loopback" };
  if (args.length === 1 && args[0] === "--internal-isolated") {
    return { networkMode: "internal-isolated" };
  }
  if (args.length === 2 && args[0] === "--workdir" && args[1]) {
    return { workdir: args[1] };
  }
  throw new Error(
    "usage: init:tlsn-testplay-supabase [--internal-isolated | --workdir <script-owned-temp-workdir>]",
  );
}

function getContainerIds(projectId) {
  const output = runDocker([
    "ps",
    "-aq",
    "--filter",
    `label=com.docker.compose.project=${projectId}`,
  ], "local Docker project identification");
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function createLoopbackNetwork(networkId) {
  runDocker([
    "network",
    "create",
    "--driver",
    "bridge",
    "--opt",
    "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
    networkId,
  ], "creation of loopback-only Docker network");
}

function assertLoopbackContainerBindings(containerIds) {
  for (const id of containerIds) {
    const raw = runDocker([
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      id,
    ], "verification of disposable Supabase port bindings");
    const bindings = JSON.parse(raw || "{}");
    for (const entries of Object.values(bindings)) {
      for (const entry of entries ?? []) {
        if (!entry.HostPort) continue;
        if (!["127.0.0.1", "::1"].includes(entry.HostIp)) {
          throw new Error(`Supabase published a port on ${entry.HostIp || "an unspecified interface"}; refusing to use the local database`);
        }
      }
    }
  }
}

function assertSupabaseNetworkIsolation(owner) {
  const containerIds = getContainerIds(owner.project_id);
  if (owner.network_mode === "internal-isolated") {
    assertInternalNetwork(owner.network_id);
    assertInternalContainerMembership(containerIds, owner.network_id);
    return;
  }
  assertLoopbackContainerBindings(containerIds);
}

async function waitForAuth(apiPort) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/auth/v1/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status === 200) return;
    } catch {
      // Retry until the local Auth service is ready or the bounded deadline expires.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("local Supabase Auth did not become healthy on the configured loopback port");
}

async function createProject(networkMode) {
  const workdir = mkdtempSync(join(tmpdir(), WORKDIR_PREFIX));
  chmodSync(workdir, 0o700);
  const projectId = basename(workdir);
  const ports = await allocatePorts();
  const migrations = migrationDigests();
  const owner = {
    schema_version: 1,
    project_id: projectId,
    network_id: projectId,
    network_mode: networkMode,
    ports,
    created_at: new Date().toISOString(),
    initialized: false,
    migrations,
  };
  writeOwner(workdir, owner);
  try {
    runSupabase(workdir, ["init"], "isolated Supabase CLI initialization");
    const configPath = join(workdir, "supabase/config.toml");
    let config = readFileSync(configPath, "utf8");
    config = config.replace(
      /^project_id\s*=\s*".*"$/m,
      `project_id = "${projectId}"`,
    );
    writeFileSync(configPath, config, { mode: 0o600 });
    chmodSync(configPath, 0o600);
    symlinkSync(MIGRATIONS_PATH, join(workdir, "supabase/migrations"), "dir");
    setConfig(workdir, { ports, migrationsEnabled: false });
    return { workdir, owner, ports };
  } catch (error) {
    rmSync(workdir, { recursive: true, force: true });
    throw error;
  }
}

async function initialize(workdir, owner) {
  if (owner.initialized) {
    throw new Error("workdir is already marked initialized; it will be inspected read-only and never reset");
  }
  if (getContainerIds(owner.project_id).length > 0) {
    throw new Error("owned project already has Docker containers but is not initialized; refusing to reuse partial state");
  }
  const before = migrationDigests();
  if (JSON.stringify(before) !== JSON.stringify(owner.migrations)) {
    throw new Error("repository migration files changed after this disposable project was created");
  }
  let relayWorker;
  try {
    if (owner.network_mode === "internal-isolated") {
      createInternalNetwork(owner.network_id);
      owner.network_created = true;
      writeOwner(workdir, owner);
      relayWorker = await prepareInternalRelay(workdir, owner);
    } else {
      createLoopbackNetwork(owner.network_id);
      owner.network_created = true;
      writeOwner(workdir, owner);
    }

    setConfig(workdir, { ports: owner.ports, migrationsEnabled: false });
    runSupabase(workdir, [
      "start",
      "--exclude",
      EXCLUDED_SERVICES.join(","),
    ], "isolated local Supabase startup", { networkId: owner.network_id });
    owner.started_at = new Date().toISOString();
    writeOwner(workdir, owner);
    assertSupabaseNetworkIsolation(owner);
    if (owner.network_mode === "internal-isolated") {
      assertInternalServiceDns(owner);
    }
    await waitForAuth(owner.ports.api);

    const initialState = inspectDatabase(workdir, owner.ports.db, owner.network_id);
    assertDatabaseIsEmpty(initialState);

    setConfig(workdir, { ports: owner.ports, migrationsEnabled: true });
    runSupabase(workdir, [
      "db",
      "reset",
      "--version",
      PREFIX_VERSION,
      "--no-seed",
    ], "application of original migrations through 20260417183000", {
      networkId: owner.network_id,
    });
    assertSupabaseNetworkIsolation(owner);
    if (owner.network_mode === "internal-isolated") {
      assertInternalServiceDns(owner);
    }

    const prefixState = inspectDatabase(workdir, owner.ports.db, owner.network_id);
    if (prefixState.migrationCount !== 2) {
      throw new Error(`unexpected prefix migration history count: ${prefixState.migrationCount}`);
    }
    const bootstrap = runSupabase(workdir, [
      "db",
      "query",
      "--file",
      BOOTSTRAP_SQL,
    ], "legacy TLSN testplay pre-migration bootstrap", { networkId: owner.network_id });
    if (!bootstrap.stderr.includes(`Target: local stack (127.0.0.1:${owner.ports.db})`)) {
      throw new Error("legacy bootstrap did not confirm the expected local database target");
    }
    runSupabase(workdir, ["migration", "up"], "application of remaining original migrations", {
      networkId: owner.network_id,
    });
    assertSupabaseNetworkIsolation(owner);
    if (owner.network_mode === "internal-isolated") {
      assertInternalServiceDns(owner);
    }

    const expectedVersions = before.map(({ name }) => name.slice(0, name.indexOf("_")));
    verifyPostMigration(workdir, owner.ports.db, owner.network_id, expectedVersions);
    const after = migrationDigests();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error("repository migration files changed during TLSN testplay initialization");
    }
    owner.initialized = true;
    owner.initialized_at = new Date().toISOString();
    writeOwner(workdir, owner);

    console.log("TLSN_TESTPLAY_SUPABASE=INITIALIZED");
    console.log(`WORKDIR=${workdir}`);
    console.log(`PROJECT_ID=${owner.project_id}`);
    if (owner.network_mode === "internal-isolated") {
      console.log(`DOCKER_NETWORK=${owner.network_id}; internal=true; gateway_mode=isolated`);
      console.log("HOST_RELAY=127.0.0.1 API/DB listeners; upstream via owned docker-exec relay; no published ports");
    } else {
      console.log(`DOCKER_NETWORK=${owner.network_id}; host_binding=127.0.0.1`);
    }
    console.log(`API_URL=http://127.0.0.1:${owner.ports.api}`);
    console.log(`DB_URL=postgresql://postgres:<local-secret>@127.0.0.1:${owner.ports.db}/postgres`);
    console.log(`MIGRATIONS_APPLIED=${expectedVersions.length}`);
    console.log("MIGRATION_FILE_DIGESTS=UNCHANGED");
    console.log("AUTH_HEALTH=200");
    console.log("POST_MIGRATION_SCHEMA=VERIFIED");
    console.log("Use `supabase status --workdir <WORKDIR> --output env` only with output redirected to a mode-0600 file.");
  } finally {
    await stopRelayWorker(relayWorker);
  }
}

async function inspectExisting(workdir, owner) {
  if (!owner.initialized) {
    throw new Error("workdir is not marked initialized; refusing to start or resume an interrupted initialization");
  }
  if (getContainerIds(owner.project_id).length === 0) {
    throw new Error("owned Supabase containers are not running; this invocation will not recreate or reset the database");
  }
  if (owner.network_created !== true) {
    throw new Error("workdir does not record an owned Docker network");
  }
  let relayWorker;
  try {
    if (owner.network_mode === "internal-isolated") {
      assertInternalNetwork(owner.network_id);
      assertInternalContainerMembership(getContainerIds(owner.project_id), owner.network_id);
      if (
        typeof owner.relay_container_name !== "string" ||
        typeof owner.relay_container_id !== "string" ||
        owner.relay_container_created !== true
      ) {
        throw new Error("workdir does not record its owned internal TCP relay");
      }
      const relay = inspectContainer(owner.relay_container_id, "existing internal TCP relay verification");
      if (
        relay.Name !== `/${owner.relay_container_name}` ||
        relay.Config?.Labels?.[OWNER_LABEL] !== owner.project_id
      ) {
        throw new Error("existing internal TCP relay ownership does not match");
      }
      relayWorker = await startRelayWorker(owner.relay_container_name, "supabase", {
        api: owner.ports.api,
        db: owner.ports.db,
      });
      assertInternalServiceDns(owner);
      assertSupabaseNetworkIsolation(owner);
    } else {
      assertLoopbackContainerBindings(getContainerIds(owner.project_id));
    }
    const state = inspectDatabase(workdir, owner.ports.db, owner.network_id);
    assertDatabaseIsEmpty(state);
    throw new Error("refusing an existing TLSN testplay stack; use a new disposable workdir for initialization");
  } finally {
    await stopRelayWorker(relayWorker);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.workdir) {
    if (options.networkMode === "internal-isolated") assertDockerVersion();
    const project = await createProject(options.networkMode);
    try {
      await initialize(project.workdir, project.owner);
    } catch (error) {
      try {
        const ids = getContainerIds(project.owner.project_id);
        if (ids.length > 0) {
          const cleanup = runSupabase(project.workdir, [
            "stop",
            "--project-id",
            project.owner.project_id,
            "--no-backup",
          ], "cleanup of failed disposable Supabase project", {
            allowFailure: true,
            networkId: project.owner.network_id,
          });
          if (cleanup.status !== 0) {
            throw new Error(`Supabase stop exited with ${cleanup.status ?? cleanup.signal ?? "unknown"}`);
          }
        }
        if (project.owner.network_created) {
          if (project.owner.relay_container_created) {
            const relay = inspectContainer(
              project.owner.relay_container_id,
              "failed initialization relay ownership check",
            );
            if (
              relay.Config?.Labels?.[OWNER_LABEL] !== project.owner.project_id ||
              relay.Name !== `/${project.owner.relay_container_name}`
            ) {
              throw new Error("refusing to remove a relay without matching ownership labels");
            }
            runDocker(["rm", "-f", project.owner.relay_container_id], "cleanup of internal TCP relay");
          }
          runDocker(["network", "rm", project.owner.network_id], "cleanup of disposable network");
        }
      } catch (cleanupError) {
        const reason = cleanupError instanceof Error ? cleanupError.message : "unknown cleanup error";
        const cause = error instanceof Error ? error.message : "unknown initialization failure";
        throw new Error(`initialization failed (${cause}); disposable stack cleanup also failed: ${reason}; workdir retained at ${project.workdir}`);
      }
      rmSync(project.workdir, { recursive: true, force: true });
      throw error;
    }
    return;
  }

  const workdir = assertSafeWorkdir(options.workdir);
  const owner = loadOwner(workdir);
  await inspectExisting(workdir, owner);
}

if (process.argv[2] === "--relay-worker") {
  try {
    runRelayWorker(process.argv[3], process.argv[4], process.argv[5]);
  } catch (error) {
    if (typeof process.send === "function") {
      process.send({ error: error instanceof Error ? error.message : "relay startup failed" });
    }
    process.exitCode = 1;
  }
} else {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "TLSN testplay Supabase initialization failed");
    process.exitCode = 1;
  });
}
