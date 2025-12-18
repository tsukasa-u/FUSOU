# dotenvx Setup for Cloudflare Workers

This document describes how dotenvx is configured to manage encrypted environment variables for this Cloudflare Worker.

## How It Works

1. **Local Development**:
   - `.env` file contains `dotenvx`-encrypted values for `PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`
   - `.env.keys` contains the decryption keys (NEVER commit this file)
   - `import '@dotenvx/dotenvx/config'` at the top of `src/index.ts` automatically decrypts and populates `process.env`
   - Code accesses variables via `process.env.PUBLIC_SUPABASE_URL` and `process.env.SUPABASE_SECRET_KEY`

2. **Production Deployment**:
   - `npm run deploy` runs `dotenvx run -- wrangler deploy`
   - `dotenvx run` decrypts the `.env` file and injects variables into the command environment
   - `wrangler deploy` uses those decrypted variables during build
   - At runtime, `import '@dotenvx/dotenvx/config'` loads them from the encrypted `.env` file again

## Cloudflare Secret Setup

To enable decryption at runtime, the private key must be set as a Cloudflare Worker secret:

```bash
wrangler secret put DOTENV_PRIVATE_KEY
```

When prompted, paste the value from `.env.keys` (the part after `DOTENV_PRIVATE_KEY=`):

```
# Example .env.keys format (NEVER commit this file):
DOTENV_PUBLIC_KEY=0399e3524946224b5338310d9ab5649be34979c3fbbddb468121fe3164fb166106
DOTENV_PRIVATE_KEY=...your_private_key_here...
```

## Updating Environment Variables

To update a secret:

```bash
# Edit the variable in .env
nano .env

# Re-encrypt the file
npx dotenvx encrypt

# Set the new private key as a Cloudflare secret
wrangler secret put DOTENV_PRIVATE_KEY
```

Then redeploy:

```bash
npm run deploy
```

## Important Files

- `.env` - Encrypted environment variables (safe to commit)
- `.env.keys` - Decryption keys (MUST be added to `.gitignore`, never commit)
- `tsconfig.json` - Contains types configuration for Cloudflare Workers

## References

- [dotenvx Cloudflare Documentation](https://dotenvx.com/docs/platforms/cloudflare)
- [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

## Verification

To verify the setup is working:

1. In local dev: `npm run dev` should load variables from `.env`
2. After deployment: Check `wrangler tail` logs to verify no "Environment variable is not defined" errors
3. Workflow should successfully instantiate Supabase client with `createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)`
