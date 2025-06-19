import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  // process.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
  // process.env.PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      flowType: "pkce",
    },
  }
);

// import { createClient } from '@supabase/supabase-js'

// export const createSupabaseServerClient = ({context, request}: {
//     context: {
//         cloudflare: {
//             env: Pick<ENV, 'SUPABASE_KEY' | 'SUPABASE_URL'>
//         }
//     },
//     request: Request
// }, headers: Headers) => {
//     const supabaseClient = createClient(
//       context.cloudflare.env.SUPABASE_URL,
//       context.cloudflare.env.SUPABASE_KEY,
//     )
//     return supabaseClient
// }

// export default {
//     async fetch(request, env) {
//       const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
//       const { data, error } = await supabase.from("countries").select('*');
//       if (error) throw error;
//       return new Response(JSON.stringify(data), {
//         headers: {
//           "Content-Type": "application/json",
//         },
//       });
//     },
//   };

// import { createServerClient, parseCookieHeader } from "@supabase/ssr";const supabase = createServerClient(  import.meta.env.PUBLIC_SUPABASE_URL,  import.meta.env.PUBLIC_SUPABASE_ANON_KEY,  {    cookies: {      getAll() {        return parseCookieHeader(Astro.request.headers.get('Cookie') ?? '')      },      setAll(cookiesToSet) {        cookiesToSet.forEach(({ name, value, options }) =>          Astro.cookies.set(name, value, options))      },    },  });
