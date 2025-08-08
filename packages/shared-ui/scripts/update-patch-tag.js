import { readFileSync, writeFileSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import path from "path";

const packageJsonPath = path.resolve("./package.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const baseVersion = packageJson.version.split("-")[0];
const newVersion = `${baseVersion}-${uuidv4()}`;

packageJson.version = newVersion;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf8");

console.log(`Version updated to: ${newVersion}`);
