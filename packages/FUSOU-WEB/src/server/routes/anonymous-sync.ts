import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { createEnvContext, getEnv, resolveSupabaseConfig } from '../utils';
import type { Bindings } from '../types';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * GET /anonymous-sync/diagnostics
 * 
 * Provides environment and Supabase configuration diagnostics to help
 * troubleshoot anonymous sign-in issues.
 */
app.get('/anonymous-sync/diagnostics', async (c) => {
  try {
    const envCtx = createEnvContext({ env: c.env });
    const supabaseConfig = resolveSupabaseConfig(envCtx);

    const datasetTokenSecret = getEnv(envCtx, 'DATASET_TOKEN_SECRET');

    // Attempt to read auth config via service role
    let authConfig: any = null;
    if (supabaseConfig.url && supabaseConfig.serviceRoleKey) {
      const admin = createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey);
      const { data, error } = await admin
        .from('auth.config' as any)
        .select('enable_anonymous_sign_ins, external_url')
        .limit(1);
      if (!error && data && data.length > 0) {
        authConfig = data[0];
      }
    }

    // Fetch GoTrue settings directly (if possible)
    let authSettings: any = null;
    if (supabaseConfig.url && supabaseConfig.serviceRoleKey) {
      try {
        const resp = await fetch(`${supabaseConfig.url}/auth/v1/settings`, {
          headers: {
            apikey: supabaseConfig.serviceRoleKey,
            Authorization: `Bearer ${supabaseConfig.serviceRoleKey}`,
          },
        });
        if (resp.ok) {
          authSettings = await resp.json();
        }
      } catch (e) {
        console.warn('[anonymous-sync/diagnostics] Failed to fetch GoTrue settings:', e);
      }
    }

    return c.json({
      supabase: {
        url: supabaseConfig.url,
        hasServiceRoleKey: Boolean(supabaseConfig.serviceRoleKey),
        hasPublishableKey: Boolean(supabaseConfig.publishableKey),
        authConfig,
        authSettings,
      },
      datasetTokenSecret: {
        configured: Boolean(datasetTokenSecret),
        length: datasetTokenSecret ? datasetTokenSecret.length : 0,
        valid: Boolean(datasetTokenSecret && datasetTokenSecret.length >= 32),
      },
    });
  } catch (err) {
    console.error('[anonymous-sync/diagnostics] Unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /anonymous-sync
 * 
 * Anonymous authentication endpoint for background session acquisition.
 * - Creates or restores anonymous Supabase session based on member_id_hash
 * - Issues dataset_token (7-day TTL) for upload authorization
 * - Maintains 1:1 mapping between member_id_hash and anonymous user
 */
app.post('/anonymous-sync', async (c) => {
  try {
    const body = await c.req.json();
    const { member_id_hash } = body;

    if (!member_id_hash || typeof member_id_hash !== 'string') {
      return c.json({ error: 'member_id_hash is required' }, 400);
    }

    // Get environment configuration
    const envCtx = createEnvContext({ env: c.env });
    const supabaseConfig = resolveSupabaseConfig(envCtx);
    
    // Dataset token secret (must be configured in environment)
    const datasetTokenSecret = getEnv(envCtx, 'DATASET_TOKEN_SECRET');
    if (!datasetTokenSecret) {
      console.error('[anonymous-sync] DATASET_TOKEN_SECRET not configured');
      return c.json({ error: 'Server configuration error' }, 500);
    }

    // Validate dataset token secret has sufficient entropy (minimum 32 bytes recommended)
    if (datasetTokenSecret.length < 32) {
      console.error('[anonymous-sync] DATASET_TOKEN_SECRET too short (minimum 32 characters recommended)');
      return c.json({ error: 'Server configuration error' }, 500);
    }

    // Admin client for user_member_map lookup
    if (!supabaseConfig.url || !supabaseConfig.serviceRoleKey) {
      console.error('[anonymous-sync] Supabase configuration missing');
      return c.json({ error: 'Server configuration error' }, 500);
    }
    
    const supabaseAdmin = createClient(
      supabaseConfig.url,
      supabaseConfig.serviceRoleKey
    );

    // Check if member_id_hash already mapped
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('user_member_map')
      .select('user_id')
      .eq('member_id_hash', member_id_hash)
      .maybeSingle();

    if (lookupError) {
      console.error('[anonymous-sync] Database lookup error:', lookupError);
      return c.json({ error: 'Database error' }, 500);
    }

    let userId: string;
    let accessToken: string;
    let refreshToken: string;
    let status: 'created' | 'restored' | 'recreated';

    // Anon client for session creation
    const anonKey = supabaseConfig.publishableKey;
    if (!anonKey) {
      console.error('[anonymous-sync] Supabase anon key missing');
      return c.json({ error: 'Server configuration error' }, 500);
    }
    
    const anonClient = createClient(
      supabaseConfig.url,
      anonKey
    );

    if (existing) {
      // Existing mapping found - validate user still exists
      userId = existing.user_id;
      status = 'restored';

      // Verify user still exists and is valid
      let userExists = true;
      try {
        const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (userError || !userData?.user) {
          console.warn('[anonymous-sync] Mapped user no longer exists, will create new session:', {
            member_id_hash,
            missing_user_id: userId,
            error: userError?.message
          });
          userExists = false;
        }
      } catch (e) {
        console.warn('[anonymous-sync] Failed to verify user existence:', e);
        userExists = false;
      }

      if (!userExists) {
        // User was deleted - create new anonymous session and update mapping
        const { data: sessionData, error: sessionError } = await anonClient.auth.signInAnonymously({
          options: {
            data: { member_id_hash }
          }
        });

        if (sessionError || !sessionData.session) {
          console.error('[anonymous-sync] Failed to create new anonymous user after deletion:', {
            message: (sessionError as any)?.message,
            status: (sessionError as any)?.status,
          });
          return c.json({ error: 'Failed to create session' }, 500);
        }

        const newUserId = sessionData.user?.id;
        if (!newUserId) {
          console.error('[anonymous-sync] Session missing user_id');
          return c.json({ error: 'Failed to create session' }, 500);
        }

        // Update mapping with new user_id
        const { error: updateError } = await supabaseAdmin
          .from('user_member_map')
          .update({ user_id: newUserId })
          .eq('member_id_hash', member_id_hash);

        if (updateError) {
          console.error('[anonymous-sync] Failed to update mapping after user deletion:', updateError);
          return c.json({ error: 'Failed to update session mapping' }, 500);
        }

        userId = newUserId;
        accessToken = sessionData.session.access_token;
        refreshToken = sessionData.session.refresh_token;
        status = 'recreated';
      } else {
        // User exists - just issue dataset_token without creating new session
        // (Supabase anonymous sessions are per-request; we rely on dataset_token for auth)
        // Retrieve existing tokens if available
        const { data: sessionData, error: sessionError } = await anonClient.auth.signInAnonymously({
          options: {
            data: { member_id_hash }
          }
        });

        if (sessionError || !sessionData.session) {
          // Fallback: issue dataset_token based on existing mapping without new session
          console.warn('[anonymous-sync] Failed to create new session for restored user, issuing dataset token only:', {
            message: (sessionError as any)?.message,
          });

          const now = Math.floor(Date.now() / 1000);
          const secretKey = new TextEncoder().encode(datasetTokenSecret);
          const datasetToken = await new SignJWT({
            sub: userId,
            dataset_id: member_id_hash,
            typ: 'dataset',
            aud: 'fusou-upload'
          })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt(now)
            .setExpirationTime(now + (7 * 24 * 60 * 60)) // 7 days
            .sign(secretKey);

          return c.json({
            status: 'restored_no_session',
            dataset_token: datasetToken,
            dataset_token_expires_at: now + (7 * 24 * 60 * 60)
          });
        }

        accessToken = sessionData.session.access_token;
        refreshToken = sessionData.session.refresh_token;
      }

    } else {
      // New user - create anonymous session and mapping
      const { data: sessionData, error: sessionError } = await anonClient.auth.signInAnonymously({
        options: {
          data: { member_id_hash }
        }
      });

      if (sessionError || !sessionData.session) {
        console.error('[anonymous-sync] Failed to create anonymous user:', {
          message: (sessionError as any)?.message,
          status: (sessionError as any)?.status,
          code: (sessionError as any)?.code,
        });
        // No existing mapping; cannot issue dataset token safely without user_id
        return c.json({ error: 'Failed to create session' }, 500);
      }

      const newUserId = sessionData.user?.id;
      if (!newUserId) {
        console.error('[anonymous-sync] Session missing user_id');
        return c.json({ error: 'Failed to create session' }, 500);
      }

      userId = newUserId;
      accessToken = sessionData.session.access_token;
      refreshToken = sessionData.session.refresh_token;
      status = 'created';

      // Insert into user_member_map
      const { error: insertError } = await supabaseAdmin
        .from('user_member_map')
        .insert({
          user_id: userId,
          member_id_hash: member_id_hash
        });

      if (insertError) {
        console.error('[anonymous-sync] Failed to insert mapping:', insertError);
        return c.json({ error: 'Failed to create mapping' }, 500);
      }
    }

    // Generate dataset_token (7-day TTL)
    const now = Math.floor(Date.now() / 1000);
    const secretKey = new TextEncoder().encode(datasetTokenSecret);
    const datasetToken = await new SignJWT({
      sub: userId,
      dataset_id: member_id_hash,
      typ: 'dataset',
      aud: 'fusou-upload'
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(now + (7 * 24 * 60 * 60)) // 7 days
      .sign(secretKey);

    console.log(`[anonymous-sync] ${status} anonymous session for member_id_hash: ${member_id_hash.substring(0, 8)}...`);

    return c.json({
      status,
      access_token: accessToken,
      refresh_token: refreshToken,
      dataset_token: datasetToken,
      dataset_token_expires_at: now + (7 * 24 * 60 * 60)
    });

  } catch (error) {
    console.error('[anonymous-sync] Unexpected error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
