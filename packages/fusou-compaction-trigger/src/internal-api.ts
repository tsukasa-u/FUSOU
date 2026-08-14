import { z } from "zod";
import type {
  CleanupConsumedSourcesPayload,
  CompactionJobInput,
  RegisterOutputBlock,
  RegisterOutputPayload,
  SourceBlock,
} from "./types.js";
import { CompactionTierSchema } from "./types.js";

type InternalClientConfig = {
  baseUrl: string;
  token: string;
};

const sourceBlockSchema = z.object({
  id: z.number(),
  dataset_id: z.string(),
  table_name: z.string(),
  table_version: z.string(),
  period_tag: z.string(),
  start_byte: z.number(),
  length: z.number(),
  record_count: z.number(),
  start_timestamp: z.number(),
  end_timestamp: z.number(),
  compaction_tier: CompactionTierSchema,
  window_start_ms: z.number().nullable(),
  window_end_ms: z.number().nullable(),
  file_id: z.number(),
  file_path: z.string(),
  file_size: z.number(),
});

const listSourceBlocksResponseSchema = z.object({
  blocks: z.array(sourceBlockSchema).optional(),
  has_more: z.boolean().optional(),
  next_cursor_id: z.number().optional(),
});

const listSourceGroupsResponseSchema = z.object({
  groups: z.array(z.object({
    period_tag: z.string().nullable().optional(),
    table_version: z.string().nullable().optional(),
    source_blocks: z.number().optional(),
  })).optional(),
});

const listSourceTablesResponseSchema = z.object({
  tables: z.array(z.string().nullable()).optional(),
});

const resolveSourceWindowRangeResponseSchema = z.object({
  start_ms: z.number().nullable().optional(),
  end_ms: z.number().nullable().optional(),
});

const verifyOutputVisibleResponseSchema = z.object({
  success: z.boolean().optional(),
  visible: z.boolean().optional(),
});

const acquireOutputLockResponseSchema = z.object({
  success: z.boolean().optional(),
  acquired: z.boolean().optional(),
  lock_expires_ms: z.number().nullable().optional(),
});

const releaseOutputLockResponseSchema = z.object({
  success: z.boolean().optional(),
  released: z.boolean().optional(),
});

const periodRolloverCheckResponseSchema = z.object({
  success: z.boolean(),
  should_compact: z.boolean(),
  reason: z.string(),
  closed_period_tag: z.string().nullable(),
  current_open_period_tag: z.string().nullable(),
});

const resolveTableVersionResponseSchema = z.object({
  success: z.boolean(),
  table_version: z.string(),
});

export class InternalCompactionClient {
  constructor(private readonly config: InternalClientConfig) {}

  private async parseJson<T>(path: string, res: Response, schema: z.ZodType<T>): Promise<T> {
    const parsed = schema.safeParse(await res.json() as unknown);
    if (!parsed.success) {
      throw new Error(`Internal API ${path} returned invalid JSON: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  private async postJson<T>(path: string, payload: unknown, schema: z.ZodType<T>): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-INTERNAL-TOKEN": this.config.token,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Internal API ${path} failed: ${res.status} ${await res.text()}`);
    }

    return this.parseJson(path, res, schema);
  }

  async listSourceBlocks(input: CompactionJobInput): Promise<SourceBlock[]> {
    const blocks: SourceBlock[] = [];
    let cursor = 0;
    const limit = input.chunk_limit ?? 200;

    while (true) {
      const resp = await this.postJson("/internal/compaction/list-source-blocks", {
        tier: input.source_tier,
        table_name: input.table_name,
        period_tag: input.period_tag,
        table_version: input.table_version,
        window_start_ms: input.window_start_ms,
        window_end_ms: input.window_end_ms,
        cursor_id: cursor,
        limit,
      }, listSourceBlocksResponseSchema);

      blocks.push(...(resp.blocks ?? []));
      if (!resp.has_more) break;
      cursor = Number(resp.next_cursor_id ?? cursor);
      if (!Number.isFinite(cursor) || cursor <= 0) break;
    }

    return blocks;
  }

  async listSourceGroups(payload: {
    tier: "hourly" | "daily" | "weekly" | "period";
    table_name: string;
    window_start_ms: number;
    window_end_ms: number;
  }): Promise<Array<{ period_tag: string; table_version: string; source_blocks: number }>> {
    const resp = await this.postJson(
      "/internal/compaction/list-source-groups",
      payload,
      listSourceGroupsResponseSchema,
    );

    return (resp.groups ?? [])
      .map((group) => ({
        period_tag: String(group.period_tag ?? ""),
        table_version: String(group.table_version ?? ""),
        source_blocks: Number(group.source_blocks ?? 0),
      }))
      .filter((group) => group.period_tag.length > 0 && group.table_version.length > 0);
  }

