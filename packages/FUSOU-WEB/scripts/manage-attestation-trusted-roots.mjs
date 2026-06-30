#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const WRANGLER_COMMAND =
  process.platform === "win32" ? "wrangler.cmd" : "wrangler";

const VAR_SECURE = "INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256";
const VAR_TPM = "INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256";
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function printUsage() {
  console.log("Usage:");
  console.log(
    "  pnpm run manage-attestation-trusted-roots -- <command> [options]",
  );
  console.log("");
  console.log("Commands:");
  console.log("  status");
  console.log("  apply");
  console.log("  rotate-stage");
  console.log("  rotate-final");
  console.log("");
  console.log("Common options:");
  console.log("  --env <name>            Wrangler environment (required when --confirm)");
  console.log("  --confirm               Apply changes (default is dry-run)");
  console.log("  --json                  Print JSON output");
  console.log("");
  console.log("Root list input format:");
  console.log("  - JSON array text: '[\"<sha256>\",\"<sha256>\"]'");
  console.log("  - CSV/space/newline separated hex values");
  console.log("  - @file-path to read from file");
  console.log("");
  console.log("apply options:");
  console.log(`  --secure <list>         Value for ${VAR_SECURE}`);
  console.log(`  --tpm <list>            Value for ${VAR_TPM}`);
  console.log("  --allow-empty           Allow empty list []");
  console.log("");
  console.log("rotate-stage options (new+old coexist):");
  console.log("  --current-secure <list> --next-secure <list>");
  console.log("  --current-tpm <list>    --next-tpm <list>");
  console.log("  --allow-empty           Allow empty list []");
  console.log("");
  console.log("rotate-final options (remove old roots):");
  console.log("  --next-secure <list>");
  console.log("  --next-tpm <list>");
  console.log("  --allow-empty           Allow empty list []");
}

function fail(message, code = 1) {
  console.error(`[attestation-trusted-roots] ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const values = {};
  const flags = new Set();
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      continue;
    }

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex !== -1) {
      const key = token.slice(2, eqIndex);
      values[key] = token.slice(eqIndex + 1);
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

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    const merged = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(merged || `${command} exited with status ${result.status}`);
  }

  return result.stdout || "";
}

function normalizeHash(raw, label) {
  const trimmed = String(raw ?? "").trim().toLowerCase().replace(/^0x/, "");
  if (!HASH_PATTERN.test(trimmed)) {
    throw new Error(
      `${label}: invalid SHA-256 hash '${raw}'. Expected 64 lowercase/uppercase hex chars.`,
    );
  }
  return trimmed;
}

function readListInput(raw) {
  if (raw == null) {
    return null;
  }

  const text = String(raw).trim();
  if (text.startsWith("@")) {
    const filePath = resolve(WEB_ROOT, text.slice(1));
    return readFileSync(filePath, "utf8");
  }

  return text;
}

function parseRootList(raw, label) {
  const input = readListInput(raw);
  if (input == null) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  let items;
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        throw new Error("JSON input must be an array");
      }
      items = parsed;
    } catch (error) {
      throw new Error(
        `${label}: failed to parse JSON array (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
  } else {
    items = trimmed.split(/[\s,]+/g).filter((part) => part.length > 0);
  }

  const normalized = [];
  const seen = new Set();
  for (const item of items) {
    const hash = normalizeHash(item, label);
    if (!seen.has(hash)) {
      seen.add(hash);
      normalized.push(hash);
    }
  }

  normalized.sort();
  return normalized;
}

function mergeRootLists(...lists) {
  const out = new Set();
  for (const list of lists) {
    for (const item of list ?? []) {
      out.add(item);
    }
  }
  return Array.from(out).sort();
}

function shortPreview(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return "(empty)";
  }
  return list.map((item) => `${item.slice(0, 12)}...`).join(", ");
}

function parseSecretNames(rawOutput) {
  const text = rawOutput.trim();
  if (!text) {
    throw new Error("wrangler returned empty output");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("[");
    if (start === -1) {
      throw new Error("unable to parse wrangler secret list JSON output");
    }
    parsed = JSON.parse(text.slice(start));
  }

  if (!Array.isArray(parsed)) {
    throw new Error("wrangler secret list output is not an array");
  }

  return parsed
    .map((entry) => entry?.name)
    .filter((name) => typeof name === "string" && name.length > 0);
}

