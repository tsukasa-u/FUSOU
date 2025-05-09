interface ImportMetaEnv {
    readonly PUBLIC_SUPABASE_URL: string
    readonly PUBLIC_SUPABASE_ANON_KEY: string
    readonly PUBLIC_SITE_URL: string
    readonly GOOGLE_CLIENT_ID: string
    readonly GOOGLE_CLIENT_SECRET: string
    
    readonly BETTER_AUTH_SECRET: string
    readonly BETTER_AUTH_URL: string
    
    readonly SUPABASE_DATABASE_URL: string
  }
  
interface ImportMeta {
    readonly env: ImportMetaEnv
}

/// <reference path="../.astro/types.d.ts" />
 
declare namespace App {
  // Note: 'import {} from ""' syntax does not work in .d.ts files.
  interface Locals {
      user: import("better-auth").User | null;
      session: import("better-auth").Session | null;
  }
}