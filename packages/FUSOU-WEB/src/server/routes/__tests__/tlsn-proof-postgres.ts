/// <reference types="node" />
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export class ProofPostgres {
  private readonly directory = mkdtempSync(join(tmpdir(), "fusou-proof-db-"));
  private readonly binaries = process.env["FUSOU_TEST_PG_BIN"] ?? "/usr/lib/postgresql/16/bin";
  private readonly client = process.env["FUSOU_TEST_PSQL"] ?? "/usr/bin/psql";
  private readonly data = join(this.directory, "data");
  private readonly environment = { PATH: process.env["PATH"], HOME: this.directory, LANG: "C" };
  private process: ChildProcess | undefined;

  async start(): Promise<void> {
    execFileSync(join(this.binaries, "initdb"), [
      "-D", this.data, "--no-locale", "--encoding=UTF8", "--auth=trust", "--username=fusou_test",
      ...(process.env["FUSOU_TEST_PG_SHARE"] ? ["-L", process.env["FUSOU_TEST_PG_SHARE"]] : []),
    ], { env: this.environment, stdio: "pipe" });
    await this.launch();
    this.bootstrap();
  }

  async restart(): Promise<void> {
    execFileSync(join(this.binaries, "pg_ctl"), [
      "-D", this.data, "-m", "fast", "-w", "stop",
    ], { env: this.environment, stdio: "pipe" });
    await this.launch();
  }

  private async launch(): Promise<void> {
    this.process = spawn(join(this.binaries, "postgres"), [
      "-D", this.data, "-k", this.directory, "-c", "listen_addresses=",
    ], { env: this.environment, stdio: "ignore" });
    for (let attempt = 0; attempt < 100; attempt++) {
      let ready = false;
      try {
        this.sql("SELECT 1");
        ready = true;
      } catch (error) {
        if (this.process.exitCode !== null || attempt === 99) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (ready) {
        return;
      }
    }
  }

  sql(query: string): string {
    return execFileSync(this.client, [
      "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
      "-h", this.directory, "-U", "fusou_test", "-d", "postgres", "-c", query,
    ], { env: this.environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }

  async concurrent(query: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.client, [
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
        "-h", this.directory, "-U", "fusou_test", "-d", "postgres", "-c", query,
      ], { env: this.environment, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      let errors = "";
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
      child.on("error", reject);
      child.on("exit", (code: number | null) => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
    });
  }

  stop(): void {
    if (this.process && this.process.exitCode === null) {
      execFileSync(join(this.binaries, "pg_ctl"), [
        "-D", this.data, "-m", "fast", "-w", "stop",
      ], { env: this.environment, stdio: "pipe" });
    }
    rmSync(this.directory, { recursive: true, force: true });
  }

  private bootstrap(): void {
    const migrations = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
    const cutover = readFileSync(join(migrations, "20260822120000_destructive_uuid_public_id_cutover.sql"), "utf8");
    const start = cutover.indexOf("CREATE TABLE public.user_devices (");
    const end = cutover.indexOf("CREATE TABLE public.pending_member_syncs (", start);
    if (start < 0 || end < 0) throw new Error("actual user_devices migration boundaries missing");
    this.sql(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, is_anonymous boolean NOT NULL);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
      CREATE TABLE public.member_id_mapping(public_id uuid PRIMARY KEY);
      ${cutover.slice(start, end)}
    `);
    for (const migration of [
      "20260522000000_anon_sync_nonce_consumptions.sql",
      "20260824180000_anon_sync_nonce_refresh_results.sql",
      "20260822150000_anon_sync_atomic_rate_limits.sql",
      "20261030000000_tlsn_device_proofs.sql",
    ]) this.sql(readFileSync(join(migrations, migration), "utf8"));
  }
}
