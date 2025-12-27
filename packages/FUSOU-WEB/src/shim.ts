import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

// Polyfill Buffer
if (!globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

// Polyfill URL
if (!globalThis.URL) {
  globalThis.URL = URL as any;
}
