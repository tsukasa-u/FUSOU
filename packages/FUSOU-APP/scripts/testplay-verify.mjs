import { spawn } from "node:child_process";
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
  [
    "app.auth",
    new Map([
      ["deny_auth", "true"],
      ["allow_anonymous_auth_bootstrap", "true"],
      ["allow_pending_upload_retry", "true"],
    ]),
  ],
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

function runTauriDev() {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return new Promise((resolve, reject) => {
    const child = spawn(command, [
      "tauri",
      "dev",
      ...(tlsnCandidateMode ? ["--features", "tlsn-production"] : []),
    ], {
      cwd: appRoot,
      env: process.env,
      stdio: "inherit",
    });
    const forwardSignal = (signal) => {
      if (child.exitCode === null) {
        child.kill(signal);
      }
    };
    const onInterrupt = () => forwardSignal("SIGINT");
    const onTerminate = () => forwardSignal("SIGTERM");
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    child.once("error", (error) => {
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
      reject(error);
    });
    child.once("close", (code, signal) => {
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

async function main() {
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
  const originalConfig = await readOptional(configPath);
  const baseConfig =
    originalConfig ?? (await fs.readFile(defaultConfigPath, "utf8"));
  const updatedConfig = withCaptureConfig(baseConfig, outputPath, {
    tlsnCandidate: tlsnCandidateMode,
  });
  await fs.writeFile(configPath, updatedConfig, "utf8");

  console.log(`Capture output: ${outputPath}`);
  if (tlsnCandidateMode) {
    console.log("TLSN candidate capture is enabled; its output remains OBSERVED_UNAPPROVED.");
    console.log("A valid existing FUSOU auth session and TLSN production configuration are required.");
  }
  console.log(
    "Proxy persistence, app data uploads, custom senders, auth bootstrap, and pending retries are disabled for this session only.",
  );
  console.log(
    "Use only ordinary FUSOU-APP gameplay. Do not issue standalone requests, inject, replay, retry, or automate traffic.",
  );
  console.log(
    "Press Ctrl-C after the natural session; the original user config will be restored and gameplay readiness will remain unchanged.",
  );

  let exitCode = 1;
  try {
    exitCode = await runTauriDev();
  } finally {
    await restoreConfig(configPath, originalConfig);
  }
  process.exitCode = exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`testplay:verify: ${error.message}`);
    process.exitCode = 1;
  });
}
