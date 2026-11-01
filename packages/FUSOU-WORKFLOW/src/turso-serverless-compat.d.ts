declare module "@tursodatabase/serverless/compat" {
  export interface ResultSet {
    rows: Array<Record<string, unknown>>;
    rowsAffected?: number;
    lastInsertRowid?: bigint | number;
  }

  export interface Client {
    execute(
      statement:
        | string
        | {
            sql: string;
            args?: unknown[] | Record<string, unknown>;
          },
    ): Promise<ResultSet>;
    batch(
      statements: Array<
        | string
        | {
            sql: string;
            args?: unknown[] | Record<string, unknown>;
          }
      >,
      mode?: "write" | "read" | "deferred",
    ): Promise<ResultSet[]>;
    transaction(mode?: "write" | "read" | "deferred"): Promise<Transaction>;
  }

  export interface Transaction {
    execute(statement: string | { sql: string; args?: unknown[] }): Promise<ResultSet>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    close(): void;
  }

  export function createClient(config: {
    url: string;
    authToken: string;
  }): Client;
}
