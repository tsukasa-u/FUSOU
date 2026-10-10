import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createPreCaptureReadiness } from "./testplay-pre-capture-readiness.mjs";

const appRoot = process.cwd();
const repositoryRoot = path.resolve(appRoot, "..", "..");
const configPath = path.join(
  appRoot,
  "src-tauri",
  "roaming",
  "user",
  "configs.toml",
);
const recoveryMarkerPath = path.join(path.dirname(configPath), ".testplay-verify-recovery.json");
const MAX_RECOVERY_MARKER_BYTES = 6 * 1024 * 1024;
const MAX_RECOVERY_CONFIG_BYTES = 4 * 1024 * 1024;
const CAPTURE_TEMP_PREFIX = ".configs.toml.capture-";
const RESTORE_TEMP_PREFIX = ".configs.toml.restore-";
const MARKER_TEMP_PREFIX = ".testplay-verify-recovery-";
const defaultConfigPath = path.join(
  appRoot,
  "src-tauri",
  "resources",
  "user",
  "configs.toml",
);
const temporarySettingsBySection = new Map([
  [
    "proxy",
    new Map([
      ["allow_save_api_requests", "false"],
      ["allow_save_api_responses", "false"],
      ["allow_save_resources", "false"],
      ["allow_save_main_js_local", "false"],
    ]),
  ],
  [
    "proxy.tlsn",
    new Map([
      ["enabled", "false"],
      ["candidate_capture_enabled", "false"],
    ]),
  ],
  [
    "app.database",
    new Map([
      ["allow_data_to_cloud", "false"],
      ["allow_data_to_shared_cloud", "false"],
      ["allow_data_to_local", "false"],
    ]),
  ],
  ["app.asset_sync", new Map([["asset_upload_enable", "false"]])],
  ["app.quest_tree_sender", new Map([["enable", "false"]])],
  ["app.ship_growth_sender", new Map([["enable", "false"]])],
  ["app.soku_speed_sender", new Map([["enable", "false"]])],
  ["app.remodel_sender", new Map([["enable", "false"]])],
]);

function fail(message) {
  console.error(`testplay:verify: ${message}`);
  process.exitCode = 2;
}

export function parseTestplayArguments(args, environment = process.env) {
  let parsed;
  try {
    parsed = parseArgs({
      args: args.filter((argument) => argument !== "--"),
      options: {
        "tlsn-candidate": { type: "boolean" },
        "worker-reference": { type: "string" },
        "reference-sha256": { type: "string" },
        "worker-sha": { type: "string" },
        "app-sha": { type: "string" },
        toolchain: { type: "string" },
        profile: { type: "string" },
        "build-output": { type: "string" },
      },
      allowPositionals: true,
    });
  } catch (error) {
    throw new Error(`invalid testplay arguments: ${error.message}`);
  }

  if (parsed.positionals.length > 1) {
    throw new Error("pass exactly one capture output directory");
  }
  const tlsnCandidate = parsed.values["tlsn-candidate"] === true;
  const buildOptions = [
    "worker-reference",
    "reference-sha256",
    "worker-sha",
    "app-sha",
    "toolchain",
    "profile",
    "build-output",
  ];
  if (!tlsnCandidate && buildOptions.some((name) => parsed.values[name] !== undefined)) {
    throw new Error("approved Worker build options require --tlsn-candidate");
  }
  const outputPath = parsed.positionals[0] ?? environment.FUSOU_CAPTURE_OUTPUT_PATH;
  if (tlsnCandidate) {
    for (const name of [
      "worker-reference",
      "reference-sha256",
      "worker-sha",
      "app-sha",
      "toolchain",
      "build-output",
    ]) {
      if (!parsed.values[name]) throw new Error(`missing required testplay option: --${name}`);
    }
    if (parsed.values.profile !== undefined &&
        !["debug", "release"].includes(parsed.values.profile)) {
      throw new Error("--profile must be debug or release");
    }
  }

  return {
    tlsnCandidate,
    outputPath,
    workerReferencePath: parsed.values["worker-reference"],
    expectedReferenceSha256: parsed.values["reference-sha256"],
    expectedWorkerSha: parsed.values["worker-sha"],
    expectedAppSha: parsed.values["app-sha"],
    toolchain: parsed.values.toolchain,
    profile: parsed.values.profile ?? "release",
    buildOutputPath: parsed.values["build-output"],
  };
}

