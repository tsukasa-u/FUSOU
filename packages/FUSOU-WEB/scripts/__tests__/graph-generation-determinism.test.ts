import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "../..");
const GRAPHS_DIR = resolve(WEB_ROOT, "src/data/graphs");

function runScript(scriptRelativePath: string) {
  execFileSync(process.execPath, [resolve(WEB_ROOT, scriptRelativePath)], {
    cwd: WEB_ROOT,
    stdio: "pipe",
    encoding: "utf8",
  });
}

function readGraphFiles(relativePaths: string[]) {
  const out: Record<string, string> = {};
  for (const rel of relativePaths) {
    out[rel] = readFileSync(resolve(WEB_ROOT, rel), "utf8");
  }
  return out;
}

function readSchemaGraphFiles() {
  const versionFiles = readdirSync(GRAPHS_DIR)
    .filter((name) => /^db_v\d+_\d+\.json$/.test(name))
    .sort();

  return readGraphFiles([
    ...versionFiles.map((name) => `src/data/graphs/${name}`),
    "src/data/graphs/db_versions.json",
  ]);
}

describe("graph generation determinism", () => {
  it("convert-dot-to-reactflow writes byte-stable output", () => {
    runScript("scripts/convert-dot-to-reactflow.mjs");
    const first = readGraphFiles([
      "src/data/graphs/endpoints_by_group.json",
      "src/data/graphs/database_dot.json",
    ]);

    runScript("scripts/convert-dot-to-reactflow.mjs");
    const second = readGraphFiles([
      "src/data/graphs/endpoints_by_group.json",
      "src/data/graphs/database_dot.json",
    ]);

    expect(second).toEqual(first);
  });

  it("convert-schema-to-reactflow writes byte-stable output", () => {
    runScript("scripts/convert-schema-to-reactflow.mjs");
    const first = readSchemaGraphFiles();

    runScript("scripts/convert-schema-to-reactflow.mjs");
    const second = readSchemaGraphFiles();

    expect(second).toEqual(first);
  });
});
