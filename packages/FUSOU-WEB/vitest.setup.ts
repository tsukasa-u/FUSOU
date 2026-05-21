import { vi } from 'vitest';

// Mock Cloudflare Workers environment
vi.mock('cloudflare:workers', () => ({
  KVNamespace: class {
    async get() { return null; }
    async put() {}
    async delete() {}
  },
  env: {},
}));
