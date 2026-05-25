#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KC_API_ROOT = resolve(__dirname, "../../kc_api");
const KC_API_DB_CRATE = resolve(KC_API_ROOT, "crates/kc-api-database");
const OUTPUT_DIR = resolve(KC_API_ROOT, "generated-schemas");
const FINGERPRINT_SCRIPT = resolve(
  __dirname,
  "../../FUSOU-WORKFLOW/scripts/compute-kc-api-fingerprints.mjs",
);
const FINGERPRINT_OUTPUT = resolve(
  __dirname,
  "../../configs/fingerprints.json",
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return result;
}

function runInherit(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function detectVersions() {
  const cargoTomlPath = resolve(KC_API_DB_CRATE, "Cargo.toml");
  if (!existsSync(cargoTomlPath)) {
    fail(`Cargo.toml not found: ${cargoTomlPath}`);
  }

  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  const versions = [];
  const pattern = /^schema_(v[0-9]+_[0-9]+)\s*=/gm;
  let match = pattern.exec(cargoToml);
  while (match) {
    versions.push(match[1]);
    match = pattern.exec(cargoToml);
  }

  if (!versions.length) {
    fail("No schema_vN_M features found in kc-api-database Cargo.toml");
  }

  return versions;
}

function generateSchema(version, binName, outputPath) {
  const args = [
    "run",
    "--bin",
    binName,
    "--no-default-features",
    "--features",
    `schema_${version},full`,
  ];
  const result = runCapture("cargo", args, { cwd: KC_API_DB_CRATE });

  if (result.error || result.status !== 0) {
    if (existsSync(outputPath)) {
      rmSync(outputPath, { force: true });
    }
    const stderr = (result.stderr || "").trim();
    if (stderr) {
      console.warn(stderr);
    }
    return false;
  }

  writeFileSync(outputPath, result.stdout || "", "utf8");
  return true;
}

function generateFingerprints(schemaFiles) {
  if (!existsSync(FINGERPRINT_SCRIPT)) {
    console.warn(`Fingerprint script not found: ${FINGERPRINT_SCRIPT}`);
    return;
  }
  if (!schemaFiles.length) {
    console.warn("No schema files generated; skipping fingerprint generation");
    return;
  }

  const result = runCapture("node", [FINGERPRINT_SCRIPT, ...schemaFiles], {
    cwd: KC_API_ROOT,
  });
  if (result.error || result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    throw new Error(
      `Fingerprint generation failed${stderr ? `: ${stderr}` : ""}`,
    );
  }

  writeFileSync(FINGERPRINT_OUTPUT, result.stdout || "", "utf8");
  console.log(`Fingerprints written: ${FINGERPRINT_OUTPUT}`);
}

function main() {
  const cargoCheck = runCapture("cargo", ["--version"]);
  if (cargoCheck.error || cargoCheck.status !== 0) {
    fail("cargo is required but was not found in PATH");
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const versions = detectVersions();
  console.log(`Detected schema versions: ${versions.join(" ")}`);

  const generatedSchemaFiles = [];

  for (const version of versions) {
    const schemaPath = resolve(OUTPUT_DIR, `schema_${version}.json`);
    const masterSchemaPath = resolve(
      OUTPUT_DIR,
      `master_schema_${version}.json`,
    );

    console.log(`Generating schema_${version}.json...`);
    const schemaOk = generateSchema(version, "print_schema", schemaPath);
    if (schemaOk) {
      generatedSchemaFiles.push(schemaPath);
      console.log(`  OK ${schemaPath}`);
    } else {
      console.warn(`  SKIP schema_${version}.json`);
    }

    console.log(`Generating master_schema_${version}.json...`);
    const masterOk = generateSchema(
      version,
      "print_master_schema",
      masterSchemaPath,
    );
    if (masterOk) {
      console.log(`  OK ${masterSchemaPath}`);
    } else {
      console.warn(`  SKIP master_schema_${version}.json`);
    }
  }

  generateFingerprints(generatedSchemaFiles);

  // Keep previous behavior where schema generation itself is separate from rust tests,
  // but expose a convenient message for the caller chain.
  console.log("Schema generation completed.");

  // Ensure these tests still run in the same workflow step as before.
  runInherit(
    "cargo",
    [
      "test",
      "--manifest-path",
      resolve(KC_API_ROOT, "Cargo.toml"),
      "-p",
      "kc-api-dto",
      "test_struct_dependency_syn",
      "--",
      "--nocapture",
    ],
    { cwd: KC_API_ROOT },
  );

  runInherit(
    "cargo",
    [
      "test",
      "--manifest-path",
      resolve(KC_API_ROOT, "Cargo.toml"),
      "-p",
      "kc-api-database",
      "test_database_dependency_syn",
      "--",
      "--nocapture",
    ],
    { cwd: KC_API_ROOT },
  );
}

try {
  main();
} catch (error) {
  console.error(
    "generate-rust-data failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
