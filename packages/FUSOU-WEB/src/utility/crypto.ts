import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a UUID v4 using the uuid library
 * Compatible with Cloudflare Workers and all JavaScript environments
 * @returns UUID v4 string format (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateUUID(): string {
  return uuidv4();
}

