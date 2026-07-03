#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");

function fail(message, code = 1) {
  console.error(`[manage-attestation-secrets] ${message}`);
  process.exit(code);
}

function usage() {
  console.log("Usage:");
  console.log("  pnpm run manage-attestation-secrets -- <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  status [--env <name>] [--json]");
  console.log("  apply --env <name> [--config <json-or-@path>] [--confirm] [--json]");
  console.log("  bootstrap --env <name> [--out-dir <path>] [--config <json-or-@path>] [--update-app-public-key-env] [--confirm] [--json]");
  console.log("             [--tpm-chain <json-array-or-csv-or-@path>] [--tpm-handle <value>]");
  console.log("");
  console.log("Notes:");
  console.log("  - Reads INTEGRITY_* and ATTESTATION_CONFIG_JSON from process.env.");
  console.log("  - ATTESTATION_CONFIG_JSON must be explicitly provided (env or --config).");
  console.log("  - bootstrap generates local review artifacts: json, pem, csv.");
  console.log("  - use --update-app-public-key-env to sync APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY via dotenvx.");
  console.log("  - For real apply, run via dotenvx so encrypted .env values are loaded.");
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

function runNodeScript(scriptName, scriptArgs, options = {}) {
  const result = spawnSync("node", [resolve(WEB_ROOT, "scripts", scriptName), ...scriptArgs], {
    cwd: WEB_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
    ...options,
  });

  if (result.error) throw result.error;
  if (typeof result.status === "number" && result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    const merged = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(merged || `${scriptName} exited with status ${result.status}`);
  }

  return (result.stdout || "").trim();
}

function parseRootList(raw, label) {
  const text = String(raw ?? "").trim();
  if (!text) {
    throw new Error(`${label} is missing`);
  }

  let items;
  if (text.startsWith("[")) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be JSON array when starting with '['`);
    }
    items = parsed;
  } else {
    items = text.split(/[\s,]+/g).filter((v) => v.length > 0);
  }

  const normalized = [];
  const seen = new Set();
  for (const item of items) {
    const value = String(item).trim().toLowerCase().replace(/^0x/, "");
    if (!/^[a-f0-9]{64}$/.test(value)) {
      throw new Error(`${label} has invalid SHA-256 hash: ${item}`);
    }
    if (!seen.has(value)) {
      seen.add(value);
      normalized.push(value);
    }
  }

  normalized.sort();
  if (normalized.length === 0) {
    throw new Error(`${label} resolved to empty list`);
  }
  return normalized;
}

function parseTpmChainList(raw, label) {
  const text = String(raw ?? "").trim();
  if (!text) {
    throw new Error(`${label} is missing`);
  }

  let items;
  const source = text.startsWith("@")
    ? readFileSync(resolve(WEB_ROOT, text.slice(1)), "utf8").trim()
    : text;

  if (source.startsWith("[")) {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be JSON array when starting with '['`);
    }
    items = parsed;
  } else {
    items = source.split(/[\s,;]+/g).filter((v) => v.length > 0);
  }

  const normalized = [];
  for (const item of items) {
    const value = String(item).trim();
    if (!value) continue;
    try {
      Buffer.from(value, "base64");
    } catch {
      throw new Error(`${label} has invalid base64 certificate value`);
    }
    normalized.push(value);
  }

  if (normalized.length < 2) {
    throw new Error(`${label} must contain at least leaf and root certificates`);
  }

  return normalized;
}

