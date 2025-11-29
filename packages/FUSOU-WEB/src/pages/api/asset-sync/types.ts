// Minimal shared types for asset-sync D1 and cache structures

export type AssetKeyCache = {
  keys: string[];
  refreshedAt: number;
  expiresAt: number;
  etag: string;
};

export type D1Row = Record<string, unknown>;

export type D1Result = Record<string, unknown>;

export type D1AllResult = {
  results?: D1Row[];
};

export interface D1Statement {
  bind(...args: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all?(): Promise<D1AllResult>;
  first?(): Promise<D1Result | undefined>;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
}
