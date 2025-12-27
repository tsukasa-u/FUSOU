
import fs from 'fs';
import path from 'path';

// Define the schema strings directly from our knowledge of what's in the files
const schemaV1 = "{\"name\":\"EnvInfo\",\"type\":\"record\",\"fields\":[{\"name\":\"version\",\"type\":\"string\"},{\"name\":\"uuid\",\"type\":{\"type\":\"string\"}},{\"name\":\"user_env_unique\",\"type\":\"string\"},{\"name\":\"timestamp\",\"type\":\"long\"}]}";
// This matches the modification we just made to schema_v2.json
const schemaV2 = "{\"name\":\"EnvInfo\",\"type\":\"record\",\"fields\":[{\"name\":\"version\",\"type\":\"string\"},{\"name\":\"uuid\",\"type\":{\"type\":\"string\"}},{\"name\":\"user_env_unique\",\"type\":\"string\"},{\"name\":\"timestamp\",\"type\":\"long\"},{\"name\":\"dummy_field\",\"type\":\"string\"}]}";

async function runTest() {
    console.log("Loading WASM...");
    const wasmPath = path.join(process.cwd(), 'pkg/avro_wasm_bg.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = new WebAssembly.Module(wasmBuffer);
    const wasmInstance = new WebAssembly.Instance(wasmModule, { './avro_wasm_bg.js': await import('./pkg/avro_wasm_bg.js') });

    // Initialize bindgen
    const bindgen = await import('./pkg/avro_wasm_bg.js');
    bindgen.__wbg_set_wasm(wasmInstance.exports);
    const { match_client_schema, get_available_versions } = bindgen;

    console.log("Checking available versions...");
    const versions = get_available_versions();
    console.log("Versions available:", versions);

    if (!versions.includes('v1') || !versions.includes('v2')) {
        console.error("FAILURE: Missing required schema versions in build.");
        process.exit(1);
    }

    console.log("Testing matching logic...");

    // Test V1 matching
    console.log("Inputting V1 Schema...");
    
    // DEBUG: Check what the WASM expects
    const expectedV1 = bindgen.get_schema_json('env_info', 'v1');
    console.log("Expected V1 Schema (from WASM):", expectedV1);
    
    const resultV1 = match_client_schema(schemaV1);
    console.log(`Result V1: Matched=${resultV1.matched}, Version=${resultV1.version}, Table=${resultV1.table_name}, Error=${resultV1.error}`);
    // console.log("Canonical Client V1:", bindgen.parse_schema_to_canonical(schemaV1)); // Function needs to be exported if we want to use it, but match_client_schema does it internally.
    
    if (resultV1.matched && resultV1.version === 'v1' && resultV1.table_name === 'env_info') {
        console.log("✅ V1 Matching SUCCESS");
    } else {
        console.error("❌ V1 Matching FAILED");
        // Don't exit yet, let's see V2
        // process.exit(1); 
    }

    // Test V2 matching
    console.log("Inputting V2 Schema (with dummy_field)...");
    const resultV2 = match_client_schema(schemaV2);
    console.log(`Result V2: Matched=${resultV2.matched}, Version=${resultV2.version}, Table=${resultV2.table_name}, Error=${resultV2.error}`);

    if (resultV2.matched && resultV2.version === 'v2' && resultV2.table_name === 'env_info') {
        console.log("✅ V2 Matching SUCCESS");
    } else {
        console.error("❌ V2 Matching FAILED");
        process.exit(1);
    }

    console.log("Test execution completed successfully.");
}

runTest().catch(console.error);
