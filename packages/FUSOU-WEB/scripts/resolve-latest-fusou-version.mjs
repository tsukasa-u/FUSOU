import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Resolve the latest released FUSOU version at build time.
 * Prefers fusou-v* git tags and falls back to FUSOU-APP/package.json.
 */
export function resolveLatestFusouVersion() {
  const tagVersions = [];
  try {
    const rawTags = execFileSync(
      "git",
      ["tag", "-l", "fusou-v*", "--sort=-v:refname"],
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    );
    for (const line of rawTags.split(/\r?\n/)) {
      const match = /^fusou-v(\d+\.\d+\.\d+)$/.exec(line.trim());
      if (match?.[1]) tagVersions.push(match[1]);
    }
  } catch {
    // Fall back to the app package version when git tags are unavailable.
  }

  if (tagVersions.length > 0) {
    tagVersions.sort((a, b) => compareSemver(b, a));
    return `v${tagVersions[0]}`;
  }

  try {
    const appPackagePath = fileURLToPath(
      new URL("../../FUSOU-APP/package.json", import.meta.url),
    );
    const appPackage = JSON.parse(readFileSync(appPackagePath, "utf8"));
    if (
      typeof appPackage.version === "string" &&
      /^\d+\.\d+\.\d+$/.test(appPackage.version)
    ) {
      return `v${appPackage.version}`;
    }
  } catch {
    // Fall back to the current web version if the app package is unavailable.
  }

  return "v0.6.1";
}
