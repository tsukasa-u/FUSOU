import { createClient } from "@supabase/supabase-js";
import { getRequiredClientEnv } from "@/utility/clientEnv";

// This file is used only for chartPage
// You should delete this file in the future

export const supabase = createClient(
  getRequiredClientEnv("PUBLIC_SUPABASE_URL"),
  getRequiredClientEnv("PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  {
    auth: {
      flowType: "pkce",
    },
  }
);

// export const getRefreshToken = async (user_id: string) => {
//   const { data, error } = await supabase
//     .from("users")
//     .select("provider_refresh_token")
//     .eq("id", user_id)
//     .single()
//     .then(({ data, error }) => {
//       if (error) {
//         console.error("Error selecting refresh token:", error);
//       } else {
//         console.log("Refresh token selected successfully:", data);
//       }
//       return { data, error };
//     });
//   if (error) {
//     console.error("Error selecting refresh token:", error);
//     return null;
//   }
//   return data?.provider_refresh_token;
// };
