import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      flowType: "pkce",
    },
  }
);

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
