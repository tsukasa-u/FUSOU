import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { SourceTextModule } from "node:vm";

// Parse only: never link, evaluate, or resolve a candidate's code on disk.
const files = JSON.parse(readFileSync(0, "utf8")), imports = {};
for (const [path, text] of Object.entries(files)) {
  const code = path.endsWith(".ts") ? stripTypeScriptTypes(text, { mode: "transform" }) : text;
  if (/\bimport\s*\(/.test(code) || /\brequire\s*\(/.test(code)) throw new Error(`dynamic module loading is not approved: ${path}`);
  imports[path] = new SourceTextModule(code, { identifier: path }).dependencySpecifiers;
}
process.stdout.write(JSON.stringify(imports));
