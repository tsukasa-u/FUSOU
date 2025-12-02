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

export type D1ExecResult = {
  success: boolean;
  error?: string;
  meta?: {
    duration?: number;
    rows_read?: number;
    rows_written?: number;
  };
};

export interface D1Statement {
  bind(...args: unknown[]): D1Statement;
  run(): Promise<D1ExecResult>;
  all?(): Promise<D1AllResult>;
  first?(): Promise<D1Result | undefined>;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
}
