import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

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
const outputArgument =
  scriptArguments[0] ?? process.env.FUSOU_CAPTURE_OUTPUT_PATH;
const temporaryProxySettings = new Map([
  ["allow_save_api_requests", "false"],
  ["allow_save_api_responses", "false"],
  ["allow_save_resources", "false"],
  ["allow_save_main_js_local", "false"],
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

function withCaptureConfig(content, outputPath) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let inProxySection = false;
  let proxySectionFound = false;
  let proxySectionEnd = lines.length;
  const seenSettings = new Set();
  const settings = new Map(temporaryProxySettings);
  settings.set("capture_enabled", "true");
  settings.set("capture_output_path", JSON.stringify(outputPath));

  const updatedLines = lines.map((line, index) => {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      if (section[1] === "proxy") {
        proxySectionFound = true;
        inProxySection = true;
      } else if (inProxySection) {
        proxySectionEnd = index;
        inProxySection = false;
      }
    }
    if (!inProxySection) {
      return line;
    }
    const setting = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
    if (setting && settings.has(setting[1])) {
      seenSettings.add(setting[1]);
      return `${setting[1]} = ${settings.get(setting[1])}`;
    }
    return line;
  });

  if (!proxySectionFound) {
    throw new Error("the user config does not contain a [proxy] section");
  }
  const missingSettings = [...settings]
    .filter(([name]) => !seenSettings.has(name))
    .map(([name, value]) => `${name} = ${value}`);
  updatedLines.splice(proxySectionEnd, 0, ...missingSettings);
  return updatedLines.join(newline);
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
    const child = spawn(command, ["tauri", "dev"], {
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
  if (!outputArgument || !path.isAbsolute(outputArgument)) {
    fail(
      "pass a private absolute capture directory: pnpm testplay:verify -- /absolute/private/path",
    );
    return;
  }

  const outputPath = path.resolve(outputArgument);
  if (isInside(repositoryRoot, outputPath)) {
    fail("capture output must be outside the repository");
    return;
  }

  await fs.mkdir(outputPath, { recursive: true });
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const originalConfig = await readOptional(configPath);
  const baseConfig =
    originalConfig ?? (await fs.readFile(defaultConfigPath, "utf8"));
  const updatedConfig = withCaptureConfig(baseConfig, outputPath);
  await fs.writeFile(configPath, updatedConfig, "utf8");

  console.log(`Capture output: ${outputPath}`);
  console.log(
    "API/resource persistence and asset upload are disabled for this session only.",
  );
  console.log(
    "Use only ordinary FUSOU-APP gameplay. Do not issue standalone requests, inject, replay, retry, or automate traffic.",
  );
  console.log(
    "Press Ctrl-C after the natural session; the original user config will be restored.",
  );

  let exitCode = 1;
  try {
    exitCode = await runTauriDev();
  } finally {
    if (originalConfig === null) {
      await fs.rm(configPath, { force: true });
    } else {
      await fs.writeFile(configPath, originalConfig, "utf8");
    }
  }
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(`testplay:verify: ${error.message}`);
  process.exitCode = 1;
});
