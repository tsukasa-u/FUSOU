#!/usr/bin/env node

/*
 * Turso bootstrap helper for hot buffer tables.
 *
 * Note: This script intentionally does not migrate TiDB row data.
 * It only applies the Turso schema required by FUSOU-WORKFLOW.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@tursodatabase/serverless/compat";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required");
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(
    scriptDir,
    "../../../docs/sql/turso/migration_0001_create_buffer_tables.sql",
  );
  const sql = await fs.readFile(schemaPath, "utf8");

  const client = createClient({ url, authToken });
  // Split simple migration file into statements to run via execute.
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await client.execute(statement);
  }

  console.log("[turso] Schema bootstrap completed");
}

main().catch((error) => {
  console.error("[turso] Schema bootstrap failed", error);
  process.exit(1);
});
