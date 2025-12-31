-- =============================================================================
-- Secure Data Distribution System - Database Schema
-- Device Trust Authentication for API Access Control
-- =============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- Table: api_keys
-- Description: Stores API keys for user authentication
-- =============================================================================
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast API key lookup
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- Table: trusted_devices
-- Description: List of trusted client devices per user
-- =============================================================================
CREATE TABLE IF NOT EXISTS trusted_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    device_name TEXT,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Each client_id should be unique per user
    CONSTRAINT unique_user_device UNIQUE (user_id, client_id)
);

-- Index for fast device lookup
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_client 
    ON trusted_devices(user_id, client_id);

-- =============================================================================
-- Table: verification_codes
-- Description: Temporary OTP codes for device verification
-- =============================================================================
CREATE TABLE IF NOT EXISTS verification_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Prevent duplicate active codes for same device
    CONSTRAINT unique_active_code UNIQUE (user_id, client_id, code)
);

-- Index for fast code verification lookup
CREATE INDEX IF NOT EXISTS idx_verification_codes_lookup 
    ON verification_codes(user_id, client_id, code, expires_at);

-- =============================================================================
-- Row Level Security (RLS) Policies
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own API keys
CREATE POLICY "Users can view own api_keys" ON api_keys
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own api_keys" ON api_keys
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own api_keys" ON api_keys
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own api_keys" ON api_keys
    FOR DELETE USING (auth.uid() = user_id);

-- Policy: Users can only see their own trusted devices
CREATE POLICY "Users can view own trusted_devices" ON trusted_devices
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trusted_devices" ON trusted_devices
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own trusted_devices" ON trusted_devices
    FOR DELETE USING (auth.uid() = user_id);

-- Policy: Users can only see their own verification codes
CREATE POLICY "Users can view own verification_codes" ON verification_codes
    FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- Service Role Policies (for Cloudflare Worker access)
-- These allow the service role to manage all records
-- =============================================================================

-- Note: The service role bypasses RLS by default in Supabase.
-- The Cloudflare Worker uses the service role key to perform operations.

-- =============================================================================
-- Cleanup Function: Remove expired verification codes
-- Run this periodically via pg_cron or a scheduled job
-- =============================================================================
CREATE OR REPLACE FUNCTION cleanup_expired_verification_codes()
RETURNS void AS $$
BEGIN
    DELETE FROM verification_codes 
    WHERE expires_at < NOW() OR is_used = true;
END;
$$ LANGUAGE plpgsql;

-- Optional: Create a scheduled job to run cleanup (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-verification-codes', '0 * * * *', 'SELECT cleanup_expired_verification_codes()');
