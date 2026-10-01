import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const scriptArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--");
const tlsnCandidateMode = scriptArguments.includes("--tlsn-candidate");
const positionalArguments = scriptArguments.filter(
  (argument) => argument !== "--tlsn-candidate",
);
const outputArgument = positionalArguments[0] ?? process.env.FUSOU_CAPTURE_OUTPUT_PATH;
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
      ...(tlsnCandidateMode ? ["--features", "tlsn-production"] : []),
    ], {
      cwd: appRoot,
      env: { ...process.env, FUSOU_TESTPLAY_RECOVERY_TOKEN: recoveryToken },
      stdio: "inherit",
    });
  return waitForChildWithSignalForwarding(child);
}

async function main() {
  await ensurePrivateDirectory(path.dirname(configPath));
  await recoverConfigFromMarker(configPath, recoveryMarkerPath);
  if (positionalArguments.length > 1 || scriptArguments.some((argument) => argument.startsWith("--") && argument !== "--tlsn-candidate")) {
    fail("usage: pnpm testplay:verify -- [--tlsn-candidate] /absolute/private/path");
    return;
  }
  if (!outputArgument || !path.isAbsolute(outputArgument)) {
    fail(
      "pass a private absolute capture directory: pnpm testplay:verify -- [--tlsn-candidate] /absolute/private/path",
    );
    return;
  }

  const requestedOutputPath = path.resolve(outputArgument);
  if (isInside(repositoryRoot, requestedOutputPath)) {
    fail("capture output must be outside the repository");
    return;
  }

  let outputPath;
  try {
    outputPath = await resolveCaptureOutputPath(requestedOutputPath);
    await prepareCaptureOutput(outputPath, { tlsnCandidate: tlsnCandidateMode });
  } catch (error) {
    fail(error.message);
    return;
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
    tlsnCandidate: tlsnCandidateMode,
  });
  const recoveryToken = await writeConfigRecoveryMarker(
    recoveryMarkerPath,
    originalBytes,
    originalMode,
  );

  console.log(`Capture output: ${outputPath}`);
  if (tlsnCandidateMode) {
    console.log("TLSN candidate capture is enabled; its output remains OBSERVED_UNAPPROVED.");
    console.log("A valid existing FUSOU auth session and TLSN production configuration are required.");
  }
  console.log(
    "Proxy persistence, app data uploads, and custom senders are disabled for this session only.",
  );
  if (tlsnCandidateMode) {
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
    exitCode = await runTauriDev(recoveryToken);
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
