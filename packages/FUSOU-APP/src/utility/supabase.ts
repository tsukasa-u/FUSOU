import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail fast with a clear message if env vars are missing so requests don't go out without apikey
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in FUSOU-APP/.env"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const getRefreshToken = async (user_id: string) => {
  const { data, error } = await supabase
    .from("users")
    .select("provider_refresh_token")
    .eq("id", user_id)
    .single()
    .then(({ data, error }) => {
      if (error) {
        console.error("Error selecting refresh token:", error);
      } else {
        console.log("Refresh token selected successfully:", data);
      }
      return { data, error };
    });
  if (error) {
    console.error("Error selecting refresh token:", error);
    return null;
  }
  return data?.provider_refresh_token;
};
