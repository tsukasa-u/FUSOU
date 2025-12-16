# dotenvx Configuration for FUSOU

## Overview
FUSOU uses [dotenvx](https://dotenvx.com/) for secure environment variable management with encryption support.

## Required Environment Variables

### FUSOU-WORKFLOW
- `PUBLIC_SUPABASE_URL`: Your Supabase project URL (e.g., https://xxxxx.supabase.co)
- `SUPABASE_SECRET_KEY`: Supabase service role key (secret)

### FUSOU-WEB
- `PUBLIC_SUPABASE_URL`: Your Supabase project URL (e.g., https://xxxxx.supabase.co)
- `SUPABASE_SECRET_KEY`: Supabase service role key (secret)

**Note:** Other variables in FUSOU-WEB/.env (Google OAuth, Signing Secrets, etc.) are optional and project-specific.

## Setup

### FUSOU-WORKFLOW (Cloudflare Workers)

1. **Create `.env` file:**
```bash
cd packages/FUSOU-WORKFLOW
cp .env.example .env
# Edit .env with your actual values
```

2. **Encrypt the `.env` file:**
```bash
npx dotenvx encrypt
```
This creates `.env.keys` with encryption keys.

3. **Set the private key as Worker secret:**
```bash
wrangler secret put DOTENV_PRIVATE_KEY
# Paste the private key from .env.keys when prompted
```

4. **Deploy:**
```bash
wrangler deploy
```

### FUSOU-WEB (Cloudflare Pages)

1. **Create `.env.production` for production:**
```bash
cd packages/FUSOU-WEB
# Create .env.production with production values
```

2. **Encrypt production environment:**
```bash
npx dotenvx encrypt -f .env.production
```

3. **Set `DOTENV_PRIVATE_KEY` in Cloudflare Dashboard:**
- Go to Cloudflare Pages → Your Project → Settings → Environment Variables
- Select "Production" environment
- Add variable: `DOTENV_PRIVATE_KEY` = (value from `.env.production.keys`)

4. **Build and deploy:**
```bash
npm run build
npx wrangler pages deploy dist
```

## How It Works

### Cloudflare Workers (FUSOU-WORKFLOW)
- `import '@dotenvx/dotenvx/config'` at the top of `src/index.ts` automatically loads environment variables
- Local: reads from `.env` → `process.env`
- Production: decrypts `.env` using `DOTENV_PRIVATE_KEY` secret

### Cloudflare Pages (FUSOU-WEB)
- Build scripts use `dotenvx run` to load `.env` during development
- Production: Cloudflare Pages injects `DOTENV_PRIVATE_KEY` to decrypt `.env.production`
- Runtime access via `locals.runtime.env` or `env` parameter

## Security Benefits

1. **Encrypted storage**: `.env` files can be safely committed to git (encrypted)
2. **Key separation**: Only `DOTENV_PRIVATE_KEY` needs to be kept secret
3. **Environment isolation**: Different keys for dev/staging/production
4. **Version control**: Track environment variable changes in git

## Required Variables

### FUSOU-WORKFLOW
- `PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SECRET_KEY`: Supabase service role key

### FUSOU-WEB
- `PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SECRET_KEY`: Supabase service role key

## Troubleshooting

### "Cannot find DOTENV_PRIVATE_KEY"
- Ensure you ran `npx dotenvx encrypt`
- Check that `DOTENV_PRIVATE_KEY` is set as Worker/Pages secret
- Verify the key matches the one in `.env.keys`

### "Environment variables not loading"
- Verify `import '@dotenvx/dotenvx/config'` is at the top of entry file
- Check `.env` file exists and is properly formatted
- Ensure dotenvx is installed in package.json dependencies

## References
- [dotenvx Documentation](https://dotenvx.com/docs)
- [dotenvx with Cloudflare Workers](https://dotenvx.com/docs/platforms/cloudflare#cloudflare-workers)
- [dotenvx with Cloudflare Pages](https://dotenvx.com/docs/platforms/cloudflare#cloudflare-pages)
