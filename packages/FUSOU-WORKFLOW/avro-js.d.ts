/**
 * Type declarations for avro-js
 * https://github.com/apache/avro/tree/master/lang/js
 */

declare module 'avro-js' {
  export function parse(schema: any): any;
  export function createFileDecoder(filePath: string): any;
  export function createFileEncoder(filePath: string, schema: any): any;
  export function extractFileHeader(buffer: Buffer | Uint8Array): any;

  export const streams: {
    RawDecoder: any;
    BlockDecoder: any;
    RawEncoder: any;
    BlockEncoder: any;
  };

  export const types: {
    Type: any;
  };
}
