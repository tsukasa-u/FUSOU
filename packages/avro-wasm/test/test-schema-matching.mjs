import fs from "fs";
import path from "path";

// v0_4 EnvInfo schema: 4 fields (no app_platform)
const schemaV04 =
  '{"name":"EnvInfo","type":"record","fields":[{"name":"version","type":"string"},{"name":"uuid","type":{"type":"string"}},{"name":"user_env_unique","type":"string"},{"name":"timestamp","type":"long"}]}';
// v0_5+ EnvInfo schema: 5 fields (with app_platform)
const schemaV05 =
  '{"name":"EnvInfo","type":"record","fields":[{"name":"version","type":"string"},{"name":"uuid","type":{"type":"string"}},{"name":"user_env_unique","type":"string"},{"name":"timestamp","type":"long"},{"name":"app_platform","type":["null","string"]}]}';
// Unknown schema (should NOT match anything)
const schemaUnknown =
  '{"name":"EnvInfo","type":"record","fields":[{"name":"version","type":"string"},{"name":"uuid","type":{"type":"string"}},{"name":"user_env_unique","type":"string"},{"name":"timestamp","type":"long"},{"name":"dummy_field","type":"string"}]}';

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label}`);
    failures++;
  }
}

async function runTest() {
  console.log("Loading WASM...");
  const wasmPath = path.join(process.cwd(), "pkg/avro_wasm_bg.wasm");
  const wasmBuffer = fs.readFileSync(wasmPath);
  const wasmModule = new WebAssembly.Module(wasmBuffer);
  const wasmInstance = new WebAssembly.Instance(wasmModule, {
    "./avro_wasm_bg.js": await import("../pkg/avro_wasm_bg.js"),
  });

  const bindgen = await import("../pkg/avro_wasm_bg.js");
  bindgen.__wbg_set_wasm(wasmInstance.exports);
  const { match_client_schema, get_available_versions } = bindgen;

  console.log("Checking available versions...");
  const versions = get_available_versions();
  console.log("Versions available:", versions);

  check("v0_4 version present", versions.includes("v0_4"));
  check("v0_5 version present", versions.includes("v0_5"));
  check("v0_6 version present", versions.includes("v0_6"));

  // === Test 1: v0_4 schema (4 fields) should match v0_4 ===
  console.log("\nTest 1: v0_4 schema (no app_platform) → should match v0_4");
  const r1 = match_client_schema(schemaV04, "");
  console.log(
    `  Matched=${r1.matched}, Version=${r1.version}, TableVersion=${r1.table_version}, Table=${r1.table_name}`,
  );
  check("Matched", r1.matched);
  check("Version=v0_4", r1.version === "v0_4");
  check("TableVersion=0.4", r1.table_version === "0.4");
  check("Table=env_info", r1.table_name === "env_info");

  // === Test 2: v0_5 schema (5 fields) → should match v0_5 first ===
  console.log(
    "\nTest 2: v0_5 schema (with app_platform) → should match v0_5 (first version with this schema)",
  );
  const r2 = match_client_schema(schemaV05, "");
  console.log(
    `  Matched=${r2.matched}, Version=${r2.version}, TableVersion=${r2.table_version}, Table=${r2.table_name}`,
  );
  check("Matched", r2.matched);
  check("Version=v0_5", r2.version === "v0_5");
  check("TableVersion=0.5", r2.table_version === "0.5");
  check("Table=env_info", r2.table_name === "env_info");

  // === Test 3: v0_5 schema + hint "0.6" → should match v0_6 via hint ===
  console.log(
    "\nTest 3: v0_5 schema + hint '0.6' → should match v0_6 via hint disambiguation",
  );
  const r3 = match_client_schema(schemaV05, "0.6");
  console.log(
    `  Matched=${r3.matched}, Version=${r3.version}, TableVersion=${r3.table_version}, Table=${r3.table_name}`,
  );
  check("Matched", r3.matched);
  check("Version=v0_6", r3.version === "v0_6");
  check("TableVersion=0.6", r3.table_version === "0.6");

  // === Test 4: v0_4 schema + hint "0.4" → should match v0_4 ===
  console.log("\nTest 4: v0_4 schema + correct hint '0.4' → v0_4");
  const r4 = match_client_schema(schemaV04, "0.4");
  console.log(
    `  Matched=${r4.matched}, Version=${r4.version}, TableVersion=${r4.table_version}`,
  );
  check("Matched", r4.matched);
  check("Version=v0_4", r4.version === "v0_4");

  // === Test 5: Unknown schema → should NOT match ===
  console.log("\nTest 5: Unknown schema (dummy_field) → should NOT match");
  const r5 = match_client_schema(schemaUnknown, "");
  console.log(`  Matched=${r5.matched}, Error=${r5.error}`);
  check("Not matched", !r5.matched);
  check("Has error message", !!r5.error);

  // === Test 6: v0_4 schema + wrong hint "0.5" → should NOT match v0_5 ===
  // (v0_5 has different canonical form for env_info, so hint-based match fails;
  //  canonical-based match finds v0_4 as fallback)
  console.log(
    "\nTest 6: v0_4 schema + wrong hint '0.5' → falls back to v0_4 (canonical match)",
  );
  const r6 = match_client_schema(schemaV04, "0.5");
  console.log(
    `  Matched=${r6.matched}, Version=${r6.version}, TableVersion=${r6.table_version}`,
  );
  check("Matched (canonical fallback)", r6.matched);
  check(
    "Version=v0_4 (canonical form matches only v0_4)",
    r6.version === "v0_4",
  );

  console.log("\n" + "=".repeat(50));
  if (failures === 0) {
    console.log("All tests passed!");
  } else {
    console.error(`${failures} test(s) FAILED`);
    process.exit(1);
  }
}

runTest().catch(console.error);