function parsePersistentHandle(raw, label) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return null;
  }

  const parsed = /^0x/i.test(text)
    ? Number.parseInt(text.slice(2), 16)
    : Number.parseInt(text, 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} has invalid value: ${text}`);
  }
  if (((parsed >>> 24) & 0xff) !== 0x81) {
    throw new Error(`${label} is outside TPM persistent-handle range: ${text}`);
  }
  return /^0x/i.test(text) ? text.toLowerCase() : `0x${parsed.toString(16)}`;
}

function resolveAttestationConfigForBootstrap(parsed) {
  const raw = resolveConfigJson(parsed);
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error("ATTESTATION_CONFIG_JSON must be valid JSON object");
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("ATTESTATION_CONFIG_JSON must be JSON object");
  }

  if (!config.tpm) {
    const chainEnv =
      (parsed.values["tpm-chain"] && String(parsed.values["tpm-chain"]).trim()) ||
      process.env.FUSOU_TPM_AK_CERT_CHAIN_B64?.trim();
    if (!chainEnv) {
      throw new Error(
        "ATTESTATION_CONFIG_JSON.tpm is missing. Provide --config with tpm section, or pass --tpm-chain (or set FUSOU_TPM_AK_CERT_CHAIN_B64) before bootstrap.",
      );
    }

    const handleEnv =
      (parsed.values["tpm-handle"] && String(parsed.values["tpm-handle"]).trim()) ||
      process.env.FUSOU_TPM_AK_PERSISTENT_HANDLE?.trim() ||
      "0x81010001";
    config.tpm = {
      persistent_handle: parsePersistentHandle(handleEnv, "FUSOU_TPM_AK_PERSISTENT_HANDLE"),
      ak_cert_chain_b64: parseTpmChainList(chainEnv, "FUSOU_TPM_AK_CERT_CHAIN_B64/--tpm-chain"),
    };
  } else {
    const handle = parsePersistentHandle(
      config.tpm.persistent_handle,
      "ATTESTATION_CONFIG_JSON.tpm.persistent_handle",
    );
    const chain = parseTpmChainList(
      JSON.stringify(config.tpm.ak_cert_chain_b64 ?? []),
      "ATTESTATION_CONFIG_JSON.tpm.ak_cert_chain_b64",
    );
    config.tpm = {
      persistent_handle: handle || "0x81010001",
      ak_cert_chain_b64: chain,
    };
  }

  return JSON.stringify(config);
}

function resolveConfigJson(parsed) {
  const inlineOrFile = parsed.values.config ? String(parsed.values.config).trim() : "";
  if (inlineOrFile.length > 0) {
    if (inlineOrFile.startsWith("@")) {
      const filePath = resolve(WEB_ROOT, inlineOrFile.slice(1));
      return readFileSync(filePath, "utf8").trim();
    }
    return inlineOrFile;
  }

  const fromEnv = process.env.ATTESTATION_CONFIG_JSON?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }

  throw new Error(
    "ATTESTATION_CONFIG_JSON is missing. Set it via dotenvx or pass --config <json-or-@path>.",
  );
}

function runStatus(parsed) {
  const envName = parsed.values.env ? String(parsed.values.env).trim() : "";
  const asJson = parsed.flags.has("json");

  const signingKey = runNodeScript("manage-attestation-config-signing-key.mjs", [
    "status",
    ...(envName ? ["--env", envName] : []),
    "--json",
  ]);

  const configJson = runNodeScript("manage-attestation-config-json.mjs", [
    "status",
    ...(envName ? ["--env", envName] : []),
    "--json",
  ]);

  const roots = runNodeScript("manage-attestation-trusted-roots.mjs", [
    "status",
    ...(envName ? ["--env", envName] : []),
    "--json",
  ]);

  const payload = {
    ok: true,
    env: envName || null,
    signing_key: JSON.parse(signingKey),
    config_json: JSON.parse(configJson),
    trusted_roots: JSON.parse(roots),
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("[manage-attestation-secrets] status");
  console.log(`- env: ${envName || "(default)"}`);
  console.log(
    `- ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY: ${payload.signing_key.exists ? "registered" : "missing"}`,
  );
  console.log(
    `- ATTESTATION_CONFIG_JSON: ${payload.config_json.exists ? "registered" : "missing"}`,
  );
  console.log(
    `- INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256: ${payload.trusted_roots.registered.INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256 ? "registered" : "missing"}`,
  );
  console.log(
    `- INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256: ${payload.trusted_roots.registered.INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256 ? "registered" : "missing"}`,
  );
}

function runApply(parsed) {
  const envName = parsed.values.env ? String(parsed.values.env).trim() : "";
  const confirm = parsed.flags.has("confirm");
  const asJson = parsed.flags.has("json");

  if (!envName) {
    throw new Error("apply requires --env <name>");
  }

  const secureRoots = process.env.INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256?.trim();
  const tpmRoots = process.env.INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256?.trim();
  const configJson = resolveAttestationConfigForBootstrap(parsed);

  if (!secureRoots || !tpmRoots) {
    throw new Error(
      "INTEGRITY_* roots are missing in process.env. Run this command via dotenvx so encrypted .env values are loaded.",
    );
  }

  const modeArgs = confirm ? ["--confirm"] : [];

  const configResult = runNodeScript("manage-attestation-config-json.mjs", [
    "apply",
    "--config",
    configJson,
    "--env",
    envName,
    ...modeArgs,
    "--json",
  ]);

  const rootsResult = runNodeScript("manage-attestation-trusted-roots.mjs", [
    "apply",
    "--secure",
    secureRoots,
    "--tpm",
    tpmRoots,
    "--env",
    envName,
    ...modeArgs,
    "--json",
  ]);

  const payload = {
    ok: true,
    env: envName,
    mode: confirm ? "applied" : "dry-run",
    config_result: JSON.parse(configResult),
    roots_result: JSON.parse(rootsResult),
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`[manage-attestation-secrets] ${payload.mode}`);
  console.log(`- env: ${envName}`);
  console.log(`- ATTESTATION_CONFIG_JSON: ${payload.mode}`);
  console.log(`- INTEGRITY_* trusted roots: ${payload.mode}`);
}

function runBootstrap(parsed) {
  const envName = parsed.values.env ? String(parsed.values.env).trim() : "";
  const confirm = parsed.flags.has("confirm");
  const asJson = parsed.flags.has("json");
  const outDirArg = parsed.values["out-dir"]
    ? String(parsed.values["out-dir"]).trim()
    : `/tmp/fusou-attestation-secrets-${envName || "default"}`;
  const updateAppPublicKeyEnv = parsed.flags.has("update-app-public-key-env");

  if (!envName) {
    throw new Error("bootstrap requires --env <name>");
  }

  const configJson = resolveAttestationConfigForBootstrap(parsed);
  const secureRoots = parseRootList(
    process.env.INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256,
    "INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256",
  );
  const tpmRoots = parseRootList(
    process.env.INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256,
    "INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256",
  );

  const outDir = resolve(WEB_ROOT, outDirArg);
  mkdirSync(outDir, { recursive: true });

  const privatePemPath = resolve(outDir, "attestation-config-signing-private.pem");
  const publicB64Path = resolve(outDir, "attestation-config-signing-public.b64");

  const keygenResult = runNodeScript("manage-attestation-config-signing-key.mjs", [
    "generate",
    "--private-out",
    privatePemPath,
    "--public-out",
    publicB64Path,
    "--json",
  ]);

  const keyPayload = JSON.parse(keygenResult);

  const configPath = resolve(outDir, "attestation-config.json");
  const secureCsvPath = resolve(outDir, "integrity-secure-enclave-trusted-roots.csv");
  const tpmCsvPath = resolve(outDir, "integrity-tpm-ak-trusted-roots.csv");
  const metadataPath = resolve(outDir, "attestation-secrets.metadata.json");

  writeFileSync(configPath, `${configJson}\n`, "utf8");
  writeFileSync(secureCsvPath, `${secureRoots.join(",")}\n`, "utf8");
  writeFileSync(tpmCsvPath, `${tpmRoots.join(",")}\n`, "utf8");
  writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        env: envName,
        public_key_base64: keyPayload.public_key_base64,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const modeArgs = confirm ? ["--confirm"] : [];

  const signingApply = runNodeScript("manage-attestation-config-signing-key.mjs", [
    "apply",
    "--private-pem",
    `@${privatePemPath}`,
    "--env",
    envName,
    ...modeArgs,
    "--json",
  ]);

  const configApply = runNodeScript("manage-attestation-config-json.mjs", [
    "apply",
    "--config",
    `@${configPath}`,
    "--env",
    envName,
    ...modeArgs,
    "--json",
  ]);

  const rootsApply = runNodeScript("manage-attestation-trusted-roots.mjs", [
    "apply",
    "--secure",
    `@${secureCsvPath}`,
    "--tpm",
    `@${tpmCsvPath}`,
    "--env",
    envName,
    ...modeArgs,
    "--json",
  ]);

  let appEnvUpdate = null;
  if (updateAppPublicKeyEnv) {
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "dotenvx",
        "set",
        "APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY",
        keyPayload.public_key_base64,
        "-f",
        "packages/FUSOU-APP/src-tauri/.env",
        "-fk",
        "packages/.env.keys",
      ],
      {
        cwd: resolve(WEB_ROOT, "..", ".."),
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf8",
      },
    );

    if (result.error || result.status !== 0) {
      const stderr = (result.stderr || "").trim();
      const stdout = (result.stdout || "").trim();
      const merged = [stderr, stdout].filter(Boolean).join("\n");
      throw new Error(
        `failed to update APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY via dotenvx: ${merged || "unknown error"}`,
      );
    }

    appEnvUpdate = {
      ok: true,
      path: "packages/FUSOU-APP/src-tauri/.env",
      key: "APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY",
    };
  }

  const payload = {
    ok: true,
    env: envName,
    mode: confirm ? "applied" : "dry-run",
    generated: {
      out_dir: outDir,
      private_pem: privatePemPath,
      public_b64: publicB64Path,
      config_json: configPath,
      secure_csv: secureCsvPath,
      tpm_csv: tpmCsvPath,
      metadata_json: metadataPath,
    },
    signing_apply: JSON.parse(signingApply),
    config_apply: JSON.parse(configApply),
    roots_apply: JSON.parse(rootsApply),
    app_public_key_update: appEnvUpdate,
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`[manage-attestation-secrets] ${payload.mode}`);
  console.log(`- env: ${envName}`);
  console.log(`- generated review files under: ${outDir}`);
  console.log("- generated: attestation-config.json, attestation-config-signing-private.pem, attestation-config-signing-public.b64, integrity-*.csv");
  console.log("- applied: ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY, ATTESTATION_CONFIG_JSON, INTEGRITY_* roots");
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const cmd = parsed.positionals.find((item) => item !== "--");

  if (!cmd || cmd === "help" || cmd === "--help") {
    usage();
    return;
  }

  if (cmd === "status") {
    runStatus(parsed);
    return;
  }

  if (cmd === "apply") {
    runApply(parsed);
    return;
  }

  if (cmd === "bootstrap") {
    runBootstrap(parsed);
    return;
  }

  fail(`unknown command: ${cmd}`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