  async listSourceTables(payload: {
    tier: "hourly" | "daily" | "weekly" | "period";
    window_start_ms?: number;
    window_end_ms?: number;
  }): Promise<string[]> {
    const resp = await this.postJson(
      "/internal/compaction/list-source-tables",
      payload,
      listSourceTablesResponseSchema,
    );

    return [...new Set((resp.tables ?? [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
  }

  async resolveSourceWindowRange(payload: {
    tier: "hourly" | "daily" | "weekly" | "period";
    table_names: string[];
  }): Promise<{ start_ms: number | null; end_ms: number | null }> {
    const resp = await this.postJson(
      "/internal/compaction/resolve-source-window-range",
      payload,
      resolveSourceWindowRangeResponseSchema,
    );

    const start = Number(resp.start_ms);
    const end = Number(resp.end_ms);

    return {
      start_ms: Number.isFinite(start) ? start : null,
      end_ms: Number.isFinite(end) ? end : null,
    };
  }

  async fetchBlockOcf(filePath: string, startByte: number, length: number): Promise<Uint8Array> {
    const res = await fetch(`${this.config.baseUrl}/internal/compaction/fetch-block-ocf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-INTERNAL-TOKEN": this.config.token,
      },
      body: JSON.stringify({ file_path: filePath, start_byte: startByte, length }),
    });

    if (!res.ok) {
      throw new Error(`fetch-block-ocf failed: ${res.status} ${await res.text()}`);
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  async verifyOutputVisible(filePath: string): Promise<boolean> {
    const resp = await this.postJson("/internal/compaction/verify-output-visible", {
      file_path: filePath,
    }, verifyOutputVisibleResponseSchema);
    return Boolean(resp.success && resp.visible);
  }

  async acquireOutputLock(payload: {
    file_path: string;
    lock_token: string;
    table_version: string;
    compaction_tier: string;
    source_tier: string;
    window_start_ms: number;
    window_end_ms: number;
    run_key?: string;
    lock_ttl_ms?: number;
  }): Promise<{ acquired: boolean; lock_expires_ms?: number | null }> {
    const res = await fetch(`${this.config.baseUrl}/internal/compaction/acquire-output-lock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-INTERNAL-TOKEN": this.config.token,
      },
      body: JSON.stringify(payload),
    });

    if (res.status !== 409 && !res.ok) {
      throw new Error(`Internal API /internal/compaction/acquire-output-lock failed: ${res.status} ${await res.text()}`);
    }

    const resp = await this.parseJson(
      "/internal/compaction/acquire-output-lock",
      res,
      acquireOutputLockResponseSchema,
    );

    return {
      acquired: Boolean(resp.acquired),
      lock_expires_ms: Number.isFinite(Number(resp.lock_expires_ms))
        ? Number(resp.lock_expires_ms)
        : null,
    };
  }

  async releaseOutputLock(payload: {
    file_path: string;
    lock_token: string;
  }): Promise<boolean> {
    const resp = await this.postJson(
      "/internal/compaction/release-output-lock",
      payload,
      releaseOutputLockResponseSchema,
    );

    return Boolean(resp.success && resp.released);
  }

  async registerOutput(payload: {
    file_path: string;
    lock_token: string;
    table_version: string;
    compaction_tier: string;
    source_tier: string;
    window_start_ms: number;
    window_end_ms: number;
    file_size: number;
    compression_codec: string;
    blocks: RegisterOutputBlock[];
  } & RegisterOutputPayload): Promise<void> {
    await this.postJson("/internal/compaction/register-output", payload, z.unknown());
  }

  async cleanupConsumedSources(payload: CleanupConsumedSourcesPayload): Promise<void> {
    await this.postJson("/internal/compaction/cleanup-consumed-sources", payload, z.unknown());
  }

  async periodRolloverCheck(payload: {
    table_name: string;
    source_tier?: "hourly" | "daily" | "weekly" | "period";
  }): Promise<{
    success: boolean;
    should_compact: boolean;
    reason: string;
    closed_period_tag: string | null;
    current_open_period_tag: string | null;
  }> {
    return await this.postJson(
      "/internal/compaction/period-rollover-check",
      payload,
      periodRolloverCheckResponseSchema,
    );
  }

  async resolveTableVersion(payload: {
    table_name: string;
    period_tag: string;
    source_tier: "hourly" | "daily" | "weekly" | "period";
  }): Promise<string> {
    const resp = await this.postJson(
      "/internal/compaction/resolve-table-version",
      payload,
      resolveTableVersionResponseSchema,
    );

    if (!resp.table_version) {
      throw new Error("table_version could not be resolved");
    }

    return resp.table_version;
  }
}
