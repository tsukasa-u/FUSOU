import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryDirectory = resolve(packageDirectory, "../..");
export const fixtureDirectory = resolve(packageDirectory, ".cache/sparse-crypto-real-fixtures");
export const fixtureManifestPath = resolve(fixtureDirectory, "manifest.json");

const proxyManifest = resolve(repositoryDirectory, "packages/FUSOU-PROXY/proxy-https/Cargo.toml");

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
