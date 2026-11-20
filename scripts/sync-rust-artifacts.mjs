#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const WEB_DIR = resolve(REPO_ROOT, "packages/FUSOU-WEB");
const KC_API_DB_CARGO_TOML = resolve(
  REPO_ROOT,
  "packages/kc_api/crates/kc-api-database/Cargo.toml",
);
const MANIFEST_REL_PATH = "packages/configs/rust-artifacts-manifest.json";
const MANIFEST_PATH = resolve(REPO_ROOT, MANIFEST_REL_PATH);

const EXPLICIT_INPUT_FILES = [
  "packages/kc_api/Cargo.toml",
  "packages/FUSOU-WEB/scripts/generate-rust-data.mjs",
  "packages/FUSOU-WEB/scripts/convert-dot-to-reactflow.mjs",
  "packages/FUSOU-WEB/scripts/convert-schema-to-reactflow.mjs",
  "packages/FUSOU-WEB/scripts/generate-avro-schema-registry.mjs",
  "packages/FUSOU-WEB/scripts/lib/stable-json.mjs",
  "packages/FUSOU-WORKFLOW/scripts/compute-kc-api-fingerprints.mjs",
];

const MONITORED_CRATE_DIRS = [
  "packages/kc_api/crates/kc-api-build-config",
  "packages/kc_api/crates/kc-api-database",
  "packages/kc_api/crates/kc-api-dto",
  "packages/kc_api/crates/kc-api-interface",
  "packages/kc_api/crates/register_trait",
  "packages/kc_api/crates/register_macro_derive_and_attr",
];

const args = new Set(process.argv.slice(2));
const isCheckOnly = args.has("--check");
const isCheckOrBuild = args.has("--check-or-build");
const isPreCommit = args.has("--pre-commit");
const isForce = args.has("--force") || process.env.FORCE_RUST_REBUILD === "true";
const shouldStage = args.has("--stage") || isPreCommit;

function isCiEnvironment() {
  return Boolean(
    process.env.CI ||
      process.env.CLOUDFLARE_ACCOUNT_ID ||
      process.env.CF_ACCOUNT_ID ||
      process.env.CF_PAGES ||
      process.env.WORKERS_CI,
  );
}

function toPosix(p) {
  return p.split("\\").join("/");
}

