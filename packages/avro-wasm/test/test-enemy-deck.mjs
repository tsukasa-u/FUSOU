import fs from "fs";
import path from "path";

// Test EnemyDeck schema matching
const enemyDeckSchemaClient =
  '{"name":"EnemyDeck","type":"record","fields":[{"name":"env_uuid","type":{"type":"string"}},{"name":"uuid","type":{"type":"string"}},{"name":"ship_ids","type":["null",{"type":"string"}]}]}';

async function runTest() {
  console.log("Loading WASM with web target...");

  // For web target, we need to use the init() function
  const {
    default: init,
    match_client_schema,
    get_available_versions,
    get_schema_json,
    get_available_schemas,
  } = await import("../pkg/avro_wasm.js");

  // Read WASM binary and initialize
  const wasmPath = path.join(process.cwd(), "pkg/avro_wasm_bg.wasm");
  const wasmBuffer = fs.readFileSync(wasmPath);

  await init(wasmBuffer);
  console.log("WASM initialized successfully");

  console.log("Checking available versions...");
  const versions = get_available_versions();
  console.log("Versions available:", versions);

  console.log("\nChecking available schemas in v0_5...");
  const v05Schemas = get_available_schemas("v0_5");
  console.log("V0_5 table names:", v05Schemas);

  // Check if enemy_deck is available
  console.log("\nChecking enemy_deck schema in v0_5...");
  const enemyDeckServer = get_schema_json("enemy_deck", "v0_5");
  console.log("Server enemy_deck schema:", enemyDeckServer);

  console.log("\nClient enemy_deck schema:", enemyDeckSchemaClient);

  // Test matching
  console.log("\nTesting enemy_deck schema matching...");
  const result = match_client_schema(enemyDeckSchemaClient, "");
  console.log(
    `Result: Matched=${result.matched}, Version=${result.version}, Table=${result.table_name}, Error=${result.error}`,
  );

  if (result.matched && result.table_name === "enemy_deck") {
    console.log("✅ enemy_deck Matching SUCCESS");
  } else {
    console.error("❌ enemy_deck Matching FAILED");
    process.exit(1);
  }

  console.log("\nTest completed successfully.");
}

runTest().catch(console.error);
