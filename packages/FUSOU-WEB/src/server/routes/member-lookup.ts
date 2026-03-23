/**
 * Member ID Hash Lookup Routes
 * 
 * Provides member_id_hash lookup functionality for the desktop app authentication flow.
 * Allows checking if a member_id_hash already exists in the system and retrieving
 * associated user information.
 */

import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Bindings } from '../types';
import { CORS_HEADERS } from '../constants';
import { createEnvContext, resolveSupabaseConfig } from '@/server/utils';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to return JSON responses with CORS headers
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
 * POST /member-lookup/check-hash
 * 
 * Check if a member_id_hash already exists in the system.
 * 
 * Request body:
 * {
 *   "member_id_hash": "hashed-member-id"
 * }
 * 
 * Response:
 * {
 *   "exists": boolean,
 *   "user_id": string | null,  // Supabase user ID if exists
 *   "email": string | null,    // Email if exists
 *   "message": string          // User-friendly message
 * }
 * 
 * NOTE: This endpoint queries the `public.user_member_map` table.
 *       Ensure your Supabase project has this table (see docs/sql/supabase/member-id-mapping.sql).
 */
app.post('/check-hash', async (c) => {
  try {
    const body = await c.req.json<{ member_id_hash: string }>();
    const { member_id_hash } = body;

    if (!member_id_hash) {
      return jsonResponse({
        error: 'MISSING_MEMBER_ID_HASH',
        message: 'member_id_hash is required',
      }, 400);
    }

    // Get Supabase config from environment
    const envCtx = createEnvContext(c);
    const { url: supabaseUrl, serviceRoleKey: supabaseServiceKey } = resolveSupabaseConfig(envCtx);

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[check-hash] Supabase configuration missing');
      return jsonResponse({
        error: 'INTERNAL_ERROR',
        message: 'Supabase configuration missing',
      }, 500);
    }

    // Create Supabase client with service role key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Query the user_member_map table for existing member_id_hash
    const { data, error } = await supabaseAdmin
      .from('user_member_map')
      .select('user_id')
      .eq('member_id_hash', member_id_hash);

    if (error) {
      console.error('[check-hash] Supabase query failed:', error);
      return jsonResponse({
        error: 'LOOKUP_FAILED',
        message: 'Failed to lookup member ID',
        details: error.message,
      }, 500);
    }

    if (!data || data.length === 0) {
      // Member ID not found - this is a new user
      return jsonResponse({
        exists: false,
        user_id: null,
        email: null,
        message: 'This member ID is not yet linked to any account. You can create a new account or link to an existing one.',
      }, 200);
    }

    // Member ID found - get user details via Admin API
    const record = data[0] as any;
    const userId: string = record.user_id;
    let email: string | null = null;

    try {
      const { data: userAdmin, error: adminErr } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (!adminErr && userAdmin?.user?.email) {
        email = userAdmin.user.email;
      }
    } catch (e) {
      // If admin lookup fails, proceed without email
    }

    return jsonResponse({
      exists: true,
      user_id: userId,
      email: email,
      message: email
        ? `This member ID is linked to the account: ${email}. Please log in with this account.`
        : 'This member ID is already linked to an existing account.',
    }, 200);

  } catch (error) {
    console.error('Member lookup error:', error);
    return jsonResponse({
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    }, 500);
  }
});

/**
 * POST /member-lookup/verify-ownership
 * 
 * Verify that the authenticated user owns a member_id_hash.
 * Used to ensure a user is linking the correct member ID to their account.
 * 
 * Headers:
 * - Authorization: Bearer <access_token>
 * 
 * Request body:
 * {
 *   "member_id_hash": "hashed-member-id"
 * }
 * 
 * Response:
 * {
 *   "verified": boolean,
 *   "message": string
 * }
 */
