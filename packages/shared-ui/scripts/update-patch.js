import { readFileSync, writeFileSync } from "fs";
import path from "path";

const packageJsonPath = path.resolve("./package.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const currentVersion = packageJson.version;
const [major, minor, patch] = currentVersion
  .split("-")[0]
  .split(".")
  .map(Number);

const newVersion = `${major}.${minor}.${patch + 1}`;

packageJson.version = newVersion;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf8");

console.log(`Version updated to: ${newVersion}`);
