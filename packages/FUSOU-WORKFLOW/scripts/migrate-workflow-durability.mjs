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
    "../../../docs/sql/turso/migration_0001_workflow_durability.sql"
  );
  const sql = await fs.readFile(schemaPath, "utf8");

  const client = createClient({ url, authToken });
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log("[turso] Applying migration_0001_workflow_durability.sql...");
  for (const statement of statements) {
    console.log("[turso] Executing statement:\n", statement);
    await client.execute(statement);
  }

  const verify = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('workflow_queue_receipts', 'workflow_compaction_state')"
  );
  console.log("[turso] Verified tables created:", verify.rows.map((r) => r.name));

  const stateRow = await client.execute("SELECT * FROM workflow_compaction_state WHERE id = 1");
  console.log("[turso] Initial state row:", stateRow.rows[0]);

  console.log("[turso] Migration 0001_workflow_durability completed successfully.");
}

main().catch((error) => {
  console.error("[turso] Migration failed:", error);
  process.exit(1);
});
