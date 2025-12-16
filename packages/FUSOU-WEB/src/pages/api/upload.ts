import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

interface UploadRequest {
  datasetId: string;
  tableId: string;
  fileName: string;
}

/**
 * POST /api/upload
 * Upload Parquet file to R2 and trigger compaction workflow
 */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    // === Authentication Check ===
    if (!locals.user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const env = locals.runtime.env;
    
    // リクエスト検証
    if (!request.body) {
      return new Response(
        JSON.stringify({ error: 'No request body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const formData = await request.formData();
    const datasetId = formData.get('datasetId') as string;
    const tableId = formData.get('tableId') as string;
    const file = formData.get('file') as File;

    if (!datasetId || !tableId || !file) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: datasetId, tableId, file' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = env.PUBLIC_SUPABASE_URL as string;
    const supabaseKey = env.SUPABASE_SECRET_KEY as string;
    const r2Bucket = env.ASSETS_BUCKET as R2Bucket;
    const battleDataBucket = env.BATTLE_DATA_BUCKET as R2Bucket;
    const compactionQueue = env.COMPACTION_QUEUE as Queue;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ===== Step 1: R2 に Parquet ファイル保存 =====
    const uploadStartTime = Date.now();
    const bucketKey = `${datasetId}/${tableId}`;
    const buffer = await file.arrayBuffer();

    console.info(`[Upload API] Uploading file to R2`, {
      datasetId,
      tableId,
      bucketKey,
      fileSize: buffer.byteLength,
      timestamp: new Date().toISOString(),
    });

    const r2UploadStart = Date.now();
    const r2Result = await r2Bucket.put(bucketKey, buffer, {
      customMetadata: {
        dataset_id: datasetId,
        table_id: tableId,
        uploaded_at: new Date().toISOString(),
        original_filename: file.name,
      },
    });
    const r2UploadDuration = Date.now() - r2UploadStart;

    console.info(`[Upload API] R2 upload completed`, {
      bucketKey,
      etag: r2Result.httpEtag,
      duration: `${r2UploadDuration}ms`,
    });

    // ===== Intermediate: Copy to BATTLE_DATA_BUCKET for compaction =====
    const battleDataCopyStart = Date.now();
    
    // Read from ASSETS_BUCKET
    const uploadedFile = await r2Bucket.get(bucketKey);
    if (!uploadedFile) {
      return new Response(
        JSON.stringify({ error: 'Failed to read uploaded file for compaction' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Write to BATTLE_DATA_BUCKET with datasetId as key
    const battleDataCopyResult = await battleDataBucket.put(datasetId, uploadedFile.body, {
      customMetadata: {
        source_bucket: 'assets',
        source_key: bucketKey,
        original_filename: file.name,
        copied_at: new Date().toISOString(),
      },
    });

    const battleDataCopyDuration = Date.now() - battleDataCopyStart;

    console.info(`[Upload API] Battle data bucket copy completed`, {
      datasetId,
      etag: battleDataCopyResult.httpEtag,
      duration: `${battleDataCopyDuration}ms`,
    });

    // ===== Step 2: Supabase datasets テーブル更新 =====
    const supabaseUpdateStart = Date.now();

    const { data: existingDataset } = await supabase
      .from('datasets')
      .select('id')
      .eq('id', datasetId)
      .single();

    if (existingDataset) {
      // 更新（既存レコード）
      const { error: updateError } = await supabase
        .from('datasets')
        .update({
          compaction_needed: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', datasetId);

      if (updateError) {
        throw new Error(`Failed to update dataset: ${updateError.message}`);
      }
    } else {
      // 挿入（新規レコード）
      const { error: insertError } = await supabase
        .from('datasets')
        .insert({
          id: datasetId,
          name: `${tableId}-${Date.now()}`,
          user_id: locals.user.id, // 認証済みなので必ず存在
          compaction_needed: true,
          compaction_in_progress: false,
          file_size_bytes: buffer.byteLength,
          file_etag: r2Result.httpEtag,
        });

      if (insertError) {
        throw new Error(`Failed to insert dataset: ${insertError.message}`);
      }
    }

    const supabaseUpdateDuration = Date.now() - supabaseUpdateStart;

    console.info(`[Upload API] Supabase update completed`, {
      datasetId,
      duration: `${supabaseUpdateDuration}ms`,
    });

    // ===== Step 3: Queue に メッセージ送信 =====
    const queueSendStart = Date.now();

    await compactionQueue.send({
      datasetId: datasetId,
      triggeredAt: new Date().toISOString(),
      priority: 'realtime',
    });

    const queueSendDuration = Date.now() - queueSendStart;

    console.info(`[Upload API] Queue message sent`, {
      datasetId,
      duration: `${queueSendDuration}ms`,
    });

    // ===== レスポンス返却 =====
    const totalUploadDuration = Date.now() - uploadStartTime;

    console.info(`[Upload API] Request completed`, {
      datasetId,
      totalDuration: `${totalUploadDuration}ms`,
      breakdown: {
        r2Upload: `${r2UploadDuration}ms`,
        supabaseUpdate: `${supabaseUpdateDuration}ms`,
        queueSend: `${queueSendDuration}ms`,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        datasetId,
        fileSize: buffer.byteLength,
        etag: r2Result.httpEtag,
        timing: {
          r2Upload: `${r2UploadDuration}ms`,
          battleDataCopy: `${battleDataCopyDuration}ms`,
          supabaseUpdate: `${supabaseUpdateDuration}ms`,
          queueSend: `${queueSendDuration}ms`,
          total: `${totalUploadDuration}ms`,
        },
      }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    const errorMessage = String(error);

    console.error(`[Upload API] Error`, {
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