function ensureApplyEnv(parsed) {
  const envName = parsed.values.env ? String(parsed.values.env).trim() : "";
  if (parsed.flags.has("confirm") && !envName) {
    throw new Error("--env is required when --confirm is specified.");
  }
  return envName || null;
}

function validateNonEmptyList(list, label, allowEmpty) {
  if (allowEmpty) {
    return;
  }
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${label}: empty list is not allowed without --allow-empty.`);
  }
}

function putSecret({ name, value, envName, confirm }) {
  const args = ["secret", "put", name];
  if (envName) {
    args.push("--env", envName);
  }

  if (!confirm) {
    return {
      name,
      env: envName,
      mode: "dry-run",
      value,
    };
  }

  run(WRANGLER_COMMAND, args, { input: `${value}\n` });
  return {
    name,
    env: envName,
    mode: "applied",
    value,
  };
}

function emitResult({ asJson, title, operations }) {
  if (asJson) {
    console.log(JSON.stringify({ ok: true, title, operations }, null, 2));
    return;
  }

  console.log(`[attestation-trusted-roots] ${title}`);
  for (const op of operations) {
    const list = JSON.parse(op.value);
    console.log(
      `- ${op.mode}: ${op.name}${op.env ? ` (env=${op.env})` : ""} count=${list.length}`,
    );
    console.log(`  preview: ${shortPreview(list)}`);
  }
}

function extractApplyLists(parsed) {
  const allowEmpty = parsed.flags.has("allow-empty");
  const secure = parseRootList(parsed.values.secure, "--secure");
  const tpm = parseRootList(parsed.values.tpm, "--tpm");

  if (secure == null && tpm == null) {
    throw new Error("apply requires --secure and/or --tpm.");
  }

  if (secure != null) {
    validateNonEmptyList(secure, "--secure", allowEmpty);
  }
  if (tpm != null) {
    validateNonEmptyList(tpm, "--tpm", allowEmpty);
  }

  return { secure, tpm };
}

function extractRotateStageLists(parsed) {
  const allowEmpty = parsed.flags.has("allow-empty");

  const currentSecure = parseRootList(
    parsed.values["current-secure"],
    "--current-secure",
  );
  const nextSecure = parseRootList(
    parsed.values["next-secure"],
    "--next-secure",
  );
  const currentTpm = parseRootList(parsed.values["current-tpm"], "--current-tpm");
  const nextTpm = parseRootList(parsed.values["next-tpm"], "--next-tpm");

  const hasSecure = currentSecure != null || nextSecure != null;
  const hasTpm = currentTpm != null || nextTpm != null;

  if (!hasSecure && !hasTpm) {
    throw new Error(
      "rotate-stage requires secure or tpm inputs (current + next lists).",
    );
  }

  if (hasSecure && (currentSecure == null || nextSecure == null)) {
    throw new Error(
      "rotate-stage secure flow requires both --current-secure and --next-secure.",
    );
  }
  if (hasTpm && (currentTpm == null || nextTpm == null)) {
    throw new Error(
      "rotate-stage tpm flow requires both --current-tpm and --next-tpm.",
    );
  }

  const stageSecure =
    currentSecure && nextSecure ? mergeRootLists(currentSecure, nextSecure) : null;
  const stageTpm = currentTpm && nextTpm ? mergeRootLists(currentTpm, nextTpm) : null;

  if (stageSecure != null) {
    validateNonEmptyList(stageSecure, "rotate-stage secure", allowEmpty);
  }
  if (stageTpm != null) {
    validateNonEmptyList(stageTpm, "rotate-stage tpm", allowEmpty);
  }

  return {
    stageSecure,
    stageTpm,
    nextSecure,
    nextTpm,
  };
}

function extractRotateFinalLists(parsed) {
  const allowEmpty = parsed.flags.has("allow-empty");
  const nextSecure = parseRootList(parsed.values["next-secure"], "--next-secure");
  const nextTpm = parseRootList(parsed.values["next-tpm"], "--next-tpm");

  if (nextSecure == null && nextTpm == null) {
    throw new Error("rotate-final requires --next-secure and/or --next-tpm.");
  }

  if (nextSecure != null) {
    validateNonEmptyList(nextSecure, "--next-secure", allowEmpty);
  }
  if (nextTpm != null) {
    validateNonEmptyList(nextTpm, "--next-tpm", allowEmpty);
  }

  return { nextSecure, nextTpm };
}

function runStatus(parsed) {
  const asJson = parsed.flags.has("json");
  const envName = parsed.values.env ? String(parsed.values.env).trim() : "";

  const args = ["secret", "list", "--format", "json"];
  if (envName) {
    args.push("--env", envName);
  }

  const output = run(WRANGLER_COMMAND, args);
  const names = new Set(parseSecretNames(output));

  const payload = {
    env: envName || null,
    registered: {
      [VAR_SECURE]: names.has(VAR_SECURE),
      [VAR_TPM]: names.has(VAR_TPM),
    },
  };

  if (asJson) {
    console.log(JSON.stringify({ ok: true, ...payload }, null, 2));
    return;
  }

  console.log("[attestation-trusted-roots] status");
  console.log(`- env: ${payload.env ?? "(default)"}`);
  console.log(`- ${VAR_SECURE}: ${payload.registered[VAR_SECURE] ? "registered" : "missing"}`);
  console.log(`- ${VAR_TPM}: ${payload.registered[VAR_TPM] ? "registered" : "missing"}`);
}

function runApply(parsed) {
  const asJson = parsed.flags.has("json");
  const confirm = parsed.flags.has("confirm");
  const envName = ensureApplyEnv(parsed);
  const { secure, tpm } = extractApplyLists(parsed);

  const operations = [];

  if (secure != null) {
    operations.push(
      putSecret({
        name: VAR_SECURE,
        value: JSON.stringify(secure),
        envName,
        confirm,
      }),
    );
  }

  if (tpm != null) {
    operations.push(
      putSecret({
        name: VAR_TPM,
        value: JSON.stringify(tpm),
        envName,
        confirm,
      }),
    );
  }

  emitResult({
    asJson,
    title: `apply (${confirm ? "confirmed" : "dry-run"})`,
    operations,
  });
}

function runRotateStage(parsed) {
  const asJson = parsed.flags.has("json");
  const confirm = parsed.flags.has("confirm");
  const envName = ensureApplyEnv(parsed);
  const { stageSecure, stageTpm, nextSecure, nextTpm } =
    extractRotateStageLists(parsed);

  const operations = [];

  if (stageSecure != null) {
    operations.push(
      putSecret({
        name: VAR_SECURE,
        value: JSON.stringify(stageSecure),
        envName,
        confirm,
      }),
    );
  }

  if (stageTpm != null) {
    operations.push(
      putSecret({
        name: VAR_TPM,
        value: JSON.stringify(stageTpm),
        envName,
        confirm,
      }),
    );
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          title: `rotate-stage (${confirm ? "confirmed" : "dry-run"})`,
          operations,
          next: {
            secure: nextSecure ?? null,
            tpm: nextTpm ?? null,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  emitResult({
    asJson: false,
    title: `rotate-stage (${confirm ? "confirmed" : "dry-run"})`,
    operations,
  });
  if (nextSecure || nextTpm) {
    console.log("- next step: run rotate-final with the --next-* lists to remove old roots.");
  }
}

function runRotateFinal(parsed) {
  const asJson = parsed.flags.has("json");
  const confirm = parsed.flags.has("confirm");
  const envName = ensureApplyEnv(parsed);
  const { nextSecure, nextTpm } = extractRotateFinalLists(parsed);

  const operations = [];

  if (nextSecure != null) {
    operations.push(
      putSecret({
        name: VAR_SECURE,
        value: JSON.stringify(nextSecure),
        envName,
        confirm,
      }),
    );
  }

  if (nextTpm != null) {
    operations.push(
      putSecret({
        name: VAR_TPM,
        value: JSON.stringify(nextTpm),
        envName,
        confirm,
      }),
    );
  }

  emitResult({
    asJson,
    title: `rotate-final (${confirm ? "confirmed" : "dry-run"})`,
    operations,
  });
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const positionals = parsed.positionals.filter((item) => item !== "--");
  const command = positionals[0];

  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }

  if (command === "status") {
    runStatus(parsed);
    return;
  }

  if (command === "apply") {
    runApply(parsed);
    return;
  }

  if (command === "rotate-stage") {
    runRotateStage(parsed);
    return;
  }

  if (command === "rotate-final") {
    runRotateFinal(parsed);
    return;
  }

  fail(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
