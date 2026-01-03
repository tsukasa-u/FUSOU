/**
 * API Keys Management Routes
 * 
 * Provides endpoints for managing user API keys for fusou-datasets.
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import { CORS_HEADERS } from '../constants';
import { createEnvContext, resolveSupabaseConfig } from '../utils';
import { checkAndDeductRU } from '../utils/ru';

const app = new Hono<{ Bindings: Bindings }>();

// =============================================================================
// Constants
// =============================================================================

const API_KEY_PREFIX = 'fsk_';
const API_KEY_LENGTH = 32;

// =============================================================================
// Helper Functions
// =============================================================================

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/**
 * Generate a secure random API key
 */
function generateApiKey(): string {
  const bytes = new Uint8Array(API_KEY_LENGTH);
  crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${API_KEY_PREFIX}${base64}`;
}

/**
 * Mask API key for display (show only first 8 and last 4 chars)
 */
function maskApiKey(key: string): string {
  if (key.length <= 12) return '***';
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

/**
 * Get Supabase config from context
 */
function getSupabaseConfig(c: { env: Bindings }) {
  const envCtx = createEnvContext(c);
  const { url, serviceRoleKey } = resolveSupabaseConfig(envCtx);
  return { url: url || '', key: serviceRoleKey || '' };
}

/**
 * Make a request to Supabase REST API
 */
async function supabaseRequest<T = unknown[]>(
  config: { url: string; key: string },
  table: string,
  options: {
    method?: string;
    query?: string;
    body?: object | null;
    headers?: Record<string, string>;
  } = {}
): Promise<T | null> {
  const { method = 'GET', query = '', body = null, headers = {} } = options;
  const { url, key } = config;

  if (!url || !key) {
    throw new Error('Supabase configuration missing');
  }

  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
      ...headers,
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error: ${response.status} - ${error}`);
  }

  if (method === 'GET' || headers.Prefer?.includes('return=representation')) {
    return response.json() as Promise<T>;
  }

  return null;
}

/**
 * Verify Supabase access token and get user info
 */
async function verifyAccessToken(
  config: { url: string; key: string },
  accessToken: string
): Promise<{ id: string; email: string } | null> {
  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) return null;

    const user = await response.json() as { id: string; email: string };
    return user;
  } catch {
    return null;
  }
}

// =============================================================================
// Routes
// =============================================================================

// OPTIONS (CORS)
app.options('*', () => new Response(null, { status: 204, headers: CORS_HEADERS }));

/**
 * GET /api-keys/usage - Get current usage status for the authenticated user
 */
app.get('/usage', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const accessToken = authHeader.slice(7);
  const config = getSupabaseConfig(c);

  try {
    const user = await verifyAccessToken(config, accessToken);
    if (!user) {
      return jsonResponse({ error: 'Invalid token' }, 401);
    }
    
    // Get RU Status
    const env = createEnvContext(c);
    const kv = env.runtime.DATA_LOADER_CACHE_KV;
    let usage = {
      remaining: 1000,
      consumed: 0,
      reset_at: null as number | null,
    };
    
    if (kv) {
       // Check with 0 cost to peek status
       const result = await checkAndDeductRU(kv, user.id, 0);
       usage.remaining = result.remaining;
       // Note: actual consumed isn't tracked in bucket logic (only remaining is), 
       // but we can infer or leave consumed as 0 if we don't have historical data.
    }
    
    return jsonResponse({ success: true, usage });
  } catch (error) {
    console.error('Usage check error:', error);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
});

/**
 * GET /api-keys - List user's API keys
 */
app.get('/', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const accessToken = authHeader.slice(7);
  const config = getSupabaseConfig(c);

  try {
    const user = await verifyAccessToken(config, accessToken);
    if (!user) {
      return jsonResponse({ error: 'Invalid token' }, 401);
    }

    const apiKeys = await supabaseRequest<{
      id: string;
      key: string;
      email: string;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }[]>(config, 'api_keys', {
      query: `?user_id=eq.${user.id}&order=created_at.desc&select=id,key,email,is_active,created_at,updated_at`,
    });

    const maskedKeys = (apiKeys || []).map((k) => ({
      id: k.id,
      key_masked: maskApiKey(k.key),
      email: k.email,
      is_active: k.is_active,
      created_at: k.created_at,
      updated_at: k.updated_at,
    }));

    return jsonResponse({ success: true, api_keys: maskedKeys });
  } catch (error) {
    console.error('API keys list error:', error);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
});

/**
 * POST /api-keys - Create a new API key
 */
