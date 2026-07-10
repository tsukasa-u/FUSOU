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
const KC_API_ROOT = resolve(__dirname, "..");
const KC_API_DB_CRATE = resolve(KC_API_ROOT, "crates/kc-api-database");
const OUTPUT_DIR = resolve(KC_API_ROOT, "generated-schemas");
const FINGERPRINT_SCRIPT = resolve(
  KC_API_ROOT,
  "../FUSOU-WORKFLOW/scripts/compute-kc-api-fingerprints.mjs",
);
const FINGERPRINT_OUTPUT = resolve(KC_API_ROOT, "../configs/fingerprints.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function runCapture(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
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

function detectAvailableEpochFeatures(cargoToml) {
  const features = [];
  if (/^genesis\s*=/m.test(cargoToml)) {
    features.push("genesis");
  }

  const dates = [];
  const pattern = /^epoch_([0-9]{8})\s*=/gm;
  let match = pattern.exec(cargoToml);
  while (match) {
    dates.push(Number(match[1]));
    match = pattern.exec(cargoToml);
  }

  dates.sort((a, b) => a - b);
  for (const date of dates) {
    features.push(`epoch_${date}`);
  }

  return features;
}

function parseDefaultFeatures(cargoToml) {
  const defaultMatch = cargoToml.match(/^default\s*=\s*\[([\s\S]*?)\]/m);
  if (!defaultMatch) {
    return [];
  }

  const features = [];
  const featurePattern = /"([^"]+)"/g;
  let match = featurePattern.exec(defaultMatch[1]);
  while (match) {
    features.push(match[1]);
    match = featurePattern.exec(defaultMatch[1]);
  }

  return features;
}

function normalizeEpochFeature(rawValue) {
  const value = rawValue.trim();
  if (value === "genesis") {
    return "genesis";
  }
  if (/^epoch_[0-9]{8}$/.test(value)) {
    return value;
  }
  if (/^[0-9]{8}$/.test(value)) {
    return `epoch_${value}`;
  }
  return null;
}

function resolveEpochFeature() {
  const cargoTomlPath = resolve(KC_API_DB_CRATE, "Cargo.toml");
  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  const availableEpochFeatures = detectAvailableEpochFeatures(cargoToml);

  if (!availableEpochFeatures.length) {
    fail("No epoch features found in kc-api-database Cargo.toml");
  }

  const requestedRaw =
    process.env.KC_API_EPOCH_FEATURE || process.env.KC_API_EPOCH;
  if (requestedRaw) {
    const normalized = normalizeEpochFeature(requestedRaw);
    if (!normalized) {
      fail(
        `Invalid KC_API_EPOCH value '${requestedRaw}'. Use genesis, epoch_YYYYMMDD, or YYYYMMDD.`,
      );
    }
    if (!availableEpochFeatures.includes(normalized)) {
      fail(
        `Unknown epoch feature '${normalized}'. Available: ${availableEpochFeatures.join(", ")}`,
      );
    }
    return normalized;
  }

  const defaultFeatures = parseDefaultFeatures(cargoToml);
  const defaultEpochFeatures = defaultFeatures.filter(
    (feature) =>
      feature === "genesis" || /^epoch_[0-9]{8}$/.test(feature),
  );

  if (defaultEpochFeatures.length > 1) {
    fail(
      `Multiple epoch features in default feature list: ${defaultEpochFeatures.join(", ")}`,
    );
  }

  if (defaultEpochFeatures.length === 1) {
    const [feature] = defaultEpochFeatures;
    if (!availableEpochFeatures.includes(feature)) {
      fail(
        `Default epoch feature '${feature}' is not defined. Available: ${availableEpochFeatures.join(", ")}`,
      );
    }
    return feature;
  }

  const datedFeatures = availableEpochFeatures.filter((feature) =>
    /^epoch_[0-9]{8}$/.test(feature),
  );
  if (datedFeatures.length > 0) {
    return datedFeatures[datedFeatures.length - 1];
  }

  if (availableEpochFeatures.includes("genesis")) {
    return "genesis";
  }

  fail("Unable to resolve epoch feature");
}

function generateSchema(version, binName, outputPath, epochFeature) {
  const args = [
    "run",
    "--bin",
    binName,
    "--no-default-features",
    "--features",
    `schema_${version},full,${epochFeature}`,
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
  console.log(`Detected versions: ${versions.join(" ")}`);

  const epochFeature = resolveEpochFeature();
  console.log(`Using kc-api epoch feature: ${epochFeature}`);

  const generatedSchemaFiles = [];

  for (const version of versions) {
    const schemaPath = resolve(OUTPUT_DIR, `schema_${version}.json`);
    const masterSchemaPath = resolve(
      OUTPUT_DIR,
      `master_schema_${version}.json`,
    );

    console.log(`Generating schema_${version}.json...`);
    const schemaOk = generateSchema(
      version,
      "print_schema",
      schemaPath,
      epochFeature,
    );
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
      epochFeature,
    );
    if (masterOk) {
      console.log(`  OK ${masterSchemaPath}`);
    } else {
      console.warn(`  SKIP master_schema_${version}.json`);
    }
  }

  generateFingerprints(generatedSchemaFiles);
  console.log("Schema generation completed.");
}

try {
  main();
} catch (error) {
  console.error(
    "generate-schemas failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
