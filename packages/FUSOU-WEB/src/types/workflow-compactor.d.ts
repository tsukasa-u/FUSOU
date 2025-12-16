declare module "../../FUSOU-WORKFLOW/src/parquet-compactor" {
  // Minimal type surface to allow dynamic import without TS resolution errors
  // Actual implementations live in packages/FUSOU-WORKFLOW
  export interface RowGroupInfo {
    index: number;
    offset: number;
    totalByteSize: number;
    numRows: number;
    columnChunks: Array<{ columnIndex: number; offset: number; size: number; type: string }>;
  }
  export function parseParquetMetadata(footerData: Uint8Array): RowGroupInfo[];
  export function compactFragmentedRowGroups(
    bucket: R2Bucket,
    bucketKey: string,
    footerStart: number,
    rowGroups: RowGroupInfo[],
    fragmentedIndices: number[],
    readRange: (bucket: R2Bucket, key: string, offset: number, length: number) => Promise<Uint8Array>
  ): Promise<{ newFileSize: number; newRowGroupCount: number; etag: string }>;
}