app.post('/', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const accessToken = authHeader.slice(7);
  const config = getSupabaseConfig(c);

  let body: { name?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // Empty body is allowed
  }

  try {
    const user = await verifyAccessToken(config, accessToken);
    if (!user) {
      return jsonResponse({ error: 'Invalid token' }, 401);
    }

    // Generate new API key
    const newKey = generateApiKey();

    const result = await supabaseRequest<{ id: string; key: string }[]>(config, 'api_keys', {
      method: 'POST',
      body: {
        user_id: user.id,
        key: newKey,
        email: user.email,
        is_active: true,
      },
      headers: { Prefer: 'return=representation' },
    });

    if (!result || result.length === 0) {
      return jsonResponse({ error: 'Failed to create API key' }, 500);
    }

    // Return the full key only on creation (user must copy it now)
    return jsonResponse({
      success: true,
      api_key: {
        id: result[0].id,
        key: result[0].key, // Full key shown only once
        email: user.email,
        message: 'Copy this key now. It will not be shown again.',
      },
    });
  } catch (error) {
    console.error('API key create error:', error);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
});

/**
 * DELETE /api-keys/:id - Delete an API key
 */
app.delete('/:id', async (c) => {
  const keyId = c.req.param('id');
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const accessToken = authHeader.slice(7);
  const config = getSupabaseConfig(c);

  try {
    const user = await verifyAccessToken(config, accessToken);
    if (!user) {
      return jsonResponse({ error: 'Invalid token' }, 401);
    }

    // Delete only if it belongs to the user
    await supabaseRequest(config, 'api_keys', {
      method: 'DELETE',
      query: `?id=eq.${keyId}&user_id=eq.${user.id}`,
    });

    return jsonResponse({ success: true, message: 'API key deleted' });
  } catch (error) {
    console.error('API key delete error:', error);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
});

/**
 * PATCH /api-keys/:id - Update API key (toggle active)
 */
app.patch('/:id', async (c) => {
  const keyId = c.req.param('id');
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const accessToken = authHeader.slice(7);
  const config = getSupabaseConfig(c);

  let body: { is_active?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    return jsonResponse({ error: 'Invalid body' }, 400);
  }

  try {
    const user = await verifyAccessToken(config, accessToken);
    if (!user) {
      return jsonResponse({ error: 'Invalid token' }, 401);
    }

    const updateData: Record<string, unknown> = {};
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    if (Object.keys(updateData).length === 0) {
      return jsonResponse({ error: 'No fields to update' }, 400);
    }

    await supabaseRequest(config, 'api_keys', {
      method: 'PATCH',
      query: `?id=eq.${keyId}&user_id=eq.${user.id}`,
      body: updateData,
    });

    return jsonResponse({ success: true, message: 'API key updated' });
  } catch (error) {
    console.error('API key update error:', error);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
});

/**
 * GET /api-keys/devices - List trusted devices
 */
app.get('/devices', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const accessToken = authHeader.slice(7);
  const config = getSupabaseConfig(c);

  try {
    const user = await verifyAccessToken(config, accessToken);
    if (!user) {
      return jsonResponse({ error: 'Invalid token' }, 401);
    }

    const devices = await supabaseRequest<{
      id: string;
      client_id: string;
      device_name: string | null;
      created_at: string;
      last_used_at: string | null;
    }[]>(config, 'trusted_devices', {
      query: `?user_id=eq.${user.id}&order=last_used_at.desc.nullslast&select=id,client_id,device_name,created_at,last_used_at`,
    });

    const maskedDevices = (devices || []).map((d) => ({
      id: d.id,
      client_id_masked: `${d.client_id.slice(0, 8)}...`,
      device_name: d.device_name || 'Unknown Device',
      created_at: d.created_at,
      last_used_at: d.last_used_at,
    }));

    return jsonResponse({ success: true, devices: maskedDevices });
  } catch (error) {
    console.error('Devices list error:', error);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
});

/**
 * DELETE /api-keys/devices/:id - Revoke a trusted device
 */
app.delete('/devices/:id', async (c) => {
  const deviceId = c.req.param('id');
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const accessToken = authHeader.slice(7);
  const config = getSupabaseConfig(c);

  try {
    const user = await verifyAccessToken(config, accessToken);
    if (!user) {
      return jsonResponse({ error: 'Invalid token' }, 401);
    }

    await supabaseRequest(config, 'trusted_devices', {
      method: 'DELETE',
      query: `?id=eq.${deviceId}&user_id=eq.${user.id}`,
    });

    return jsonResponse({ success: true, message: 'Device revoked' });
  } catch (error) {
    console.error('Device revoke error:', error);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
});

export default app;
