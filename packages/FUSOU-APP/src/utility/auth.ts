import { supabase } from './supabase';

/**
 * Returns the currently active access token (or null) from supabase client session.
 * This centralizes access so multiple pages can reuse the same logic.
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      // silently return null — caller will handle public vs private cases
      return null;
    }
    return data?.session?.access_token ?? null;
  } catch (e) {
    return null;
  }
}

export default getAuthToken;
