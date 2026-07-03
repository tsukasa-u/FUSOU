#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const WRANGLER_COMMAND = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
const SECRET_NAME = "ATTESTATION_CONFIG_JSON";
const MAX_RESPONSE_BYTES = 128 * 1024;

function usage() {
  console.log("Usage:");
  console.log("  pnpm run manage-attestation-config-json -- <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  validate --config <json-or-@path>");
  console.log("  print    --config <json-or-@path>");
  console.log("  apply    --config <json-or-@path> [--env <name>] [--confirm] [--json]");
  console.log("  status   [--env <name>] [--json]");
  console.log("");
  console.log("Options:");
  console.log("  --config <json-or-@path>  JSON object text or @path to file");
  console.log("  --env <name>              Wrangler environment name");
  console.log("  --confirm                 Actually write secret (default: dry-run)");
  console.log("  --json                    JSON output");
}

function fail(message, code = 1) {
  console.error(`[attestation-config-json] ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const values = {};
  const flags = new Set();
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const eq = token.indexOf("=");
    if (eq !== -1) {
      values[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      values[key] = next;
      i += 1;
    } else {
      flags.add(key);
    }
  }

  return { values, flags, positionals };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: WEB_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
    encoding: "utf8",
    ...options,
  });

  if (result.error) throw result.error;
  if (typeof result.status === "number" && result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    const merged = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(merged || `${command} exited with status ${result.status}`);
  }

  return result.stdout || "";
}

function parseConfigInput(rawInput) {
  if (typeof rawInput !== "string" || rawInput.trim().length === 0) {
    throw new Error("--config is required");
  }

  const text = rawInput.trim().startsWith("@")
    ? readFileSync(resolve(WEB_ROOT, rawInput.trim().slice(1)), "utf8")
    : rawInput;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `failed to parse config JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("config must be a JSON object");
  }

  return parsed;
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function parseRfc3339(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be RFC3339 timestamp`);
  }
  return date;
}

function parseHandle(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (/^0x/i.test(trimmed)) {
    return Number.parseInt(trimmed.slice(2), 16);
  }
  if (/^[0-9]+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  return NaN;
}

function validateConfigObject(config) {
  if (!Number.isInteger(config.version) || config.version < 0) {
    throw new Error("version must be an integer >= 0");
  }

  const issuedAt = parseRfc3339(config.issued_at, "issued_at");
  const expiresAt = parseRfc3339(config.expires_at, "expires_at");
  if (issuedAt.getTime() > expiresAt.getTime()) {
    throw new Error("issued_at must be <= expires_at");
  }

  if (
    config.attestation_required !== undefined &&
    typeof config.attestation_required !== "boolean"
  ) {
    throw new Error("attestation_required must be boolean when provided");
  }

  if (config.tpm !== undefined) {
    if (!config.tpm || typeof config.tpm !== "object" || Array.isArray(config.tpm)) {
      throw new Error("tpm must be an object when provided");
    }

    if (config.tpm.persistent_handle !== undefined) {
      const parsed = parseHandle(config.tpm.persistent_handle);
      if (!Number.isInteger(parsed)) {
        throw new Error("tpm.persistent_handle is invalid");
      }
      if (((parsed >>> 24) & 0xff) !== 0x81) {
        throw new Error("tpm.persistent_handle is outside TPM persistent range");
      }
    }

    if (config.tpm.ak_cert_chain_b64 !== undefined) {
      if (!Array.isArray(config.tpm.ak_cert_chain_b64)) {
        throw new Error("tpm.ak_cert_chain_b64 must be an array when provided");
      }
      if (config.tpm.ak_cert_chain_b64.length < 2) {
        throw new Error("tpm.ak_cert_chain_b64 must contain at least leaf and root");
      }

      for (let i = 0; i < config.tpm.ak_cert_chain_b64.length; i += 1) {
        const item = config.tpm.ak_cert_chain_b64[i];
        if (typeof item !== "string" || item.trim().length === 0) {
          throw new Error(`tpm.ak_cert_chain_b64[${i}] must be a non-empty string`);
        }
        try {
          Buffer.from(item.trim(), "base64");
        } catch {
          throw new Error(`tpm.ak_cert_chain_b64[${i}] must be base64`);
        }
      }
    }
  }

  const canonical = canonicalize(config);
  const bytes = Buffer.byteLength(canonical, "utf8");
  if (bytes > MAX_RESPONSE_BYTES) {
    throw new Error(`canonical JSON too large: ${bytes} bytes (max ${MAX_RESPONSE_BYTES})`);
  }

  return { canonical, bytes };
}

function parseSecretNames(rawOutput) {
  const text = rawOutput.trim();
  if (!text) throw new Error("wrangler returned empty output");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("[");
    if (start === -1) throw new Error("unable to parse wrangler secret list output");
    parsed = JSON.parse(text.slice(start));
  }

  if (!Array.isArray(parsed)) throw new Error("wrangler output is not an array");
  return parsed
    .map((entry) => entry?.name)
    .filter((name) => typeof name === "string" && name.length > 0);
}

function cmdStatus(parsed) {
  const envName = parsed.values.env ? String(parsed.values.env).trim() : "";
  const asJson = parsed.flags.has("json");

  const args = ["secret", "list", "--format", "json"];
  if (envName) args.push("--env", envName);

  const names = new Set(parseSecretNames(run(WRANGLER_COMMAND, args)));
  const exists = names.has(SECRET_NAME);

  if (asJson) {
    console.log(JSON.stringify({ ok: true, env: envName || null, secret: SECRET_NAME, exists }, null, 2));
    return;
  }

  console.log("[attestation-config-json] status");
  console.log(`- env: ${envName || "(default)"}`);
  console.log(`- ${SECRET_NAME}: ${exists ? "registered" : "missing"}`);
}

function cmdValidateOrPrint(parsed, mode) {
  const config = parseConfigInput(parsed.values.config);
  const { canonical, bytes } = validateConfigObject(config);

  if (parsed.flags.has("json")) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode,
          size_bytes: bytes,
          canonical_json: mode === "print" ? canonical : undefined,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (mode === "validate") {
    console.log("[attestation-config-json] valid");
    console.log(`- canonical size: ${bytes} bytes`);
    return;
  }

  process.stdout.write(`${canonical}\n`);
}

function cmdApply(parsed) {
  const config = parseConfigInput(parsed.values.config);
  const { canonical, bytes } = validateConfigObject(config);

  const envName = parsed.values.env ? String(parsed.values.env).trim() : "";
  const confirm = parsed.flags.has("confirm");
  const asJson = parsed.flags.has("json");

  if (confirm && !envName) {
    throw new Error("--env is required when --confirm is specified");
  }

  if (!confirm) {
    if (asJson) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "dry-run",
            env: envName || null,
            secret: SECRET_NAME,
            size_bytes: bytes,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log("[attestation-config-json] dry-run");
    console.log(`- would update ${SECRET_NAME}${envName ? ` (env=${envName})` : ""}`);
    console.log(`- canonical size: ${bytes} bytes`);
    console.log("- add --confirm to apply");
    return;
  }

  const args = ["secret", "put", SECRET_NAME, "--env", envName];
  run(WRANGLER_COMMAND, args, { input: `${canonical}\n` });

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "applied",
          env: envName,
          secret: SECRET_NAME,
          size_bytes: bytes,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("[attestation-config-json] applied");
  console.log(`- updated ${SECRET_NAME} (env=${envName})`);
  console.log(`- canonical size: ${bytes} bytes`);
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const cmd = parsed.positionals.find((item) => item !== "--");

  if (!cmd || cmd === "help" || cmd === "--help") {
    usage();
    return;
  }

  if (cmd === "status") {
    cmdStatus(parsed);
    return;
  }

  if (cmd === "validate") {
    cmdValidateOrPrint(parsed, "validate");
    return;
  }

  if (cmd === "print") {
    cmdValidateOrPrint(parsed, "print");
    return;
  }

  if (cmd === "apply") {
    cmdApply(parsed);
    return;
  }

  fail(`unknown command: ${cmd}`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
