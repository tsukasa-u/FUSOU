


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


CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- auth.users にユーザーが作成されたとき public.users に対応行を作成
  INSERT INTO public.users (id, provider, provider_refresh_token)
  VALUES (NEW.id::uuid, NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."processing_metrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dataset_id" "uuid" NOT NULL,
    "workflow_instance_id" character varying NOT NULL,
    "consumer_select_duration_ms" integer,
    "consumer_update_duration_ms" integer,
    "consumer_workflow_trigger_duration_ms" integer,
    "consumer_total_duration_ms" integer,
    "step1_validate_duration_ms" integer,
    "step2_metadata_duration_ms" integer,
    "step3_compact_duration_ms" integer,
    "step3_parquet_analysis_duration_ms" integer,
    "step3_r2_upload_duration_ms" integer,
    "step4_update_metadata_duration_ms" integer,
    "workflow_total_duration_ms" integer,
    "original_size_bytes" integer,
    "compressed_size_bytes" integer,
    "compression_ratio" numeric(5,2),
    "status" character varying DEFAULT 'pending'::character varying,
    "error_message" "text",
    "error_step" character varying,
    "queued_at" timestamp with time zone,
    "consumer_started_at" timestamp with time zone,
    "consumer_completed_at" timestamp with time zone,
    "workflow_started_at" timestamp with time zone,
    "workflow_completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."processing_metrics" OWNER TO "postgres";


CREATE OR REPLACE VIEW "analytics"."metrics_error_analysis" AS
 SELECT "error_step",
    "count"(*) AS "error_count",
    "string_agg"(DISTINCT "error_message", '; '::"text") AS "error_messages",
    "max"("created_at") AS "latest_error_at"
   FROM "public"."processing_metrics"
  WHERE (("status")::"text" = 'failure'::"text")
  GROUP BY "error_step"
  ORDER BY ("count"(*)) DESC;


ALTER VIEW "analytics"."metrics_error_analysis" OWNER TO "postgres";


CREATE OR REPLACE VIEW "analytics"."metrics_hourly_summary" AS
 SELECT "date_trunc"('hour'::"text", "created_at") AS "hour",
    "count"(*) AS "total_count",
    "count"(
        CASE
            WHEN (("status")::"text" = 'success'::"text") THEN 1
            ELSE NULL::integer
        END) AS "success_count",
    "count"(
        CASE
            WHEN (("status")::"text" = 'failure'::"text") THEN 1
            ELSE NULL::integer
        END) AS "failure_count",
    "round"("avg"("consumer_total_duration_ms"), 2) AS "avg_consumer_duration_ms",
    "round"("avg"("workflow_total_duration_ms"), 2) AS "avg_workflow_duration_ms",
    "round"("avg"("compression_ratio"), 2) AS "avg_compression_ratio",
    ("round"("avg"("original_size_bytes"), 0))::integer AS "avg_original_size_bytes",
    "min"("created_at") AS "period_start",
    "max"("created_at") AS "period_end"
   FROM "public"."processing_metrics"
  GROUP BY ("date_trunc"('hour'::"text", "created_at"))
  ORDER BY ("date_trunc"('hour'::"text", "created_at")) DESC;


ALTER VIEW "analytics"."metrics_hourly_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."datasets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" character varying NOT NULL,
    "compaction_needed" boolean DEFAULT false,
    "compaction_in_progress" boolean DEFAULT false,
    "last_compacted_at" timestamp with time zone,
    "file_size_bytes" integer,
    "file_etag" character varying,
    "compression_ratio" numeric(5,2),
    "row_count" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."datasets" OWNER TO "postgres";


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



CREATE TABLE IF NOT EXISTS "public"."provider_tokens" (
    "user_id" "uuid" NOT NULL,
    "provider_name" "text" NOT NULL,
    "access_token" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."provider_tokens" OWNER TO "postgres";


ALTER TABLE ONLY "public"."datasets"
    ADD CONSTRAINT "datasets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fleets"
    ADD CONSTRAINT "fleets_pkey" PRIMARY KEY ("owner_id", "tag");



ALTER TABLE ONLY "public"."kc_period_tag"
    ADD CONSTRAINT "kc_table_tag_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."processing_metrics"
    ADD CONSTRAINT "processing_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_tokens"
    ADD CONSTRAINT "provider_tokens_pkey" PRIMARY KEY ("user_id", "provider_name");



CREATE INDEX "idx_datasets_compaction_needed" ON "public"."datasets" USING "btree" ("compaction_needed", "compaction_in_progress");



CREATE INDEX "idx_datasets_updated_at" ON "public"."datasets" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_datasets_user" ON "public"."datasets" USING "btree" ("user_id");



CREATE INDEX "idx_metrics_created" ON "public"."processing_metrics" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_metrics_dataset" ON "public"."processing_metrics" USING "btree" ("dataset_id");



CREATE INDEX "idx_metrics_status" ON "public"."processing_metrics" USING "btree" ("status");



CREATE INDEX "idx_metrics_workflow_instance" ON "public"."processing_metrics" USING "btree" ("workflow_instance_id");



ALTER TABLE ONLY "public"."fleets"
    ADD CONSTRAINT "fk_owner" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_tokens"
    ADD CONSTRAINT "fk_user" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."datasets"
    ADD CONSTRAINT "fk_user" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."processing_metrics"
    ADD CONSTRAINT "processing_metrics_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE CASCADE;



CREATE POLICY "Enable insert for users based on user_id" ON "public"."provider_tokens" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable users to update their own data only" ON "public"."fleets" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Enable users to update their own data only" ON "public"."provider_tokens" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable users to view their own data only" ON "public"."fleets" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Enable users to view their own data only" ON "public"."provider_tokens" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Service role can access all metrics" ON "public"."processing_metrics" USING (true);



CREATE POLICY "Service role can insert datasets" ON "public"."datasets" FOR INSERT WITH CHECK (true);



CREATE POLICY "Users can read metrics for their datasets" ON "public"."processing_metrics" FOR SELECT USING (("dataset_id" IN ( SELECT "datasets"."id"
   FROM "public"."datasets"
  WHERE ("datasets"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can see their own datasets" ON "public"."datasets" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own datasets" ON "public"."datasets" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."datasets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fleets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kc_period_tag" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kc_period_tag select policy" ON "public"."kc_period_tag" FOR SELECT TO "anon", "authenticated" USING (true);



ALTER TABLE "public"."processing_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."provider_tokens" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";































































































































































GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";












GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."processing_metrics" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."processing_metrics" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."processing_metrics" TO "service_role";















GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."datasets" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."datasets" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."datasets" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."fleets" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."fleets" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."fleets" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."kc_period_tag" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."kc_period_tag" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."kc_period_tag" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kc_table_tag_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kc_table_tag_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kc_table_tag_id_seq" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."provider_tokens" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."provider_tokens" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."provider_tokens" TO "service_role";









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































drop extension if exists "pg_net";

drop policy "kc_period_tag select policy" on "public"."kc_period_tag";


  create policy "kc_period_tag select policy"
  on "public"."kc_period_tag"
  as permissive
  for select
  to authenticated, anon
using (true);


CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


