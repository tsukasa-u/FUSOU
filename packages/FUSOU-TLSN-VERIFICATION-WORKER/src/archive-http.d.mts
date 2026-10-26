import type { CatalogReader } from "./archive-catalog.mjs";
export function handleArchiveHttp(request: Request, options: {
  policyRaw: string | undefined; policySha256: string | undefined; authority: CatalogReader;
  bucket: { get(key: string): Promise<{ size: number; version: string; customMetadata?: Record<string, string>; arrayBuffer(): Promise<ArrayBuffer> } | null> };
}): Promise<Response>;
