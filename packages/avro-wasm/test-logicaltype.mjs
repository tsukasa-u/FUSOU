import fs from 'fs';
import path from 'path';

/**
 * Test canonical form comparison with logicalType
 */

async function runTest() {
    console.log("=== LOGICAL TYPE CANONICAL FORM TEST ===\n");
    
    const { default: init, match_client_schema, init_panic_hook } = await import('./pkg/avro_wasm.js');
    
    const wasmPath = path.join(process.cwd(), 'pkg/avro_wasm_bg.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    
    await init(wasmBuffer);
    init_panic_hook();
    console.log("WASM initialized\n");

    // Actual client schema (with logicalType:uuid)
    const clientSchema = '{"type":"record","name":"EnemyDeck","fields":[{"name":"env_uuid","type":{"type":"string","logicalType":"uuid"}},{"name":"uuid","type":{"type":"string","logicalType":"uuid"}},{"name":"ship_ids","type":["null",{"type":"string","logicalType":"uuid"}]}]}';
    
    // Server schema (without logicalType, as stored in schema_v1.json)
    const serverSchema = '{"name":"EnemyDeck","type":"record","fields":[{"name":"env_uuid","type":{"type":"string"}},{"name":"uuid","type":{"type":"string"}},{"name":"ship_ids","type":["null",{"type":"string"}]}]}';

    console.log("Client schema (with logicalType):");
    console.log(clientSchema);
    console.log("");
    
    console.log("Server schema (without logicalType, as in schema_v1.json):");
    console.log(serverSchema);
    console.log("");

    // Test matching
    console.log("Testing client schema matching...");
    const result = match_client_schema(clientSchema);
    console.log(`Result: matched=${result.matched}, version=${result.version}, table=${result.table_name}, error=${result.error}`);

    if (!result.matched) {
        console.log("\n❌ FAILED - logicalType causes mismatch!");
        console.log("The canonical_form() strips logicalType on PARSE, not in stored string.");
        console.log("Server stores canonical (no logicalType), but compares with canonical of client (also no logicalType).");
        console.log("This should match... unless there's a difference in field order or structure.\n");
    }

    console.log("\n=== TEST COMPLETE ===");
}

runTest().catch(console.error);
