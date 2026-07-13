import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { mergeAvroOCF, mergeAvroOCFWithBoundaries } from "@fusou/compaction-core";
import { InternalCompactionClient } from "./internal-api.js";
import type { CompactionJobInput, RegisterOutputBlock, SourceBlock } from "./types.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function groupByDataset(blocks: SourceBlock[]): Map<string, SourceBlock[]> {
  const map = new Map<string, SourceBlock[]>();
  for (const block of blocks) {
    if (!map.has(block.dataset_id)) map.set(block.dataset_id, []);
    map.get(block.dataset_id)!.push(block);
  }
  return map;
}

function shouldDeleteConsumedSourceR2(): boolean {
  const raw = String(process.env.COMPACTION_DELETE_CONSUMED_SOURCE_R2 ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function normalizeOutputGroupKey(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return null;
  return value;
}

function buildOutputFilePath(input: CompactionJobInput): string {
  // Prefer an explicit output group key so multiple table outputs can share
  // the same epoch-hash folder. Fallback keeps compatibility with legacy paths.
  const groupKey = normalizeOutputGroupKey(input.output_group_key) ?? createHash("sha256")
    .update(input.run_key)
    .digest("hex")
    .slice(0, 16);
  return `${input.table_version}/${input.period_tag}/${input.tier}/${groupKey}/${input.table_name}-001.avro`;
}

async function uploadToR2(
  data: Uint8Array,
  key: string,
  meta: Pick<CompactionJobInput, "tier" | "source_tier">,
): Promise<void> {
  const bucket = requiredEnv("R2_BUCKET");
  const endpoint = requiredEnv("R2_S3_ENDPOINT");
  const accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("R2_SECRET_ACCESS_KEY");

  const client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: "application/avro",
      Metadata: {
          "compaction-tier": String(meta.tier),
          "source-tier": String(meta.source_tier),
      },
    }),
  );
}

