/**
 * Cloudflare Pages Worker entry point
 * Exports Durable Object classes for use in the project
 */

// This file is required to enable Durable Objects in Pages Functions
// Durable Object classes must be exported from the worker entry point

// Export Durable Object classes
export { CompactorDO } from '../src/server/durable-objects/CompactorDO';

// Re-export Pages Functions handlers
export { onRequest as onRequestCompact } from './api/compact';