app.post('/verify-ownership', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({
        error: 'MISSING_AUTH',
        message: 'Authorization header is required',
      }, 401);
    }

    const accessToken = authHeader.slice(7);

    const body = await c.req.json<{ member_id_hash: string }>();
    const { member_id_hash } = body;

    if (!member_id_hash) {
      return jsonResponse({
        error: 'MISSING_MEMBER_ID_HASH',
        message: 'member_id_hash is required',
      }, 400);
    }

    const envCtx = createEnvContext(c);
    const { url: supabaseUrl, serviceRoleKey: supabaseServiceKey } = resolveSupabaseConfig(envCtx);

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[verify-ownership] Supabase configuration missing');
      return jsonResponse({
        error: 'INTERNAL_ERROR',
        message: 'Supabase configuration missing',
      }, 500);
    }

    // Create Supabase client with service role key for verification
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify the access token and get user ID
    const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !userData?.user) {
      console.error('[verify-ownership] Invalid token:', authError);
      return jsonResponse({
        error: 'INVALID_TOKEN',
        message: 'Invalid or expired access token',
      }, 401);
    }

    const userId = userData.user.id;

    // FIRST: Check if ANY user already has this member_id_hash (detect conflict)
    const { data: conflictData, error: conflictError } = await supabaseAdmin
      .from('user_member_map')
      .select('user_id')
      .eq('member_id_hash', member_id_hash);

    if (conflictError) {
      console.error('[verify-ownership] Conflict check failed:', conflictError);
      return jsonResponse({
        error: 'VERIFICATION_FAILED',
        message: 'Failed to verify member ID conflict',
        details: conflictError.message,
      }, 500);
    }

    // If member_id_hash is already owned by someone else
    if (conflictData && conflictData.length > 0) {
      const existingOwner = conflictData[0] as any;
      const ownerUserId: string = existingOwner.user_id;
      
      console.log('[verify-ownership] Conflict check result:', {
        member_id_hash,
        current_user: userId,
        existing_owner: ownerUserId,
        is_same_user: ownerUserId === userId,
      });
      
      // If it's owned by the SAME user (already verified), that's OK
      if (ownerUserId === userId) {
        return jsonResponse({
          verified: true,
          message: 'This member ID is already linked to your account.',
        }, 200);
      }
      
      // If it's owned by a DIFFERENT user, check if the owner is anonymous
      let ownerEmail: string | null = null;
      let isAnonymousOwner = false;
      try {
        const { data: ownerAdmin } = await supabaseAdmin.auth.admin.getUserById(ownerUserId);
        ownerEmail = ownerAdmin?.user?.email ?? null;
        isAnonymousOwner = !!(ownerAdmin?.user?.is_anonymous);
      } catch (_) {}

      // If the existing owner is an anonymous user, allow migration
      if (isAnonymousOwner) {
        console.log('[verify-ownership] Existing owner is anonymous - migration allowed:', {
          member_id_hash: member_id_hash ? member_id_hash.slice(0, 8) + '...' : null,
          current_user: userId ? userId.slice(0, 8) + '...' : null,
          anonymous_owner: ownerUserId ? ownerUserId.slice(0, 8) + '...' : null,
        });
        return jsonResponse({
          verified: false,
          migrateable: true,
          message: 'This member ID is currently linked to an anonymous session and can be migrated to your account.',
        }, 200);
      }

      console.warn('[verify-ownership] CONFLICT DETECTED:', {
        member_id_hash: member_id_hash ? member_id_hash.slice(0, 8) + '...' : null,
        current_user: userId ? userId.slice(0, 8) + '...' : null,
        existing_owner: ownerUserId ? ownerUserId.slice(0, 8) + '...' : null,
      });
      
      return jsonResponse({
        error: 'MEMBER_ID_CONFLICT',
        message: `This member ID is already linked to another account: ${ownerEmail || 'unknown'}`,
      }, 409);
    }

    // member_id_hash is not owned by anyone yet, safe to use
    console.log('[verify-ownership] No conflict - member_id_hash is available:', member_id_hash ? member_id_hash.slice(0, 8) + '...' : null);
    return jsonResponse({
      verified: false,
      message: 'This member ID is not linked to any account yet. You can link it now.',
    }, 200);

  } catch (error) {
    console.error('Verify ownership error:', error);
    return jsonResponse({
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    }, 500);
  }
});

export default app;