export async function runCompactionJob(input: CompactionJobInput): Promise<void> {
  const baseUrl = requiredEnv("INTERNAL_COMPACTION_BASE_URL").replace(/\/$/, "");
  const token = requiredEnv("INTERNAL_COMPACTION_TOKEN");
  const client = new InternalCompactionClient({ baseUrl, token });
  const outputKey = buildOutputFilePath(input);
  const lockToken = randomUUID();

  try {
    const lock = await client.acquireOutputLock({
      file_path: outputKey,
      lock_token: lockToken,
      table_version: input.table_version,
      compaction_tier: input.tier,
      source_tier: input.source_tier,
      window_start_ms: input.window_start_ms,
      window_end_ms: input.window_end_ms,
      run_key: input.run_key,
      lock_ttl_ms: 6 * 60 * 60_000,
    });

    if (!lock.acquired) {
      throw new Error(`Output lock is already held for ${outputKey}`);
    }

    const sourceBlocks = await client.listSourceBlocks(input);
    if (sourceBlocks.length === 0) {
      console.info(`[compactor] skipped empty source group: ${input.run_key}`);
      return;
    }

    const grouped = groupByDataset(sourceBlocks);
    const datasetMergedOcf: Uint8Array[] = [];
    const datasetMetas: Array<{
      dataset_id: string;
      table_name: string;
      period_tag: string;
      record_count: number;
      start_timestamp: number;
      end_timestamp: number;
      source_file_count: number;
    }> = [];

    for (const [datasetId, datasetBlocks] of grouped.entries()) {
      const ocfSlices: Uint8Array[] = [];
      for (const block of datasetBlocks) {
        const ocf = await client.fetchBlockOcf(block.file_path, block.start_byte, block.length);
        ocfSlices.push(ocf);
      }

      let mergedDataset: Uint8Array;
      try {
        mergedDataset = mergeAvroOCF(ocfSlices);
      } catch (error) {
        const sliceSummary = datasetBlocks.map((block) => ({
          file_id: block.file_id,
          file_path: block.file_path,
          start_byte: block.start_byte,
          length: block.length,
          record_count: block.record_count,
        }));
        throw new Error(
          `[compactor] failed to merge dataset OCF slices for dataset_id=${datasetId} table=${input.table_name} period=${input.period_tag} version=${input.table_version} source_tier=${input.source_tier}: ${error instanceof Error ? error.message : String(error)} | slices=${JSON.stringify(sliceSummary)}`,
        );
      }
      datasetMergedOcf.push(mergedDataset);

      datasetMetas.push({
        dataset_id: datasetId,
        table_name: datasetBlocks[0].table_name,
        period_tag: datasetBlocks[0].period_tag,
        record_count: datasetBlocks.reduce((sum, b) => sum + Number(b.record_count || 0), 0),
        start_timestamp: Math.min(...datasetBlocks.map((b) => Number(b.start_timestamp || 0))),
        end_timestamp: Math.max(...datasetBlocks.map((b) => Number(b.end_timestamp || 0))),
        source_file_count: new Set(datasetBlocks.map((b) => b.file_id)).size,
      });
    }

    const merged = mergeAvroOCFWithBoundaries(datasetMergedOcf);
    await uploadToR2(merged.merged, outputKey, {
      tier: input.tier,
      source_tier: input.source_tier,
    });

    const visibleFromWeb = await client.verifyOutputVisible(outputKey);
    if (!visibleFromWeb) {
      throw new Error(
        `Uploaded object is not visible from FUSOU-WEB bucket binding: ${outputKey}. Check R2_BUCKET/R2 credentials.`,
      );
    }

    const registerBlocks: RegisterOutputBlock[] = merged.boundaries.map((boundary, i) => {
      const meta = datasetMetas[i];
      return {
        dataset_id: meta.dataset_id,
        table_name: meta.table_name,
        period_tag: meta.period_tag,
        start_byte: boundary.startByte,
        length: boundary.length,
        record_count: meta.record_count,
        start_timestamp: meta.start_timestamp,
        end_timestamp: meta.end_timestamp,
        source_file_count: meta.source_file_count,
      };
    });

    const sourceFileIds = [...new Set(sourceBlocks.map((block) => Number(block.file_id)).filter((id) => Number.isFinite(id) && id > 0))];

    await client.registerOutput({
      file_path: outputKey,
      lock_token: lockToken,
      table_version: input.table_version,
      compaction_tier: input.tier,
      source_tier: input.source_tier,
      window_start_ms: input.window_start_ms,
      window_end_ms: input.window_end_ms,
      file_size: merged.merged.byteLength,
      compression_codec: "deflate",
      blocks: registerBlocks,
    });

    if (sourceFileIds.length > 0) {
      await client.cleanupConsumedSources({
        source_file_ids: sourceFileIds,
        source_tier: input.source_tier,
        table_name: input.table_name,
        period_tag: input.period_tag,
        table_version: input.table_version,
        window_start_ms: input.window_start_ms,
        window_end_ms: input.window_end_ms,
      });
    }

    const sourcePaths = [...new Set(sourceBlocks.map((block) => String(block.file_path || "")).filter(Boolean))];
    if (sourcePaths.length > 0 && shouldDeleteConsumedSourceR2()) {
      const bucket = requiredEnv("R2_BUCKET");
      const endpoint = requiredEnv("R2_S3_ENDPOINT");
      const accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
      const secretAccessKey = requiredEnv("R2_SECRET_ACCESS_KEY");

      const client = new S3Client({
        region: "auto",
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      });

      // Cleanup in D1 first; source object deletion is best-effort to avoid data-plane lockups.
      for (const sourcePath of sourcePaths) {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: sourcePath }));
        } catch (error) {
          console.warn(`[compactor] failed to delete consumed source object: ${sourcePath}`, error);
        }
      }
    } else if (sourcePaths.length > 0) {
      console.info(
        `[compactor] source R2 deletion is disabled; kept ${sourcePaths.length} consumed source objects`,
      );
    }

  } catch (error) {
    throw error;
  } finally {
    try {
      await client.releaseOutputLock({
        file_path: outputKey,
        lock_token: lockToken,
      });
    } catch (error) {
      console.warn(`[compactor] failed to release output lock: ${outputKey}`, error);
    }
  }
}

function parseJobFromEnv(): CompactionJobInput {
  const raw = requiredEnv("COMPACTION_JOB_JSON");
  const parsed = JSON.parse(raw) as CompactionJobInput;
  return {
    ...parsed,
    chunk_limit:
      Number.isFinite(Number(parsed.chunk_limit)) && Number(parsed.chunk_limit) > 0
        ? Number(parsed.chunk_limit)
        : 200,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCompactionJob(parseJobFromEnv()).catch((error) => {
    console.error("Compaction job failed", error);
    process.exit(1);
  });
}
