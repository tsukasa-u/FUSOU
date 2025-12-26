/**
 * Type declarations for avro-js
 * https://github.com/apache/avro/tree/master/lang/js
 */

declare module 'avro-js' {
  export class Type {
    static forSchema(schema: any): Type;
    createBinaryEncoder(stream: any): any;
    createBinaryDecoder(buffer: Buffer | Uint8Array): any;
  }

  export interface DecodeOptions {
    schema?: any;
  }

  export function createDecoder(buffer: Buffer | Uint8Array, options?: DecodeOptions): any;
}
