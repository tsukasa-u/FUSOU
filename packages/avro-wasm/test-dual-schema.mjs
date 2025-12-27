
import { get_available_versions } from './pkg/avro_wasm.js';

console.log("Loading WASM...");
// Since we are running in Node, we might need to handle the WASM loading if it's not auto-handled by the bundler format in this script context.
// However, the 'bundler' target usually expects a bundler or specific init. 
// But let's try to see if we can just run it or if we need a quick loader.
// Actually, 'bundler' target outputs `avro_wasm.js` which exports `__wbg_set_wasm`. 
// We need to read the wasm file and set it.

import fs from 'fs';
import path from 'path';

// Manual WASM initialization for Node script
const wasmPath = path.join(process.cwd(), 'pkg/avro_wasm_bg.wasm');
const wasmBuffer = fs.readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBuffer);
const wasmInstance = new WebAssembly.Instance(wasmModule, { './avro_wasm_bg.js': await import('./pkg/avro_wasm_bg.js') });

// Initialize the bindgen module with the instance exports
const bindgen = await import('./pkg/avro_wasm_bg.js');
bindgen.__wbg_set_wasm(wasmInstance.exports);

console.log("Checking available versions...");
const versions = get_available_versions();
console.log("Versions found:", versions);

if (versions.includes('v1') && versions.includes('v2')) {
    console.log("SUCCESS: Both v1 and v2 schemas are available.");
} else {
    console.error("FAILURE: Missing schema versions.", versions);
    process.exit(1);
}
