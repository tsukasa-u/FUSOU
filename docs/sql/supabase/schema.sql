


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "analytics";


ALTER SCHEMA "analytics" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."cleanup_expired_verification_codes"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    DELETE FROM verification_codes 
    WHERE expires_at < NOW() OR is_used = true;
END;
$$;


ALTER FUNCTION "public"."cleanup_expired_verification_codes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_synced_pending_member_syncs"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.synced_at IS NOT NULL AND NEW.member_id_hash IS NOT NULL THEN
    -- Delete immediately after sync completion
    DELETE FROM public.pending_member_syncs 
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."delete_synced_pending_member_syncs"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_synced_pending_member_syncs"() IS 'Automatically deletes a pending_member_syncs record immediately after successful synchronization (synced_at + member_id_hash both set). Prevents accumulation of temporary sync data.';



CREATE OR REPLACE FUNCTION "public"."rpc_claim_member_with_code"("member_id_hash" "text", "transfer_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_new_user_id uuid := auth.uid();
  v_code_hash text;
  v_transfer_record record;
  v_old_owner uuid;
begin
  if v_new_user_id is null then
    raise exception 'not authenticated';
  end if;

  if member_id_hash is null or trim(member_id_hash) = '' then
    raise exception 'member_id_hash cannot be empty';
  end if;

  if transfer_code is null or trim(transfer_code) = '' then
    raise exception 'transfer_code cannot be empty';
  end if;

  v_code_hash := encode(digest(upper(trim(transfer_code)), 'sha256'), 'hex');

  -- Find valid pending transfer
  select * into v_transfer_record
  from public.member_transfer_history
  where member_transfer_history.member_id_hash = rpc_claim_member_with_code.member_id_hash
    and transfer_code_hash = v_code_hash
    and status = 'pending'
    and code_expires_at > now()
  order by code_issued_at desc
  limit 1;

  if v_transfer_record is null then
    raise exception 'invalid or expired transfer code';
  end if;

  -- Verify current owner
  select user_id into v_old_owner
  from public.user_member_map
  where user_member_map.member_id_hash = rpc_claim_member_with_code.member_id_hash;

  if v_old_owner is null then
    raise exception 'member_id_hash not found in user_member_map';
  end if;

  if v_old_owner <> v_transfer_record.old_user_id then
    raise exception 'ownership mismatch: current owner has changed';
  end if;

  if v_old_owner = v_new_user_id then
    raise exception 'cannot transfer to the same user';
  end if;

  -- Update ownership atomically
  update public.user_member_map
  set user_id = v_new_user_id,
      updated_at = now()
  where user_member_map.member_id_hash = rpc_claim_member_with_code.member_id_hash
    and user_id = v_old_owner;

  -- Mark transfer as claimed
  update public.member_transfer_history
  set status = 'claimed',
      new_user_id = v_new_user_id,
      code_claimed_at = now(),
      updated_at = now()
  where id = v_transfer_record.id;

  return jsonb_build_object(
    'success', true,
    'old_user_id', v_old_owner,
    'new_user_id', v_new_user_id,
    'transferred_at', now()
  );
end;
$$;


ALTER FUNCTION "public"."rpc_claim_member_with_code"("member_id_hash" "text", "transfer_code" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_claim_member_with_code"("member_id_hash" "text", "transfer_code" "text") IS 'Claims ownership of a member_id using a valid transfer code';



CREATE OR REPLACE FUNCTION "public"."rpc_create_processing_metrics"("dataset_id" "text", "user_id" "text", "workflow_instance_id" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_metric_id uuid;
  v_user_id_uuid uuid;
begin
  -- Convert user_id text to UUID
  v_user_id_uuid := user_id::uuid;

  if auth.uid() <> v_user_id_uuid then
    raise exception 'Unauthorized: user_id does not match authenticated user';
  end if;

  if dataset_id is null or trim(dataset_id) = '' then
    raise exception 'dataset_id cannot be empty';
  end if;

  if workflow_instance_id is null or trim(workflow_instance_id) = '' then
    raise exception 'workflow_instance_id cannot be empty';
  end if;

  insert into public.processing_metrics (
    dataset_id, workflow_instance_id, status, created_at, updated_at
  )
  values (
    rpc_create_processing_metrics.dataset_id,
    rpc_create_processing_metrics.workflow_instance_id,
    'pending',
    now(),
    now()
  )
  returning id into v_metric_id;

  return v_metric_id;
end;
$$;


ALTER FUNCTION "public"."rpc_create_processing_metrics"("dataset_id" "text", "user_id" "text", "workflow_instance_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_finalize_compaction"("dataset_id" "text", "user_id" "text", "total_original_size" bigint, "total_compacted_size" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_updated int;
  v_user_id_uuid uuid;
begin
  -- Convert user_id text to UUID
  v_user_id_uuid := user_id::uuid;

  if auth.uid() <> v_user_id_uuid then
    raise exception 'Unauthorized: user_id does not match authenticated user';
  end if;

  if dataset_id is null or trim(dataset_id) = '' then
    raise exception 'dataset_id cannot be empty';
  end if;

  update public.datasets
  set compaction_in_progress = false,
      compaction_needed = false,
      updated_at = now()
  where datasets.id = rpc_finalize_compaction.dataset_id
    and datasets.user_id = v_user_id_uuid;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;


ALTER FUNCTION "public"."rpc_finalize_compaction"("dataset_id" "text", "user_id" "text", "total_original_size" bigint, "total_compacted_size" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_generate_member_transfer_code"("member_id_hash" "text", "ttl_minutes" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_existing_owner uuid;
  v_transfer_code text;
  v_code_hash text;
  v_expires_at timestamptz;
  v_recent_attempts int;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if member_id_hash is null or trim(member_id_hash) = '' then
    raise exception 'member_id_hash cannot be empty';
  end if;

  -- Verify caller owns this member_id_hash
  select user_id into v_existing_owner
  from public.user_member_map
  where user_member_map.member_id_hash = rpc_generate_member_transfer_code.member_id_hash;

  if v_existing_owner is null then
    raise exception 'member_id_hash not found';
  end if;

  if v_existing_owner <> v_user_id then
    raise exception 'not authorized: you do not own this member_id';
  end if;

  -- Rate limiting: max 3 code generations per hour per user
  select count(*) into v_recent_attempts
  from public.member_transfer_history
  where old_user_id = v_user_id
    and code_issued_at > now() - interval '1 hour';

  if v_recent_attempts >= 3 then
    raise exception 'rate limit exceeded: max 3 transfer codes per hour';
  end if;

  -- Revoke any pending codes for this member_id_hash
  update public.member_transfer_history
  set status = 'revoked', updated_at = now()
  where member_transfer_history.member_id_hash = rpc_generate_member_transfer_code.member_id_hash
    and status = 'pending';

  -- Generate random 8-character code (alphanumeric, uppercase)
  v_transfer_code := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
  v_code_hash := encode(digest(v_transfer_code, 'sha256'), 'hex');
  v_expires_at := now() + (ttl_minutes || ' minutes')::interval;

  -- Store hashed code
  insert into public.member_transfer_history (
    member_id_hash, old_user_id, transfer_code_hash, code_issued_at, code_expires_at, status
  )
  values (
    rpc_generate_member_transfer_code.member_id_hash,
    v_user_id,
    v_code_hash,
    now(),
    v_expires_at,
    'pending'
  );

  return jsonb_build_object(
    'transfer_code', v_transfer_code,
    'expires_at', v_expires_at,
    'ttl_minutes', ttl_minutes
  );
end;
$$;


ALTER FUNCTION "public"."rpc_generate_member_transfer_code"("member_id_hash" "text", "ttl_minutes" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_generate_member_transfer_code"("member_id_hash" "text", "ttl_minutes" integer) IS 'Generates a time-limited transfer code for account migration (rate limited to 3/hour)';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."user_member_map" (
    "user_id" "uuid" NOT NULL,
    "member_id_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "salt_version" "text" DEFAULT 'v1'::"text",
    "hash_algorithm" "text" DEFAULT 'sha256'::"text",
    "client_version" "text",
    "last_seen_at" timestamp with time zone
);


ALTER TABLE "public"."user_member_map" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_member_map" IS 'Maps Supabase users to game member IDs (hashed) for cross-device data consolidation';



COMMENT ON COLUMN "public"."user_member_map"."user_id" IS 'Supabase auth user ID';



COMMENT ON COLUMN "public"."user_member_map"."member_id_hash" IS 'Salted SHA-256 hash of game member ID';



COMMENT ON COLUMN "public"."user_member_map"."salt_version" IS 'Version of salt used for hashing (for future migrations)';



COMMENT ON COLUMN "public"."user_member_map"."hash_algorithm" IS 'Hash algorithm used (sha256)';



COMMENT ON COLUMN "public"."user_member_map"."client_version" IS 'Client application version that created/updated this mapping';



COMMENT ON COLUMN "public"."user_member_map"."last_seen_at" IS 'Last time this member_id was actively used (for analytics)';



CREATE OR REPLACE FUNCTION "public"."rpc_get_current_user_member_map"() RETURNS "public"."user_member_map"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select * from public.user_member_map where user_id = auth.uid();
$$;


ALTER FUNCTION "public"."rpc_get_current_user_member_map"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_get_current_user_member_map"() IS 'Retrieves current authenticated user member_id mapping';



CREATE OR REPLACE FUNCTION "public"."rpc_get_member_conflict_hints"("member_id_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_user_id uuid;
  v_email text;
  v_last_sign_in timestamptz;
  v_created_at timestamptz;
  v_masked_email text;
begin
  -- Get the user_id that owns this member_id_hash
  select user_id into v_user_id
  from public.user_member_map
  where user_member_map.member_id_hash = rpc_get_member_conflict_hints.member_id_hash
  limit 1;

  if v_user_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'member_id_not_found'
    );
  end if;

  -- Get email and timestamps from auth.users
  select email, last_sign_in_at, created_at 
  into v_email, v_last_sign_in, v_created_at
  from auth.users
  where id = v_user_id;

  -- Mask email: show first char and domain only (e.g., a***@example.com)
  if v_email is not null then
    v_masked_email := substring(v_email from 1 for 1) || '***@' || 
                      substring(v_email from position('@' in v_email) + 1);
  else
    v_masked_email := '***';
  end if;

  return jsonb_build_object(
    'success', true,
    'hints', jsonb_build_object(
      'masked_email', v_masked_email,
      'last_sign_in_date', to_char(v_last_sign_in, 'YYYY-MM-DD'),
      'account_created_date', to_char(v_created_at, 'YYYY-MM-DD')
    )
  );
end;
$$;


ALTER FUNCTION "public"."rpc_get_member_conflict_hints"("member_id_hash" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_get_member_conflict_hints"("member_id_hash" "text") IS 'Returns safe account hints (masked email, dates) for conflict resolution page';



CREATE OR REPLACE FUNCTION "public"."rpc_record_compaction_metrics"("dataset_id" "text", "user_id" "text", "metric_update" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_updated int;
  v_user_id_uuid uuid;
begin
  -- Convert user_id text to UUID
  v_user_id_uuid := user_id::uuid;

  if auth.uid() <> v_user_id_uuid then
    raise exception 'Unauthorized: user_id does not match authenticated user';
  end if;

  if dataset_id is null or trim(dataset_id) = '' then
    raise exception 'dataset_id cannot be empty';
  end if;

  update public.processing_metrics
  set 
    original_size_bytes = (metric_update->>'original_size_bytes')::integer,
    compressed_size_bytes = (metric_update->>'compressed_size_bytes')::integer,
    compression_ratio = (metric_update->>'compression_ratio')::decimal(5,2),
    status = coalesce(metric_update->>'status', status),
    error_message = coalesce(metric_update->>'error_message', error_message),
    error_step = coalesce(metric_update->>'error_step', error_step),
    updated_at = now()
  where dataset_id = rpc_record_compaction_metrics.dataset_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;


ALTER FUNCTION "public"."rpc_record_compaction_metrics"("dataset_id" "text", "user_id" "text", "metric_update" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_record_compaction_metrics"("metric_id" "uuid", "metric_status" "text", "step1_duration" integer DEFAULT NULL::integer, "step2_duration" integer DEFAULT NULL::integer, "step3_duration" integer DEFAULT NULL::integer, "step4_duration" integer DEFAULT NULL::integer, "total_duration" integer DEFAULT NULL::integer, "original_size" bigint DEFAULT NULL::bigint, "compressed_size" bigint DEFAULT NULL::bigint, "error_message" "text" DEFAULT NULL::"text", "error_step" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_compression_ratio numeric;
  v_updated int;
begin
  v_compression_ratio := case
    when original_size > 0 then compressed_size::numeric / original_size::numeric
    else null
  end;

  update public.processing_metrics
  set status = rpc_record_compaction_metrics.metric_status,
      step1_validate_duration_ms = rpc_record_compaction_metrics.step1_duration,
      step2_metadata_duration_ms = rpc_record_compaction_metrics.step2_duration,
      step3_compact_duration_ms = rpc_record_compaction_metrics.step3_duration,
      step4_update_metadata_duration_ms = rpc_record_compaction_metrics.step4_duration,
      workflow_total_duration_ms = rpc_record_compaction_metrics.total_duration,
      original_size_bytes = rpc_record_compaction_metrics.original_size,
      compressed_size_bytes = rpc_record_compaction_metrics.compressed_size,
      compression_ratio = v_compression_ratio,
      error_message = rpc_record_compaction_metrics.error_message,
      error_step = rpc_record_compaction_metrics.error_step,
      workflow_completed_at = now(),
      updated_at = now()
  where processing_metrics.id = rpc_record_compaction_metrics.metric_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;


ALTER FUNCTION "public"."rpc_record_compaction_metrics"("metric_id" "uuid", "metric_status" "text", "step1_duration" integer, "step2_duration" integer, "step3_duration" integer, "step4_duration" integer, "total_duration" integer, "original_size" bigint, "compressed_size" bigint, "error_message" "text", "error_step" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_set_compaction_flag"("dataset_id" "text", "user_id" "text", "in_progress" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_updated int;
  v_user_id_uuid uuid;
begin
  -- Convert user_id text to UUID
  v_user_id_uuid := user_id::uuid;

  if auth.uid() <> v_user_id_uuid then
    raise exception 'Unauthorized: user_id does not match authenticated user';
  end if;

  if dataset_id is null or trim(dataset_id) = '' then
    raise exception 'dataset_id cannot be empty';
  end if;

  update public.datasets
  set compaction_in_progress = rpc_set_compaction_flag.in_progress,
      updated_at = now()
  where datasets.id = rpc_set_compaction_flag.dataset_id
    and datasets.user_id = v_user_id_uuid
    and (rpc_set_compaction_flag.in_progress = true or datasets.compaction_in_progress = true);

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;


ALTER FUNCTION "public"."rpc_set_compaction_flag"("dataset_id" "text", "user_id" "text", "in_progress" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_upsert_user_member_map"("member_id_hash" "text", "client_version" "text" DEFAULT NULL::"text") RETURNS "public"."user_member_map"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.user_member_map;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF member_id_hash IS NULL OR trim(member_id_hash) = '' THEN
    RAISE EXCEPTION 'member_id_hash cannot be empty';
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.user_member_map umm
    WHERE umm.member_id_hash = rpc_upsert_user_member_map.member_id_hash
      AND umm.user_id <> v_user_id
  ) THEN
    RAISE EXCEPTION 'member_id_hash already mapped to another user';
  END IF;

  INSERT INTO public.user_member_map (
    user_id,
    member_id_hash,
    client_version,
    last_seen_at
  )
  VALUES (
    v_user_id,
    rpc_upsert_user_member_map.member_id_hash,
    rpc_upsert_user_member_map.client_version,
    now()
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    member_id_hash = EXCLUDED.member_id_hash,
    client_version = COALESCE(EXCLUDED.client_version, user_member_map.client_version),
    last_seen_at = now(),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;


ALTER FUNCTION "public"."rpc_upsert_user_member_map"("member_id_hash" "text", "client_version" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "email" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fleets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "tag" "text" NOT NULL,
    "title" "text",
    "r2_key" "text",
    "version" bigint NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_public" boolean DEFAULT false NOT NULL,
    "share_token" "text",
    "retention_policy" "text"
);


ALTER TABLE "public"."fleets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kc_period_tag" (
    "id" bigint NOT NULL,
    "tag" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."kc_period_tag" OWNER TO "postgres";


ALTER TABLE "public"."kc_period_tag" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."kc_table_tag_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."member_transfer_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id_hash" "text" NOT NULL,
    "old_user_id" "uuid",
    "new_user_id" "uuid",
    "transfer_code_hash" "text" NOT NULL,
    "code_issued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "code_expires_at" timestamp with time zone NOT NULL,
    "code_claimed_at" timestamp with time zone,
    "claimed_from_ip" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "member_transfer_history_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'claimed'::"text", 'expired'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."member_transfer_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."member_transfer_history" IS 'Audit trail for all member ownership transfer attempts';



COMMENT ON COLUMN "public"."member_transfer_history"."transfer_code_hash" IS 'SHA-256 hash of the 8-character transfer code';



COMMENT ON COLUMN "public"."member_transfer_history"."code_expires_at" IS 'Transfer code expiration timestamp (default 10 minutes)';



COMMENT ON COLUMN "public"."member_transfer_history"."status" IS 'Transfer status: pending, claimed, expired, or revoked';



CREATE TABLE IF NOT EXISTS "public"."pending_member_syncs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" NOT NULL,
    "member_id_hash" "text",
    "app_instance_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:05:00'::interval),
    "synced_at" timestamp with time zone,
    CONSTRAINT "token_not_empty" CHECK (("token" <> ''::"text"))
);


ALTER TABLE "public"."pending_member_syncs" OWNER TO "postgres";


COMMENT ON TABLE "public"."pending_member_syncs" IS 'Table for member_id_hash synchronization between WEB and Tauri APP. Connected via Realtime for real-time updates. Auto-deletes after successful sync.';



COMMENT ON COLUMN "public"."pending_member_syncs"."token" IS 'Passphrase token (UUID). Generated by WEB, received by APP.';



COMMENT ON COLUMN "public"."pending_member_syncs"."member_id_hash" IS 'Game member ID hash. Loaded and set by APP.';



COMMENT ON COLUMN "public"."pending_member_syncs"."app_instance_id" IS 'Unique identifier for APP instance. Used to handle conflicts when multiple APPs are running.';



COMMENT ON COLUMN "public"."pending_member_syncs"."expires_at" IS 'Token expiration time (default 5 minutes). Expired records are subject to periodic deletion.';



COMMENT ON COLUMN "public"."pending_member_syncs"."synced_at" IS 'Timestamp when APP completed synchronization. NULL means not yet synced. Setting this triggers auto-deletion.';



CREATE TABLE IF NOT EXISTS "public"."provider_tokens" (
    "user_id" "uuid" NOT NULL,
    "provider_name" "text" NOT NULL,
    "access_token" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."provider_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trusted_devices" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "text" NOT NULL,
    "device_name" "text",
    "last_used_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trusted_devices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."verification_codes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "text" NOT NULL,
    "code" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "is_used" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."verification_codes" OWNER TO "postgres";


ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fleets"
    ADD CONSTRAINT "fleets_pkey" PRIMARY KEY ("owner_id", "tag");



ALTER TABLE ONLY "public"."kc_period_tag"
    ADD CONSTRAINT "kc_table_tag_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_transfer_history"
    ADD CONSTRAINT "member_transfer_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_member_syncs"
    ADD CONSTRAINT "pending_member_syncs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_member_syncs"
    ADD CONSTRAINT "pending_member_syncs_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."provider_tokens"
    ADD CONSTRAINT "provider_tokens_pkey" PRIMARY KEY ("user_id", "provider_name");



ALTER TABLE ONLY "public"."trusted_devices"
    ADD CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verification_codes"
    ADD CONSTRAINT "unique_active_code" UNIQUE ("user_id", "client_id", "code");



ALTER TABLE ONLY "public"."trusted_devices"
    ADD CONSTRAINT "unique_user_device" UNIQUE ("user_id", "client_id");



ALTER TABLE ONLY "public"."user_member_map"
    ADD CONSTRAINT "user_member_map_member_id_hash_key" UNIQUE ("member_id_hash");



ALTER TABLE ONLY "public"."user_member_map"
    ADD CONSTRAINT "user_member_map_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."verification_codes"
    ADD CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_api_keys_key" ON "public"."api_keys" USING "btree" ("key");



CREATE INDEX "idx_api_keys_user_id" ON "public"."api_keys" USING "btree" ("user_id");



CREATE INDEX "idx_member_transfer_history_member_id_hash" ON "public"."member_transfer_history" USING "btree" ("member_id_hash");



CREATE INDEX "idx_member_transfer_history_status" ON "public"."member_transfer_history" USING "btree" ("status", "code_expires_at");



CREATE INDEX "idx_pending_syncs_app_instance" ON "public"."pending_member_syncs" USING "btree" ("app_instance_id");



CREATE INDEX "idx_pending_syncs_expires" ON "public"."pending_member_syncs" USING "btree" ("expires_at");



CREATE INDEX "idx_pending_syncs_token" ON "public"."pending_member_syncs" USING "btree" ("token");



CREATE INDEX "idx_trusted_devices_user_client" ON "public"."trusted_devices" USING "btree" ("user_id", "client_id");



CREATE INDEX "idx_user_member_map_last_seen" ON "public"."user_member_map" USING "btree" ("last_seen_at" DESC NULLS LAST);



CREATE INDEX "idx_user_member_map_member_id_hash" ON "public"."user_member_map" USING "btree" ("member_id_hash");



CREATE INDEX "idx_verification_codes_lookup" ON "public"."verification_codes" USING "btree" ("user_id", "client_id", "code", "expires_at");



CREATE OR REPLACE TRIGGER "trg_auto_delete_synced_pending_syncs" AFTER UPDATE ON "public"."pending_member_syncs" FOR EACH ROW EXECUTE FUNCTION "public"."delete_synced_pending_member_syncs"();



CREATE OR REPLACE TRIGGER "trg_user_member_map_updated_at" BEFORE UPDATE ON "public"."user_member_map" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_api_keys_updated_at" BEFORE UPDATE ON "public"."api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fleets"
    ADD CONSTRAINT "fk_owner" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_tokens"
    ADD CONSTRAINT "fk_user" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_transfer_history"
    ADD CONSTRAINT "member_transfer_history_new_user_id_fkey" FOREIGN KEY ("new_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."member_transfer_history"
    ADD CONSTRAINT "member_transfer_history_old_user_id_fkey" FOREIGN KEY ("old_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trusted_devices"
    ADD CONSTRAINT "trusted_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_member_map"
    ADD CONSTRAINT "user_member_map_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verification_codes"
    ADD CONSTRAINT "verification_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Allow anonymous users to insert" ON "public"."pending_member_syncs" FOR INSERT WITH CHECK ((("token" IS NOT NULL) AND ("token" <> ''::"text")));



CREATE POLICY "Allow anonymous users to update own record" ON "public"."pending_member_syncs" FOR UPDATE USING (true) WITH CHECK ((("synced_at" IS NOT NULL) OR ("member_id_hash" IS NOT NULL)));



CREATE POLICY "Allow public read access for realtime" ON "public"."pending_member_syncs" FOR SELECT USING (true);



CREATE POLICY "Enable insert for users based on user_id" ON "public"."provider_tokens" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable users to update their own data only" ON "public"."fleets" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Enable users to update their own data only" ON "public"."provider_tokens" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable users to view their own data only" ON "public"."fleets" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Enable users to view their own data only" ON "public"."provider_tokens" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can delete own api_keys" ON "public"."api_keys" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own trusted_devices" ON "public"."trusted_devices" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own api_keys" ON "public"."api_keys" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own trusted_devices" ON "public"."trusted_devices" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own api_keys" ON "public"."api_keys" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own api_keys" ON "public"."api_keys" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own trusted_devices" ON "public"."trusted_devices" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own verification_codes" ON "public"."verification_codes" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fleets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kc_period_tag" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kc_period_tag select policy" ON "public"."kc_period_tag" FOR SELECT TO "anon", "authenticated" USING (true);



ALTER TABLE "public"."member_transfer_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "member_transfer_history_select" ON "public"."member_transfer_history" FOR SELECT USING ((("auth"."uid"() = "old_user_id") OR ("auth"."uid"() = "new_user_id")));



ALTER TABLE "public"."pending_member_syncs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."provider_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trusted_devices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_member_map" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_member_map_delete" ON "public"."user_member_map" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "user_member_map_insert" ON "public"."user_member_map" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "user_member_map_select" ON "public"."user_member_map" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "user_member_map_update" ON "public"."user_member_map" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."verification_codes" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."pending_member_syncs";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




















































































































































































GRANT ALL ON FUNCTION "public"."cleanup_expired_verification_codes"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_verification_codes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_verification_codes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_synced_pending_member_syncs"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_synced_pending_member_syncs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_synced_pending_member_syncs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_claim_member_with_code"("member_id_hash" "text", "transfer_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_claim_member_with_code"("member_id_hash" "text", "transfer_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_claim_member_with_code"("member_id_hash" "text", "transfer_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_create_processing_metrics"("dataset_id" "text", "user_id" "text", "workflow_instance_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_processing_metrics"("dataset_id" "text", "user_id" "text", "workflow_instance_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_processing_metrics"("dataset_id" "text", "user_id" "text", "workflow_instance_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_finalize_compaction"("dataset_id" "text", "user_id" "text", "total_original_size" bigint, "total_compacted_size" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_finalize_compaction"("dataset_id" "text", "user_id" "text", "total_original_size" bigint, "total_compacted_size" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_finalize_compaction"("dataset_id" "text", "user_id" "text", "total_original_size" bigint, "total_compacted_size" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_generate_member_transfer_code"("member_id_hash" "text", "ttl_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_generate_member_transfer_code"("member_id_hash" "text", "ttl_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_generate_member_transfer_code"("member_id_hash" "text", "ttl_minutes" integer) TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."user_member_map" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."user_member_map" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."user_member_map" TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_current_user_member_map"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_current_user_member_map"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_current_user_member_map"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_member_conflict_hints"("member_id_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_member_conflict_hints"("member_id_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_member_conflict_hints"("member_id_hash" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_record_compaction_metrics"("dataset_id" "text", "user_id" "text", "metric_update" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_record_compaction_metrics"("dataset_id" "text", "user_id" "text", "metric_update" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_record_compaction_metrics"("dataset_id" "text", "user_id" "text", "metric_update" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_record_compaction_metrics"("metric_id" "uuid", "metric_status" "text", "step1_duration" integer, "step2_duration" integer, "step3_duration" integer, "step4_duration" integer, "total_duration" integer, "original_size" bigint, "compressed_size" bigint, "error_message" "text", "error_step" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_record_compaction_metrics"("metric_id" "uuid", "metric_status" "text", "step1_duration" integer, "step2_duration" integer, "step3_duration" integer, "step4_duration" integer, "total_duration" integer, "original_size" bigint, "compressed_size" bigint, "error_message" "text", "error_step" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_record_compaction_metrics"("metric_id" "uuid", "metric_status" "text", "step1_duration" integer, "step2_duration" integer, "step3_duration" integer, "step4_duration" integer, "total_duration" integer, "original_size" bigint, "compressed_size" bigint, "error_message" "text", "error_step" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_set_compaction_flag"("dataset_id" "text", "user_id" "text", "in_progress" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_set_compaction_flag"("dataset_id" "text", "user_id" "text", "in_progress" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_set_compaction_flag"("dataset_id" "text", "user_id" "text", "in_progress" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_upsert_user_member_map"("member_id_hash" "text", "client_version" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_upsert_user_member_map"("member_id_hash" "text", "client_version" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_upsert_user_member_map"("member_id_hash" "text", "client_version" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";






























GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."api_keys" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."api_keys" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."api_keys" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."fleets" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."fleets" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."fleets" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."kc_period_tag" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."kc_period_tag" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."kc_period_tag" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kc_table_tag_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kc_table_tag_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kc_table_tag_id_seq" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."member_transfer_history" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."member_transfer_history" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."member_transfer_history" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."pending_member_syncs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."pending_member_syncs" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."pending_member_syncs" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."provider_tokens" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."provider_tokens" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."provider_tokens" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."trusted_devices" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."trusted_devices" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."trusted_devices" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."verification_codes" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."verification_codes" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."verification_codes" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO "service_role";