export function candidateAppLaunchArguments(configPath, startMarkerPath) {
  if (typeof configPath !== "string" || !path.isAbsolute(configPath) ||
      typeof startMarkerPath !== "string" || !path.isAbsolute(startMarkerPath)) {
    throw new Error("candidate APP config and start marker paths must be absolute");
  }
  return [
    "--tlsn-candidate-config",
    configPath,
    "--tlsn-candidate-start-marker",
    startMarkerPath,
  ];
}

export async function verifyCandidateAppStartMarker(markerPath, configPath) {
  let stats;
  try {
    stats = await fs.lstat(markerPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error("verified APP binary exited before reaching its Tauri startup");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("candidate APP start marker must be a regular non-symlink file");
  }
  let marker;
  try {
    marker = JSON.parse(await fs.readFile(markerPath, "utf8"));
  } catch {
    throw new Error("candidate APP start marker is malformed");
  }
  if (!marker || marker.schema_version !== 1 ||
      marker.scope !== "fusou-tlsn-candidate-app-start" ||
      marker.config_path !== configPath) {
    throw new Error("candidate APP did not start with the verified effective config");
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function runtimeEnvironment(environment, recoveryToken) {
  const names = [
    "PATH",
    "HOME",
    "USER",
    "USERNAME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "TMP",
    "TEMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
    "XDG_SESSION_TYPE",
    "DBUS_SESSION_BUS_ADDRESS",
    "XAUTHORITY",
    "GDK_BACKEND",
  ];
  const result = Object.fromEntries(
    names.filter((name) => environment[name] !== undefined)
      .map((name) => [name, environment[name]]),
  );
  result.FUSOU_TESTPLAY_RECOVERY_TOKEN = recoveryToken;
  return result;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function assertCurrentUser(stats, label) {
  if (process.platform !== "win32" && typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error(`${label} must be owned by the current user`);
  }
}

function assertPrivateDirectoryStats(stats, label) {
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
  if (process.platform !== "win32") {
    assertCurrentUser(stats, label);
    if ((stats.mode & 0o077) !== 0) throw new Error(`${label} permissions must be private`);
  }
}

async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  let stats = await fs.lstat(directory);
  assertPrivateDirectoryStats(stats, "test-play recovery parent");
  if (process.platform !== "win32") {
    await fs.chmod(directory, 0o700);
    stats = await fs.lstat(directory);
    assertPrivateDirectoryStats(stats, "test-play recovery parent");
  }
}

async function syncDirectory(directory) {
  if (process.platform === "win32") return;
  const handle = await fs.open(directory, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readBounded(handle, maximumBytes, label) {
  const chunks = [];
  let total = 0;
  while (total <= maximumBytes) {
    const buffer = Buffer.alloc(Math.min(64 * 1024, maximumBytes + 1 - total));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maximumBytes) throw new Error(`${label} exceeds the size limit`);
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

async function openRegularFile(
  filePath,
  label,
  { privateFile = false, maximumBytes, requireCurrentUser = true } = {},
) {
  const before = await fs.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (requireCurrentUser) assertCurrentUser(before, label);
  if (privateFile && process.platform !== "win32" && (before.mode & 0o077) !== 0) {
    throw new Error(`${label} permissions must be private`);
  }
  if (maximumBytes !== undefined && before.size > maximumBytes) {
    throw new Error(`${label} exceeds the size limit`);
  }
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
    if (requireCurrentUser) assertCurrentUser(opened, label);
    if (privateFile && process.platform !== "win32" && (opened.mode & 0o077) !== 0) {
      throw new Error(`${label} permissions must be private`);
    }
    if (before.dev !== opened.dev || before.ino !== opened.ino) {
      throw new Error(`${label} changed while opening`);
    }
    if (maximumBytes !== undefined && opened.size > maximumBytes) {
      throw new Error(`${label} exceeds the size limit`);
    }
    return { handle, stats: opened };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function readRegularFile(filePath, label, options = {}) {
  const { handle } = await openRegularFile(filePath, label, options);
  try {
    if (options.maximumBytes === undefined) return await handle.readFile();
    return await readBounded(handle, options.maximumBytes, label);
  } finally {
    await handle.close();
  }
}

function parseRecoveryMarker(bytes) {
  let marker;
  try {
    marker = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("test-play recovery marker is malformed; refusing to load temporary config");
  }
  const keys = Object.keys(marker ?? {}).sort();
  if (
    !Array.isArray(keys) ||
    keys.join(",") !== "capture_token,launcher_pid,original_config_base64,original_mode,schema_version" ||
    marker.schema_version !== 2 ||
    !Number.isInteger(marker.launcher_pid) || marker.launcher_pid <= 0 || marker.launcher_pid > 0xffff_ffff ||
    typeof marker.capture_token !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(marker.capture_token)
  ) {
    throw new Error("test-play recovery marker is invalid; refusing to load temporary config");
  }
  const absent = marker.original_config_base64 === null && marker.original_mode === null;
  const present = typeof marker.original_config_base64 === "string" &&
    Number.isInteger(marker.original_mode) && marker.original_mode >= 0 && marker.original_mode <= 0o777;
  if (!absent && !present) {
    throw new Error("test-play recovery marker fields are inconsistent");
  }
  if (present) {
    const originalBytes = Buffer.from(marker.original_config_base64, "base64");
    if (
      originalBytes.toString("base64") !== marker.original_config_base64 ||
      originalBytes.length > MAX_RECOVERY_CONFIG_BYTES
    ) {
      throw new Error("test-play recovery marker has invalid config bytes");
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(originalBytes);
    } catch {
      throw new Error("test-play recovery marker config is not UTF-8");
    }
  }
  return marker;
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function replaceFileAtomically(temporaryPath, destinationPath, directory) {
  await fs.rename(temporaryPath, destinationPath);
  await syncDirectory(directory);
}

export async function resolveCaptureOutputPath(outputPath, repositoryPath = repositoryRoot) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const [realParent, realRepository] = await Promise.all([
    fs.realpath(path.dirname(outputPath)),
    fs.realpath(repositoryPath),
  ]);
  const resolvedPath = path.join(realParent, path.basename(outputPath));
  if (isInside(realRepository, resolvedPath)) {
    throw new Error("capture output must resolve outside the repository");
  }
  return resolvedPath;
}

export function withCaptureConfig(content, outputPath, { tlsnCandidate = false } = {}) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const hasTrailingNewline = lines.at(-1) === "";
  if (hasTrailingNewline) {
    lines.pop();
  }
  const settingsBySection = new Map(temporarySettingsBySection);
  if (tlsnCandidate) {
    settingsBySection.set(
      "app.auth",
      new Map([
        ["deny_auth", "false"],
        ["allow_anonymous_auth_bootstrap", "false"],
        ["allow_pending_upload_retry", "false"],
      ]),
    );
    settingsBySection.set(
      "proxy.tlsn",
      new Map([
        ["enabled", "true"],
        ["candidate_capture_enabled", "true"],
        ["artifact_output_path", JSON.stringify(path.join(outputPath, "tlsn"))],
      ]),
    );
  }
  settingsBySection.set(
    "proxy",
    new Map([
      ...settingsBySection.get("proxy"),
      ["capture_enabled", "true"],
      [
        "capture_output_path",
        JSON.stringify(tlsnCandidate ? path.join(outputPath, "natural") : outputPath),
      ],
    ]),
  );
  const seenBySection = new Map(
    [...settingsBySection].map(([section]) => [section, new Set()]),
  );
  const updatedLines = [];
  let currentSection;

  const appendMissingSettings = (section) => {
    const settings = settingsBySection.get(section);
    const seen = seenBySection.get(section);
    if (!settings || !seen) {
      return;
    }
    for (const [name, value] of settings) {
      if (!seen.has(name)) {
        updatedLines.push(`${name} = ${value}`);
      }
    }
  };

  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      appendMissingSettings(currentSection);
      currentSection = section[1];
      updatedLines.push(line);
      continue;
    }

    const setting = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
    const settings = settingsBySection.get(currentSection);
    const seen = seenBySection.get(currentSection);
    if (setting && settings?.has(setting[1]) && seen) {
      seen.add(setting[1]);
      updatedLines.push(`${setting[1]} = ${settings.get(setting[1])}`);
      continue;
    }
    updatedLines.push(line);
  }
  appendMissingSettings(currentSection);

  for (const [section, settings] of settingsBySection) {
    if (seenBySection.get(section).size === 0) {
      updatedLines.push("", `[${section}]`);
      for (const [name, value] of settings) {
        updatedLines.push(`${name} = ${value}`);
      }
    }
  }
  return updatedLines.join(newline) + (hasTrailingNewline ? newline : "");
}

export async function restoreConfig(filePath, originalConfig) {
  if (originalConfig === null) {
    await fs.rm(filePath, { force: true });
  } else {
    await fs.writeFile(filePath, originalConfig, "utf8");
  }
}

export async function writeConfigRecoveryMarker(
  markerPath,
  originalConfig,
  originalMode,
  { launcherPid = process.pid, captureToken = randomUUID() } = {},
) {
  const parent = path.dirname(markerPath);
  await ensurePrivateDirectory(parent);
  let originalBytes = originalConfig === null
    ? null
    : Buffer.isBuffer(originalConfig)
      ? originalConfig
      : Buffer.from(originalConfig, "utf8");
  if (originalBytes && originalBytes.length > MAX_RECOVERY_CONFIG_BYTES) {
    throw new Error("user config exceeds the recovery limit");
  }
  if (
    !Number.isInteger(launcherPid) || launcherPid <= 0 || launcherPid > 0xffff_ffff ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(captureToken) ||
    !((originalBytes === null && originalMode === null) ||
      (originalBytes !== null && Number.isInteger(originalMode) && originalMode >= 0 && originalMode <= 0o777))
  ) {
    throw new Error("test-play recovery marker fields are invalid");
  }
  const marker = {
    schema_version: 2,
    original_config_base64: originalBytes === null
      ? null
      : originalBytes.toString("base64"),
    original_mode: originalMode,
    launcher_pid: launcherPid,
    capture_token: captureToken,
  };
  const handle = await fs.open(markerPath, "wx", 0o600);
  try {
    const stats = await handle.stat();
    assertCurrentUser(stats, "test-play recovery marker");
    if (!stats.isFile() || (process.platform !== "win32" && (stats.mode & 0o077) !== 0)) {
      throw new Error("test-play recovery marker permissions are invalid");
    }
    await handle.writeFile(`${JSON.stringify(marker)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(parent);
  return captureToken;
}

export async function recoverConfigFromMarker(
  configFilePath,
  markerPath,
  { authorizedToken, restoreActive = false } = {},
) {
  const parent = path.dirname(configFilePath);
  try {
    const parentStats = await fs.lstat(parent);
    assertPrivateDirectoryStats(parentStats, "test-play recovery parent");
  } catch (error) {
    if (error.code === "ENOENT") {
      try {
        await fs.lstat(markerPath);
      } catch (markerError) {
        if (markerError.code === "ENOENT") return false;
      }
    }
    throw error;
  }
  let markerBytes;
  try {
    markerBytes = await readRegularFile(markerPath, "test-play recovery marker", {
      privateFile: true,
      maximumBytes: MAX_RECOVERY_MARKER_BYTES,
    });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const marker = parseRecoveryMarker(markerBytes);
  if (authorizedToken !== undefined && authorizedToken !== marker.capture_token) {
    throw new Error("test-play recovery token is not authorized");
  }
  const authorized = authorizedToken !== undefined && authorizedToken === marker.capture_token;
  if (authorized && !restoreActive) {
    const configStats = await fs.lstat(configFilePath);
    if (!configStats.isFile() || configStats.isSymbolicLink()) {
      throw new Error("candidate temporary config must be a regular file");
    }
    assertCurrentUser(configStats, "candidate temporary config");
    return false;
  }
  if (isProcessRunning(marker.launcher_pid) && !authorized) {
    throw new Error("candidate capture launcher is active; refusing concurrent invocation");
  }

  let configSnapshot;
  try {
    configSnapshot = await fs.lstat(configFilePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (configSnapshot && (!configSnapshot.isFile() || configSnapshot.isSymbolicLink())) {
    throw new Error("temporary config must be a regular file during recovery");
  }
  if (configSnapshot) assertCurrentUser(configSnapshot, "temporary config");
  if (marker.original_config_base64 === null) {
    if (configSnapshot) {
      const latest = await fs.lstat(configFilePath);
      if (!sameFileIdentity(configSnapshot, latest) || !latest.isFile() || latest.isSymbolicLink()) {
        throw new Error("temporary config changed during recovery");
      }
      await fs.unlink(configFilePath);
      await syncDirectory(parent);
    }
  } else {
    const originalBytes = Buffer.from(marker.original_config_base64, "base64");
    const temporaryPath = path.join(parent, `${".configs.toml.restore-"}${randomUUID()}`);
    const output = await fs.open(temporaryPath, "wx", marker.original_mode);
    try {
      await output.writeFile(originalBytes);
      if (process.platform !== "win32") await output.chmod(marker.original_mode);
      await output.sync();
    } catch (error) {
      await output.close().catch(() => {});
      await fs.unlink(temporaryPath).catch(() => {});
      throw error;
    }
    await output.close();
    if (configSnapshot) {
      const latest = await fs.lstat(configFilePath);
      if (!sameFileIdentity(configSnapshot, latest) || !latest.isFile() || latest.isSymbolicLink()) {
        await fs.unlink(temporaryPath).catch(() => {});
        throw new Error("temporary config changed during recovery");
      }
    }
    await replaceFileAtomically(temporaryPath, configFilePath, parent);
  }
  for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
    if (
      !entry.name.startsWith(CAPTURE_TEMP_PREFIX) &&
      !entry.name.startsWith(RESTORE_TEMP_PREFIX) &&
      !entry.name.startsWith(MARKER_TEMP_PREFIX)
    ) continue;
    const tempPath = path.join(parent, entry.name);
    const suffix = entry.name.startsWith(CAPTURE_TEMP_PREFIX)
      ? entry.name.slice(CAPTURE_TEMP_PREFIX.length)
      : entry.name.startsWith(RESTORE_TEMP_PREFIX)
        ? entry.name.slice(RESTORE_TEMP_PREFIX.length)
        : entry.name.slice(MARKER_TEMP_PREFIX.length);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(suffix)) {
      throw new Error("orphan config temp has an invalid name");
    }
    const tempStats = await fs.lstat(tempPath);
    if (!tempStats.isFile() || tempStats.isSymbolicLink()) {
      throw new Error("orphan config temp must be a regular file");
    }
    assertCurrentUser(tempStats, "orphan config temp");
    await fs.unlink(tempPath);
  }
  await syncDirectory(parent);
  const latestMarker = await fs.lstat(markerPath);
  const openedMarker = await fs.stat(markerPath);
  if (!sameFileIdentity(latestMarker, openedMarker) || !latestMarker.isFile() || latestMarker.isSymbolicLink()) {
    throw new Error("test-play recovery marker changed during recovery");
  }
  await fs.unlink(markerPath);
  await syncDirectory(parent);
  return true;
}

export function waitForChildWithSignalForwarding(child, signalSource = process) {
  return new Promise((resolve, reject) => {
    const forwardSignal = (signal) => {
      if (child.exitCode === null) child.kill(signal);
    };
    const onInterrupt = () => forwardSignal("SIGINT");
    const onTerminate = () => forwardSignal("SIGTERM");
    const cleanup = () => {
      signalSource.removeListener("SIGINT", onInterrupt);
      signalSource.removeListener("SIGTERM", onTerminate);
    };
    signalSource.once("SIGINT", onInterrupt);
    signalSource.once("SIGTERM", onTerminate);
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      cleanup();
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

export async function prepareCaptureOutput(outputPath, { tlsnCandidate = false } = {}) {
  let stats;
  try {
    stats = await fs.lstat(outputPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (stats) {
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("capture output must be a real directory");
    }
    if (process.platform !== "win32") {
      if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
        throw new Error("capture output must be owned by the current user");
      }
      if ((stats.mode & 0o077) !== 0) {
        throw new Error("capture output permissions must be private (0700 or stricter)");
      }
    }
    if (tlsnCandidate && (await fs.readdir(outputPath)).length > 0) {
      throw new Error("TLSN candidate capture output must be an empty directory");
    }
  } else {
    if (tlsnCandidate) {
      await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
      await fs.mkdir(outputPath, { mode: 0o700 });
    } else {
      await fs.mkdir(outputPath, { recursive: true, mode: 0o700 });
    }
  }

  if (tlsnCandidate) {
    await fs.mkdir(path.join(outputPath, "natural"), { mode: 0o700 });
    await fs.mkdir(path.join(outputPath, "tlsn"), { mode: 0o700 });
  }
}

async function readOptional(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function runTauriDev(recoveryToken) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(command, [
    "tauri",
    "dev",
  ], {
      cwd: appRoot,
      env: { ...process.env, FUSOU_TESTPLAY_RECOVERY_TOKEN: recoveryToken },
      stdio: "inherit",
    });
  return waitForChildWithSignalForwarding(child);
}

function runAppPreflight(binaryPath, configPath, recoveryToken) {
  const result = spawnSync(
    binaryPath,
    ["--tlsn-preflight", "--config", configPath],
    {
      cwd: appRoot,
      env: runtimeEnvironment(process.env, recoveryToken),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error("actual APP binary returned a malformed pre-capture preflight report");
  }
  if (result.status !== 0) {
    const failedChecks = Array.isArray(report.checks)
      ? report.checks.filter((check) => check?.status === "error")
      : [];
    throw new Error(
      `actual APP binary failed pre-capture preflight: ${JSON.stringify(failedChecks)}`,
    );
  }
  return report;
}

async function runVerifiedApp(binaryPath, recoveryToken, configPath, startMarkerPath) {
  try {
    await fs.lstat(startMarkerPath);
    throw new Error("candidate APP start marker already exists");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const child = spawn(binaryPath, candidateAppLaunchArguments(configPath, startMarkerPath), {
    cwd: appRoot,
    env: runtimeEnvironment(process.env, recoveryToken),
    stdio: "inherit",
  });
  try {
    const exitCode = await waitForChildWithSignalForwarding(child);
    if (exitCode === 0) {
      await verifyCandidateAppStartMarker(startMarkerPath, configPath);
    }
    return exitCode;
  } finally {
    try {
      await fs.unlink(startMarkerPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function readPinnedReference(referencePath, expectedSha256) {
  const initialStats = await fs.lstat(referencePath);
  if (!initialStats.isFile() || initialStats.isSymbolicLink()) {
    throw new Error("approved Worker reference must be a regular non-symlink file");
  }
  assertCurrentUser(initialStats, "approved Worker reference");
  const opened = await openRegularFile(referencePath, "approved Worker reference", {
    maximumBytes: MAX_RECOVERY_MARKER_BYTES,
  });
  try {
    if (!sameFileIdentity(initialStats, opened.stats)) {
      throw new Error("approved Worker reference changed while opening");
    }
    const bytes = await opened.handle.readFile();
    if (sha256(bytes) !== expectedSha256) {
      throw new Error("approved Worker reference does not match the independent SHA-256 pin");
    }
    return bytes;
  } finally {
    await opened.handle.close();
  }
}

async function main() {
  await ensurePrivateDirectory(path.dirname(configPath));
  await recoverConfigFromMarker(configPath, recoveryMarkerPath);
  let options;
  try {
    options = parseTestplayArguments(process.argv.slice(2));
  } catch (error) {
    fail(error.message);
    return;
  }
  if (!options.outputPath || !path.isAbsolute(options.outputPath)) {
    fail("pass an absolute private capture directory");
    return;
  }

  const requestedOutputPath = path.resolve(options.outputPath);
  if (isInside(repositoryRoot, requestedOutputPath)) {
    fail("capture output must be outside the repository");
    return;
  }

  let outputPath;
  try {
    outputPath = await resolveCaptureOutputPath(requestedOutputPath);
    await prepareCaptureOutput(outputPath, { tlsnCandidate: options.tlsnCandidate });
  } catch (error) {
    fail(error.message);
    return;
  }

  let appBuild;
  let workerReferenceBytes;
  let workerReferencePath;
  if (options.tlsnCandidate) {
    try {
      workerReferencePath = path.resolve(options.workerReferencePath);
      if (!path.isAbsolute(options.buildOutputPath)) {
        throw new Error("--build-output must be an absolute path");
      }
      const realRepository = await fs.realpath(repositoryRoot);
      const referenceParent = await fs.realpath(path.dirname(workerReferencePath));
      workerReferencePath = path.join(referenceParent, path.basename(workerReferencePath));
      const buildOutputParent = await fs.realpath(path.dirname(options.buildOutputPath));
      const buildOutputPath = path.join(buildOutputParent, path.basename(options.buildOutputPath));
      if (isInside(realRepository, workerReferencePath) ||
          isInside(realRepository, buildOutputPath)) {
        throw new Error("Worker reference and APP build output must be outside the repository");
      }
      if (isInside(outputPath, buildOutputPath) || isInside(buildOutputPath, outputPath) ||
          isInside(outputPath, workerReferencePath) || isInside(workerReferencePath, outputPath) ||
          isInside(buildOutputPath, workerReferencePath) ||
          isInside(workerReferencePath, buildOutputPath)) {
        throw new Error("capture, reference, and APP build paths must be separate");
      }
      workerReferenceBytes = await readPinnedReference(
        workerReferencePath,
        options.expectedReferenceSha256,
      );
      const { buildApprovedApp } = await import(
        "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff.mjs"
      );
      appBuild = await buildApprovedApp({
        referencePath: workerReferencePath,
        expectedReferenceSha256: options.expectedReferenceSha256,
        expectedWorkerSha: options.expectedWorkerSha,
        expectedAppSha: options.expectedAppSha,
        outputDirectory: buildOutputPath,
        repositoryDirectory: repositoryRoot,
        toolchain: options.toolchain,
        profile: options.profile,
      });
    } catch (error) {
      fail(error.message);
      return;
    }
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  let originalStats;
  let originalBytes;
  try {
    originalStats = await fs.lstat(configPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (originalStats && (!originalStats.isFile() || originalStats.isSymbolicLink())) {
    throw new Error("user config must be a regular file before candidate capture");
  }
  if (originalStats) {
    assertCurrentUser(originalStats, "user config");
    const opened = await openRegularFile(configPath, "user config", {
      maximumBytes: MAX_RECOVERY_CONFIG_BYTES,
    });
    try {
      if (!sameFileIdentity(originalStats, opened.stats)) {
        throw new Error("user config changed while opening");
      }
      originalBytes = await opened.handle.readFile();
    } finally {
      await opened.handle.close();
    }
  } else {
    originalBytes = null;
  }
  if (originalBytes && originalBytes.length > MAX_RECOVERY_CONFIG_BYTES) {
    throw new Error("user config exceeds the recovery limit");
  }
  const originalConfig = originalBytes === null
    ? null
    : new TextDecoder("utf-8", { fatal: true }).decode(originalBytes);
  const originalMode = originalStats ? originalStats.mode & 0o777 : null;
  const baseConfig =
    originalConfig ?? new TextDecoder("utf-8", { fatal: true }).decode(
      await readRegularFile(defaultConfigPath, "default config", {
        maximumBytes: MAX_RECOVERY_CONFIG_BYTES,
        requireCurrentUser: false,
      }),
    );
  const updatedConfig = withCaptureConfig(baseConfig, outputPath, {
    tlsnCandidate: options.tlsnCandidate,
  });
  const recoveryToken = await writeConfigRecoveryMarker(
    recoveryMarkerPath,
    originalBytes,
    originalMode,
  );

  console.log(`Capture output: ${outputPath}`);
  if (options.tlsnCandidate) {
    console.log("TLSN candidate capture is enabled; its output remains OBSERVED_UNAPPROVED.");
    console.log("The approved Worker reference, compile inputs, and actual APP binary are verified before launch.");
    console.log("The APP must still pass live Worker, Auth, and registered-device checks; this report does not authorize gameplay.");
  }
  console.log(
    "Proxy persistence, app data uploads, and custom senders are disabled for this session only.",
  );
  if (options.tlsnCandidate) {
    console.log("Anonymous Auth bootstrap and pending retries are disabled; a saved Auth session may be refreshed.");
  }
  console.log(
    "Use only ordinary FUSOU-APP gameplay. Do not issue standalone requests, inject, replay, retry, or automate traffic.",
  );
  console.log(
    "Press Ctrl-C after the natural session; the original user config will be restored and gameplay readiness will remain unchanged.",
  );

  let exitCode = 1;
  const temporaryConfigPath = path.join(
    path.dirname(configPath),
    `${CAPTURE_TEMP_PREFIX}${randomUUID()}`,
  );
  try {
    const temporary = await fs.open(temporaryConfigPath, "wx", originalMode ?? 0o600);
    try {
      await temporary.writeFile(updatedConfig, "utf8");
      if (process.platform !== "win32") await temporary.chmod(originalMode ?? 0o600);
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    if (originalStats) {
      const latest = await fs.lstat(configPath);
      if (!sameFileIdentity(originalStats, latest) || !latest.isFile() || latest.isSymbolicLink()) {
        throw new Error("user config changed before candidate config replacement");
      }
    } else {
      try {
        await fs.lstat(configPath);
        throw new Error("user config appeared before candidate config replacement");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await replaceFileAtomically(temporaryConfigPath, configPath, path.dirname(configPath));
    if (options.tlsnCandidate) {
      const preflightReport = runAppPreflight(
        appBuild.artifactPath,
        configPath,
        recoveryToken,
      );
      const readiness = createPreCaptureReadiness({
        workerReferenceBytes,
        expectedReferenceSha256: options.expectedReferenceSha256,
        expectedWorkerSha: options.expectedWorkerSha,
        expectedAppSha: options.expectedAppSha,
        buildProfile: options.profile,
        configPath,
        appBuildRecord: appBuild.record,
        appPreflightReport: preflightReport,
      });
      const readinessPath = path.join(
        outputPath,
        "tlsn",
        "pre-capture-readiness-v1.json",
      );
      const readinessFile = await fs.open(readinessPath, "wx", 0o600);
      try {
        await readinessFile.writeFile(`${JSON.stringify(readiness, null, 2)}\n`, "utf8");
        await readinessFile.sync();
      } finally {
        await readinessFile.close();
      }
      await syncDirectory(path.dirname(readinessPath));

      const referenceAfterPreflight = await readPinnedReference(
        workerReferencePath,
        options.expectedReferenceSha256,
      );
      if (!referenceAfterPreflight.equals(workerReferenceBytes)) {
        throw new Error("approved Worker reference changed before APP launch");
      }
      const artifactStats = await fs.lstat(appBuild.artifactPath);
      if (!artifactStats.isFile() || artifactStats.isSymbolicLink() ||
          sha256(await fs.readFile(appBuild.artifactPath)) !== appBuild.record.artifact.sha256) {
        throw new Error("verified APP binary changed before testplay launch");
      }
      console.log(`Pre-capture local APP preflight: PASS (${readinessPath})`);
      console.log("Target identity remains NOT_YET_OBSERVED; gameplay authorization is not granted.");
      exitCode = await runVerifiedApp(
        appBuild.artifactPath,
        recoveryToken,
        configPath,
        path.join(outputPath, "tlsn", "app-started.json"),
      );
    } else {
      exitCode = await runTauriDev(recoveryToken);
    }
  } finally {
    await recoverConfigFromMarker(configPath, recoveryMarkerPath, {
      authorizedToken: recoveryToken,
      restoreActive: true,
    });
  }
  process.exitCode = exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`testplay:verify: ${error.message}`);
    process.exitCode = 1;
  });
}
