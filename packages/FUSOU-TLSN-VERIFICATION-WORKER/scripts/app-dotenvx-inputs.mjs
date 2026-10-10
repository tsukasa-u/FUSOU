import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import {
  APP_PUBLIC_CONFIGURATION_CONTRACT, publicAppConfigurationSha256, validatePublicAppInputs,
} from "./app-public-configuration.mjs";

const require = createRequire(import.meta.url);
const dotenvxVersion = require("@dotenvx/dotenvx/package.json").version;
const digest = (bytes) => createHash("sha256").update(bytes).digest("base64url");

export function publicToolEnvironment(environment) {
  const result = {};
  for (const name of ["PATH", "HOME", "USER", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot",
    "TMP", "TEMP", "TMPDIR", "RUSTUP_HOME", "CARGO_HOME", "CARGO_NET_OFFLINE", "RUSTUP_AUTO_INSTALL"]) {
    if (environment[name] !== undefined) result[name] = environment[name];
  }
  return result;
}

async function snapshot(path, label) {
  let stat;
  let bytes;
  try {
    stat = await lstat(path, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    bytes = await readFile(path);
  } catch {
    throw new Error(`canonical dotenvx input file is unavailable or not regular: ${label}`);
  }
  return {
    path, label, sha256: digest(bytes),
    identity: [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":"),
  };
}

async function loadInWorker(envFiles, envKeysFile, environment) {
  const workerEnvironment = publicToolEnvironment(environment);
  // dotenvx resolves decryption keys from process.env before -fk; preserve that rule only here.
  for (const [name, value] of Object.entries(environment)) {
    if (/^DOTENV_(?:PRIVATE|PUBLIC)_KEY(?:_[A-Z0-9_]+)?$/.test(name)) workerEnvironment[name] = value;
  }
  const inputNames = APP_PUBLIC_CONFIGURATION_CONTRACT.compile_inputs;
  const publicEnvironment = Object.fromEntries(inputNames
    .filter((name) => environment[name] !== undefined).map((name) => [name, environment[name]]));
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(new URL("./app-dotenvx-loader-worker.mjs", import.meta.url), {
      workerData: { envFiles, envKeysFile, inputNames, publicEnvironment },
      env: workerEnvironment, execArgv: [], stdout: true, stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    const timeout = setTimeout(() => finish(new Error("canonical dotenvx loader timed out")), 10_000);
    function finish(error, payload) {
      clearTimeout(timeout);
      void worker.terminate();
      if (error) reject(error); else resolvePromise(payload);
    }
    worker.once("message", (message) => {
      if (!message || Object.keys(message).length !== 1 || !message.public_inputs ||
          JSON.stringify(Object.keys(message.public_inputs).sort()) !== JSON.stringify(inputNames)) {
        finish(new Error("canonical dotenvx loading/decryption failed"));
      } else {
        finish(null, message.public_inputs);
      }
    });
    worker.once("error", () => finish(new Error("canonical dotenvx loader failed")));
    worker.once("exit", () => finish(new Error("canonical dotenvx loader exited before input acquisition")));
  });
}

export async function loadCanonicalAppDotenvx(appDirectory, environment = process.env) {
  const contract = APP_PUBLIC_CONFIGURATION_CONTRACT.dotenvx;
  let script;
  try {
    script = JSON.parse(await readFile(resolve(appDirectory, "package.json"), "utf8")).scripts?.tauri;
  } catch {
    throw new Error("normal APP dotenvx script cannot be read");
  }
  if (script !== contract.normal_script) throw new Error("normal APP dotenvx file/precedence contract changed");
  const labels = [contract.env_keys_file, ...contract.env_files];
  const initial = await Promise.all(labels.map((label) => snapshot(resolve(appDirectory, label), label)));
  async function assertUnchanged() {
    const latest = await Promise.all(initial.map((file) => snapshot(file.path, file.label)));
    if (latest.some((file, index) => file.sha256 !== initial[index].sha256 || file.identity !== initial[index].identity)) {
      throw new Error("canonical dotenvx files changed during APP build");
    }
  }
  const inputs = validatePublicAppInputs(await loadInWorker(initial.slice(1).map((file) => file.path), initial[0].path, environment));
  publicAppConfigurationSha256(inputs);
  await assertUnchanged();
  return {
    inputs, assertUnchanged,
    reference: {
      schema_version: 1, scope: "fusou-app-canonical-dotenvx-input-reference",
      dotenvx_version: dotenvxVersion, env_keys_file: contract.env_keys_file,
      env_files: initial.slice(1).map((file) => ({ path: file.label, sha256: file.sha256 })),
      overload: true, strict: true,
    },
  };
}
