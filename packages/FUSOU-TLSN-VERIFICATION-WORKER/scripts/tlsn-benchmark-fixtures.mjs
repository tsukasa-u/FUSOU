import { readFileSync } from "node:fs";
import { statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryDirectory = resolve(packageDirectory, "../..");
export const fixtureDirectory = resolve(packageDirectory, ".cache/sparse-crypto-real-fixtures");
export const fixtureManifestPath = resolve(fixtureDirectory, "manifest.json");

const proxyManifest = resolve(repositoryDirectory, "packages/FUSOU-PROXY/proxy-https/Cargo.toml");
const fixtureSourceRoot = resolve(repositoryDirectory, "packages/FUSOU-PROXY-DATA");

function isWithin(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

function assertLocalFile(path, label, root) {
  const resolvedPath = resolve(path);
  if (!isWithin(root, resolvedPath)) {
    throw new Error(`${label} must remain inside ${root}`);
  }
  try {
    if (!statSync(resolvedPath).isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`${label} is missing or is not a regular file`);
  }
}

export function assertBenchmarkFixtureManifest(manifest) {
  if (
    manifest?.benchmark !== "tlsn-worker-sparse-crypto-real-fixtures-v1" ||
    manifest?.schemaVersion !== 1 ||
    manifest?.generator !== "synthetic_tlsn_fixture" ||
    manifest?.cargoProfile !== "release" ||
    manifest?.offline !== true ||
    manifest?.source?.fixtureSemantics !== "metadata plus API body; HTTP status, headers, and TLS framing are absent" ||
    manifest?.source?.httpTranscriptSize !== "NOT_ESTABLISHED" ||
    !Array.isArray(manifest?.cases) ||
    manifest.cases.length === 0
  ) {
    throw new Error("benchmark fixture manifest is not an offline synthetic fixture manifest");
  }

  const sourceRoot = resolve(repositoryDirectory, manifest.source.path);
  if (!isWithin(fixtureSourceRoot, sourceRoot)) {
    throw new Error("benchmark fixture source must remain inside packages/FUSOU-PROXY-DATA");
  }
  for (const entry of manifest.cases) {
    if (!entry?.caseLabel || !entry.sourceEpoch || !entry.sourceFileName || !entry.fixtureFile) {
      throw new Error("benchmark fixture manifest contains an incomplete case");
    }
    assertLocalFile(resolve(sourceRoot, entry.sourceEpoch, "kcsapi", entry.sourceFileName), "benchmark fixture source", fixtureSourceRoot);
    assertLocalFile(resolve(fixtureDirectory, entry.fixtureFile), "generated benchmark fixture", fixtureDirectory);
  }
  return manifest;
}

export function generateRealFixture(sourcePath, binding) {
  const result = spawnSync(
    "cargo",
    [
      "+1.95.0",
      "run",
      "--quiet",
      "--release",
      "--manifest-path",
      proxyManifest,
      "--features",
      "synthetic-tlsn",
      "--example",
      "synthetic_tlsn_fixture",
    ],
    {
      cwd: repositoryDirectory,
      env: {
        ...process.env,
        CARGO_NET_OFFLINE: "true",
        FUSOU_SYNTHETIC_PROOF_MODE: "sparse",
        FUSOU_SYNTHETIC_RESPONSE_FIXTURE_PATH: sourcePath,
        FUSOU_SYNTHETIC_BINDING_VALUE: binding,
        ...(process.env.FUSOU_SYNTHETIC_ROOT_KEY_PKCS8
          ? { FUSOU_SYNTHETIC_ROOT_KEY_PKCS8: process.env.FUSOU_SYNTHETIC_ROOT_KEY_PKCS8 }
          : {}),
      },
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`real fixture generation failed:\n${result.stderr.slice(-4000)}`);
  }
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) throw new Error("fixture generator returned no JSON");
  return JSON.parse(output);
}

export function readRealFixtureManifest() {
  const manifest = JSON.parse(readFileSync(fixtureManifestPath, "utf8"));
  assertBenchmarkFixtureManifest(manifest);
  const entries = new Map(manifest.cases.map((entry) => [entry.caseLabel, entry]));
  return { manifest, entries };
}

export function fixtureSourcePath(manifest, entry) {
  return resolve(
    repositoryDirectory,
    manifest.source.path,
    entry.sourceEpoch,
    "kcsapi",
    entry.sourceFileName,
  );
}

export function loadRealFixture(entry) {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, entry.fixtureFile), "utf8"));
}
