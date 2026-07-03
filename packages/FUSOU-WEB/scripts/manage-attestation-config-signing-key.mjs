#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const WRANGLER_COMMAND = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
const SECRET_NAME = "ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY";

function usage() {
  console.log("Usage:");
  console.log("  pnpm run manage-attestation-config-signing-key -- <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  generate");
  console.log("  status [--env <name>]");
  console.log("  apply --private-pem <pem-or-@path> [--env <name>] [--confirm]");
  console.log("");
  console.log("Options:");
  console.log("  --json                 JSON output");
  console.log("  --show-private         print private key to stdout (dangerous)");
  console.log("  --allow-inline-private allow --private-pem with inline text (dangerous)");
  console.log("  --public-out <path>    write generated public key(base64, 32 bytes) to file");
  console.log("  --private-out <path>   write generated private key(PEM) to file");
}

function fail(message, code = 1) {
  console.error(`[attestation-config-key] ${message}`);
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

function base64UrlToBase64(value) {
  const replaced = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = replaced.length % 4;
  if (padding === 0) return replaced;
  return replaced + "=".repeat(4 - padding);
}

function cmdGenerate(parsed) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicJwk = publicKey.export({ format: "jwk" });
  if (typeof publicJwk.x !== "string") {
    throw new Error("failed to export public key JWK");
  }
  const publicB64 = base64UrlToBase64(publicJwk.x);

  if (parsed.values["public-out"]) {
    writeFileSync(resolve(WEB_ROOT, parsed.values["public-out"]), `${publicB64}\n`, "utf8");
  }
  if (parsed.values["private-out"]) {
    writeFileSync(resolve(WEB_ROOT, parsed.values["private-out"]), `${privatePem}\n`, "utf8");
  }

  const showPrivate = parsed.flags.has("show-private");

  if (parsed.flags.has("json")) {
    const payload = {
      ok: true,
      public_key_base64: publicB64,
      private_key_pem: showPrivate ? privatePem : "(hidden; use --show-private)",
    };
    console.log(
      JSON.stringify(payload, null, 2),
    );
    return;
  }

  console.log("[attestation-config-key] generated Ed25519 keypair");
  console.log("- ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY (32-byte base64):");
  console.log(publicB64);
  console.log("");
  if (showPrivate) {
    console.log("- ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY (PKCS8 PEM):");
    console.log(privatePem);
    console.log("");
  } else {
    console.log("- private key output is hidden by default; use --show-private only in secure terminals");
    console.log("");
  }
  console.log("Next:");
  console.log("1) Set ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY in FUSOU-APP build environment.");
  console.log("2) Apply ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY to Cloudflare secret (use apply command).");
}

function cmdStatus(parsed) {
  const envName = parsed.values.env ? String(parsed.values.env).trim() : "";
  const args = ["secret", "list", "--format", "json"];
  if (envName) args.push("--env", envName);
  const output = run(WRANGLER_COMMAND, args);
  const names = new Set(parseSecretNames(output));
  const exists = names.has(SECRET_NAME);

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify({ ok: true, env: envName || null, secret: SECRET_NAME, exists }, null, 2));
    return;
  }

  console.log("[attestation-config-key] status");
  console.log(`- env: ${envName || "(default)"}`);
  console.log(`- ${SECRET_NAME}: ${exists ? "registered" : "missing"}`);
}

function readPrivatePemArg(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("--private-pem is required");
  }
  const text = value.trim();
  if (!text.startsWith("@")) return text;

  const path = resolve(WEB_ROOT, text.slice(1));
  return readFileSync(path, "utf8");
}

async function cmdApply(parsed) {
  const envName = parsed.values.env ? String(parsed.values.env).trim() : "";
  const confirm = parsed.flags.has("confirm");
  const privatePemArg = parsed.values["private-pem"];
  if (
    typeof privatePemArg === "string" &&
    !privatePemArg.trim().startsWith("@") &&
    !parsed.flags.has("allow-inline-private")
  ) {
    throw new Error(
      "inline --private-pem is blocked by default; pass --private-pem @<path> (or --allow-inline-private explicitly)",
    );
  }

  const privatePem = readPrivatePemArg(privatePemArg);
  if (!privatePem.includes("BEGIN PRIVATE KEY")) {
    throw new Error("--private-pem must be PKCS8 PEM text");
  }

  if (!confirm) {
    if (parsed.flags.has("json")) {
      console.log(JSON.stringify({ ok: true, mode: "dry-run", env: envName || null, secret: SECRET_NAME }, null, 2));
      return;
    }
    console.log("[attestation-config-key] dry-run");
    console.log(`- would update ${SECRET_NAME}${envName ? ` (env=${envName})` : ""}`);
    console.log("- add --confirm to apply");
    return;
  }

  const args = ["secret", "put", SECRET_NAME];
  if (envName) args.push("--env", envName);
  run(WRANGLER_COMMAND, args, { input: `${privatePem}\n` });

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify({ ok: true, mode: "applied", env: envName || null, secret: SECRET_NAME }, null, 2));
    return;
  }

  console.log("[attestation-config-key] applied");
  console.log(`- updated ${SECRET_NAME}${envName ? ` (env=${envName})` : ""}`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const cmd = parsed.positionals.find((item) => item !== "--");

  if (!cmd || cmd === "help" || cmd === "--help") {
    usage();
    return;
  }

  if (cmd === "generate") {
    cmdGenerate(parsed);
    return;
  }

  if (cmd === "status") {
    cmdStatus(parsed);
    return;
  }

  if (cmd === "apply") {
    await cmdApply(parsed);
    return;
  }

  fail(`unknown command: ${cmd}`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