function hashTextFile(absPath) {
  const normalized = readFileSync(absPath, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function collectFiles(absDir, predicate = () => true) {
  if (!existsSync(absDir)) return [];
  const results = [];
  const entries = readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === "target" ||
      entry.name === "node_modules" ||
      entry.name === ".git"
    ) {
      continue;
    }
    const fullPath = resolve(absDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, predicate));
    } else if (entry.isFile() && predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function hashInputFiles(relPaths) {
  const uniqueSorted = [...new Set(relPaths.map(toPosix))].sort();
  const hasher = createHash("sha256");
  for (const relPath of uniqueSorted) {
    const absPath = resolve(REPO_ROOT, relPath);
    if (!existsSync(absPath)) {
      hasher.update(`${relPath}:MISSING\n`);
      continue;
    }
    hasher.update(`${relPath}:${hashTextFile(absPath)}\n`);
  }
  return hasher.digest("hex");
}

function detectSchemaVersions() {
  const cargoToml = readFileSync(KC_API_DB_CARGO_TOML, "utf8");
  const versions = [];
  const pattern = /^schema_(v[0-9]+_[0-9]+(?:_[0-9]+)?)\s*=/gm;
  let match = pattern.exec(cargoToml);
  while (match) {
    versions.push(match[1]);
    match = pattern.exec(cargoToml);
  }
  if (!versions.length) {
    throw new Error("No schema_vN_M[_P] features found in kc-api-database Cargo.toml");
  }
  return versions;
}

function isMonitoredInputPath(relPath) {
  const p = toPosix(relPath);
  if (EXPLICIT_INPUT_FILES.includes(p)) return true;
  for (const crateRel of MONITORED_CRATE_DIRS) {
    if (p === `${crateRel}/Cargo.toml` || p === `${crateRel}/build.rs`) {
      return true;
    }
    if (
      (p.startsWith(`${crateRel}/src/`) || p.startsWith(`${crateRel}/tests/`)) &&
      (p.endsWith(".rs") || p.endsWith(".toml"))
    ) {
      return true;
    }
  }
  return false;
}

function getKcApiInputPaths() {
  const files = [...EXPLICIT_INPUT_FILES];

  for (const crateRel of MONITORED_CRATE_DIRS) {
    const crateAbs = resolve(REPO_ROOT, crateRel);
    for (const rootFile of ["Cargo.toml", "build.rs"]) {
      const absFile = resolve(crateAbs, rootFile);
      if (existsSync(absFile)) {
        files.push(toPosix(relative(REPO_ROOT, absFile)));
      }
    }
    for (const subDir of ["src", "tests"]) {
      for (const file of collectFiles(
        resolve(crateAbs, subDir),
        (p) => p.endsWith(".rs") || p.endsWith(".toml"),
      )) {
        files.push(toPosix(relative(REPO_ROOT, file)));
      }
    }
  }

  return files;
}

function getKcApiOutputPaths(versions) {
  const outputs = [
    "packages/configs/fingerprints.json",
    "packages/FUSOU-WEB/src/data/avro-schema-registry.json",
    "packages/FUSOU-WEB/src/data/graphs/database_dot.json",
    "packages/FUSOU-WEB/src/data/graphs/db_versions.json",
    "packages/FUSOU-WEB/src/data/graphs/endpoints_by_group.json",
  ];
  for (const ver of versions) {
    outputs.push(`packages/kc_api/generated-schemas/schema_${ver}.json`);
    outputs.push(`packages/kc_api/generated-schemas/master_schema_${ver}.json`);
    outputs.push(`packages/FUSOU-WEB/src/data/graphs/db_${ver}.json`);
  }
  return outputs.sort();
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

function evaluateGroup(manifestGroup, inputPaths, outputPaths) {
  const currentInputHash = hashInputFiles(inputPaths);
  const reasons = [];

  if (!manifestGroup) {
    reasons.push("manifest entry missing");
  } else if (manifestGroup.inputHash !== currentInputHash) {
    reasons.push("source inputs changed");
  }

  const currentOutputs = {};
  for (const relPath of outputPaths) {
    const absPath = resolve(REPO_ROOT, relPath);
    if (!existsSync(absPath)) {
      reasons.push(`missing output: ${relPath}`);
      continue;
    }
    const digest = hashTextFile(absPath);
    currentOutputs[relPath] = digest;
    if (manifestGroup && manifestGroup.outputs?.[relPath] !== digest) {
      reasons.push(`output drift: ${relPath}`);
    }
  }

  return {
    upToDate: reasons.length === 0,
    reasons,
    inputHash: currentInputHash,
    outputs: currentOutputs,
  };
}

function runNodeScript(absScriptPath, scriptArgs = [], cwd = WEB_DIR) {
  const result = spawnSync(process.execPath, [absScriptPath, ...scriptArgs], {
    cwd,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${absScriptPath} exited with status ${result.status}`);
  }
}

function gitPaths(gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(
      `git ${gitArgs.join(" ")} exited with status ${result.status}: ${(result.stderr || "").trim()}`,
    );
  }
  return (result.stdout || "")
    .split("\0")
    .filter(Boolean)
    .map(toPosix);
}

function stageFiles(relPaths) {
  const existing = [...new Set(relPaths.map(toPosix))].filter((p) =>
    existsSync(resolve(REPO_ROOT, p)),
  );
  if (!existing.length) return;
  const result = spawnSync("git", ["add", "--", ...existing], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`git add exited with status ${result.status}`);
  }
}

function regenerateAndWriteManifest() {
  runNodeScript(resolve(WEB_DIR, "scripts/setup-rust-env.mjs"));

  console.log(
    "[rust-artifacts] Regenerating kc_api schemas, fingerprints, graphs, and avro registry...",
  );
  runNodeScript(resolve(WEB_DIR, "scripts/generate-rust-data.mjs"));
  runNodeScript(resolve(WEB_DIR, "scripts/convert-dot-to-reactflow.mjs"));
  runNodeScript(resolve(WEB_DIR, "scripts/convert-schema-to-reactflow.mjs"));
  runNodeScript(resolve(WEB_DIR, "scripts/generate-avro-schema-registry.mjs"));

  const finalVersions = detectSchemaVersions();
  const finalOutputs = getKcApiOutputPaths(finalVersions);
  const finalInputs = getKcApiInputPaths();

  const outputsMap = {};
  for (const relPath of finalOutputs) {
    const absPath = resolve(REPO_ROOT, relPath);
    if (!existsSync(absPath)) {
      throw new Error(`Expected generated artifact missing: ${relPath}`);
    }
    outputsMap[relPath] = hashTextFile(absPath);
  }

  const nextManifest = {
    schemaVersion: 2,
    groups: {
      kcApiData: {
        inputHash: hashInputFiles(finalInputs),
        outputs: outputsMap,
      },
    },
  };

  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(nextManifest, null, 2)}\n`,
    "utf8",
  );
  console.log(`[rust-artifacts] Manifest updated: ${MANIFEST_REL_PATH}`);

  return finalOutputs;
}

function runPreCommit() {
  const versions = detectSchemaVersions();
  const kcApiInputs = getKcApiInputPaths();
  const kcApiOutputs = getKcApiOutputPaths(versions);
  const outputAndManifestSet = new Set([...kcApiOutputs, MANIFEST_REL_PATH]);

  const staged = gitPaths([
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--diff-filter=ACMRD",
  ]);
  if (staged.length === 0) return;

  const isRelevantStaged = staged.some(
    (p) =>
      isMonitoredInputPath(p) ||
      outputAndManifestSet.has(p) ||
      p.startsWith("packages/kc_api/generated-schemas/") ||
      p.startsWith("packages/FUSOU-WEB/src/data/graphs/"),
  );
  if (!isRelevantStaged) return;

  const unstaged = gitPaths([
    "diff",
    "--name-only",
    "-z",
    "--diff-filter=ACMRD",
  ]);
  const untracked = gitPaths(["ls-files", "--others", "--exclude-standard", "-z"]);
  const dirtyPaths = [...new Set([...unstaged, ...untracked])];

  // Reject partially staged or untracked monitored inputs so generated artifacts
  // always correspond to the exact staged snapshot being committed.
  const dirtyInputs = dirtyPaths.filter((p) => isMonitoredInputPath(p)).sort();
  if (dirtyInputs.length > 0) {
    console.error(
      "[pre-commit] Refusing to commit: monitored Rust/schema input files have unstaged or untracked changes:",
    );
    for (const p of dirtyInputs) console.error(`  - ${p}`);
    console.error(
      "[pre-commit] Stage or stash those changes first so generated artifacts match the exact staged snapshot.",
    );
    process.exit(1);
  }

  console.log(
    "[pre-commit] Rust schema sources or generated artifacts changed. Verifying staged snapshot...",
  );

  const manifest = readManifest();
  const kcStatus = evaluateGroup(
    manifest?.groups?.kcApiData,
    kcApiInputs,
    kcApiOutputs,
  );

  let trackedOutputs = [...kcApiOutputs, MANIFEST_REL_PATH];

  if (!kcStatus.upToDate || isForce) {
    console.log("[pre-commit] Regenerating and staging Rust artifacts...");
    const finalOutputs = regenerateAndWriteManifest();
    trackedOutputs = [...finalOutputs, MANIFEST_REL_PATH];
    stageFiles(trackedOutputs);
    console.log("[pre-commit] Staged updated Rust artifacts for commit.");
  } else {
    const dirtyOutputs = dirtyPaths
      .filter((p) => outputAndManifestSet.has(p))
      .sort();
    if (dirtyOutputs.length > 0) {
      console.log(
        "[pre-commit] Staging already-regenerated Rust artifacts and manifest...",
      );
      stageFiles(dirtyOutputs);
    } else {
      console.log(
        "[rust-artifacts] OK: staged schemas, graphs, avro registry, and manifest are up to date (skipping Rust build).",
      );
    }
  }

  // Final safety check: ensure no monitored output or manifest remains unstaged.
  const remainingUnstaged = gitPaths([
    "diff",
    "--name-only",
    "-z",
    "--diff-filter=ACMRD",
  ]);
  const trackedOutputSet = new Set(trackedOutputs);
  const stillDirtyOutputs = remainingUnstaged
    .filter((p) => trackedOutputSet.has(p))
    .sort();
  if (stillDirtyOutputs.length > 0) {
    console.error(
      "[pre-commit] Refusing to commit: generated Rust artifacts still have unstaged changes:",
    );
    for (const p of stillDirtyOutputs) console.error(`  - ${p}`);
    process.exit(1);
  }
}

function main() {
  if (isPreCommit) {
    runPreCommit();
    return;
  }

  const versions = detectSchemaVersions();
  const manifest = readManifest();

  const kcApiInputs = getKcApiInputPaths();
  const kcApiOutputs = getKcApiOutputPaths(versions);
  const kcStatus = evaluateGroup(
    manifest?.groups?.kcApiData,
    kcApiInputs,
    kcApiOutputs,
  );

  if (kcStatus.upToDate && !isForce) {
    console.log(
      "[rust-artifacts] OK: prebuilt schemas, graphs, and avro registry are up to date (skipping Rust build).",
    );
    return;
  }

  const reportStale = () => {
    console.error("[rust-artifacts] kcApiData is stale:");
    for (const r of kcStatus.reasons) console.error(`  - ${r}`);
  };

  if (isCheckOnly) {
    reportStale();
    console.error(
      "[rust-artifacts] Run 'pnpm run sync:rust-artifacts' locally and commit the updated files.",
    );
    process.exit(1);
  }

  if (isCheckOrBuild && !isForce && isCiEnvironment()) {
    reportStale();
    console.error(
      "[rust-artifacts] Refusing to run a cold Rust rebuild in CI. Run 'pnpm run sync:rust-artifacts' locally and commit the generated artifacts (or set FORCE_RUST_REBUILD=true to override).",
    );
    process.exit(1);
  }

  const finalOutputs = regenerateAndWriteManifest();

  if (shouldStage) {
    stageFiles([...finalOutputs, MANIFEST_REL_PATH]);
    console.log("[rust-artifacts] Staged updated Rust artifacts for commit.");
  }
}

try {
  main();
} catch (error) {
  console.error(
    "[rust-artifacts] Failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
