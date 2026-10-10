#!/usr/bin/env node

import { writeAppWorkerReference } from "./app-worker-deployment-reference.mjs";

writeAppWorkerReference(process.env).catch((error) => {
  console.error(`[tlsn-app-worker-reference] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
