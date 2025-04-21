import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { env } from "./env.js";

export const supabase = createClient(
  env.SUPABASE_URL, 
  env.SUPABASE_ANON_KEY
);

export const getRefreshToken = async (user_id) => {
  const { data, error } = await supabase.from('users')
    .select('provider_refresh_token')
    .eq('id', user_id)
    .single()
    .then(({ data, error }) => {
      if (error) {
        console.error('Error selecting refresh token:', error);
      } else {
        console.log('Refresh token selected successfully:', data);
      }
      return { data, error };
    });
  if (error) {
    console.error('Error selecting refresh token:', error);
    return null;
  }
  return data?.provider_refresh_token;
}