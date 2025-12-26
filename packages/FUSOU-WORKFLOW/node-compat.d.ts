/**
 * Minimal type definitions for nodejs_compat in Cloudflare Workers
 * Allows use of node:stream and Buffer with typescript checking
 */

declare module 'node:stream' {
  export class Readable {
    static from(iterable: Iterable<any> | AsyncIterable<any>): Readable;
    on(event: string, listener: (...args: any[]) => void): this;
  }
}

declare const Buffer: {
  from(data: Uint8Array): any;
};
