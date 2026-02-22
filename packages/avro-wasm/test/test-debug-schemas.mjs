import fs from "fs";
import path from "path";

/**
 * Detailed debug test for schema matching
 * Tests what happens when we extract schema from an actual Avro OCF file
 */

async function runDebugTest() {
  console.log("=== DETAILED SCHEMA MATCHING DEBUG TEST ===\n");

  console.log("Loading WASM...");
  const {
    default: init,
    match_client_schema,
    get_available_versions,
    get_schema_json,
    get_available_schemas,
    validate_avro_ocf_smart,
    init_panic_hook,
  } = await import("../pkg/avro_wasm.js");

  const wasmPath = path.join(process.cwd(), "pkg/avro_wasm_bg.wasm");
  const wasmBuffer = fs.readFileSync(wasmPath);

  await init(wasmBuffer);
  init_panic_hook();
  console.log("WASM initialized successfully\n");

  // Get all available schemas
  const versions = get_available_versions();
  console.log("Available versions:", versions);

  console.log("\n=== Server-side schemas (canonical form) ===");
  for (const version of versions) {
    console.log(`\n--- Version: ${version} ---`);
    const tables = get_available_schemas(version);
    for (const table of tables.slice(0, 5)) {
      // Show first 5
      const serverSchema = get_schema_json(table, version);
      console.log(`${table}: ${serverSchema.slice(0, 100)}...`);
    }
  }

  // Test specific schemas that client sends
  console.log("\n=== Testing client schema matching ===\n");

  // Test exact schema from the problem - enemy_deck
  const testCases = [
    // Test 1: Exact match as expected from Rust serialization
    {
      name: "enemy_deck - with type wrapper",
      schema:
        '{"name":"EnemyDeck","type":"record","fields":[{"name":"env_uuid","type":{"type":"string"}},{"name":"uuid","type":{"type":"string"}},{"name":"ship_ids","type":["null",{"type":"string"}]}]}',
    },
    // Test 2: Simplified form
    {
      name: "enemy_deck - simplified",
      schema:
        '{"name":"EnemyDeck","type":"record","fields":[{"name":"env_uuid","type":"string"},{"name":"uuid","type":"string"},{"name":"ship_ids","type":["null","string"]}]}',
    },
    // Test 3: Check if the error is case-related or namespace-related
    {
      name: "env_info - base test",
      schema:
        '{"name":"EnvInfo","type":"record","fields":[{"name":"version","type":"string"},{"name":"uuid","type":{"type":"string"}},{"name":"user_env_unique","type":"string"},{"name":"timestamp","type":"long"}]}',
    },
  ];

  for (const test of testCases) {
    console.log(`Testing: ${test.name}`);
    console.log(`Input schema: ${test.schema.slice(0, 80)}...`);

    const result = match_client_schema(test.schema, "");
    console.log(
      `Result: matched=${result.matched}, version=${result.version}, table=${result.table_name}, error=${result.error}`,
    );
    console.log("");
  }

  // Now check what the server has stored for enemy_deck
  console.log("\n=== Server schemas for comparison ===\n");
  for (const version of versions) {
    const serverEnemyDeck = get_schema_json("enemy_deck", version);
    console.log(`${version} enemy_deck: ${serverEnemyDeck}`);
  }

  console.log("\n=== TEST COMPLETE ===");
}

runDebugTest().catch(console.error);
