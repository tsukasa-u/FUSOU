import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { TursoClient } from "../src/db/turso-client";

type Statement = string | { sql: string; args?: unknown[] | Record<string, unknown> };

export function sqliteClient(sql?: string) {
  const database = new DatabaseSync(":memory:");
  if (sql) database.exec(sql);
  const execute = async (statement: Statement) => {
    const query = typeof statement === "string" ? statement : statement.sql;
    const args = typeof statement === "string" ? [] : statement.args ?? [];
    if (!Array.isArray(args)) throw new Error("Fixture expects positional arguments");
    const prepared = database.prepare(query);
    const values = args as SQLInputValue[];
    const rows = prepared.columns().length ? prepared.all(...values) : [];
    if (!prepared.columns().length) prepared.run(...values);
    const meta = database.prepare("SELECT changes() AS changes, last_insert_rowid() AS id").get()!;
    return { rows, rowsAffected: Number(meta["changes"]), lastInsertRowid: Number(meta["id"]) };
  };
  let tail = Promise.resolve();
  const transaction = async () => {
    const previous = tail;
    let unlock = () => {};
    tail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    database.exec("BEGIN IMMEDIATE");
    let open = true;
    return {
      execute,
      commit: async () => { database.exec("COMMIT"); open = false; },
      rollback: async () => { if (open) database.exec("ROLLBACK"); open = false; },
      close: () => { if (open) database.exec("ROLLBACK"); unlock(); },
    };
  };
  const client: TursoClient = {
    execute,
    transaction,
    batch: async (statements) => {
      const tx = await transaction();
      try {
        const results = [];
        for (const statement of statements) results.push(await tx.execute(statement));
        await tx.commit();
        return results;
      } catch (error) {
        await tx.rollback();
        throw error;
      } finally {
        tx.close();
      }
    },
  };
  return { client, database };
}

export function bufferDatabase() {
  return sqliteClient(readFileSync(new URL("../../../docs/sql/turso/schema.sql", import.meta.url), "utf8"));
}

export function d1Fixture(sql: string) {
  const { client, database } = sqliteClient(sql);
  let fail: ((sql: string) => boolean) | undefined;
  const makeStatement = (query: string, args: unknown[] = []): D1PreparedStatement => ({
    bind: (...values: unknown[]) => makeStatement(query, values),
    all: async <T>(): Promise<D1Result<T>> => {
      if (fail?.(query)) throw new Error("Injected D1 failure");
      const result = await client.execute({ sql: query, args });
      return {
        success: true, results: result.rows as T[],
        meta: {
          changes: result.rowsAffected ?? 0, last_row_id: Number(result.lastInsertRowid ?? 0),
          duration: 0, size_after: 0, rows_read: result.rows.length, rows_written: result.rowsAffected ?? 0,
          changed_db: (result.rowsAffected ?? 0) > 0,
        },
      };
    },
    run: async () => makeStatement(query, args).all(),
    first: async (column?: string) => {
      const result = await makeStatement(query, args).all<Record<string, unknown>>();
      return column ? result.results[0]?.[column] ?? null : result.results[0] ?? null;
    },
    raw: async () => { throw new Error("Unused raw fixture"); },
  } as D1PreparedStatement);
  const db = {
    prepare: (query: string) => makeStatement(query),
    batch: async (statements: D1PreparedStatement[]) => {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  } as D1Database;
  return { db, database, injectFailure: (predicate?: (sql: string) => boolean) => { fail = predicate; } };
}
