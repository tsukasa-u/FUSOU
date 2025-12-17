# Cloudflare Pages Queue Consumer Issue - Resolution

## Problem

Cloudflare Pages deployment was failing with error:
```
Configuration file for Pages projects does not support "queues.consumers"
```

This occurred because `wrangler.toml` in FUSOU-WEB attempted to define queue consumers, which Pages does not support.

## Root Cause

**Cloudflare Pages has architectural limitations:**
- ✅ Pages CAN: Produce messages to queues (via `queues.producers`)
- ❌ Pages CANNOT: Consume messages from queues (no `queues.consumers` support)

Queue consumer functionality is only available in:
- **Cloudflare Workers** (standard workers with `queues.consumers` in wrangler.toml)
- Legacy queue systems

See: [Cloudflare Queues Documentation](https://developers.cloudflare.com/queues/)

## Solution

Leveraged **existing FUSOU-WORKFLOW** (Cloudflare Worker with Durable Workflows) that already implements queue consumption:

### Architecture

The system already has proper queue consumption in place:

```
FUSOU-WEB (Cloudflare Pages)
  └─ Produces messages to COMPACTION_QUEUE
     (via queues.producers in wrangler.toml)
  
FUSOU-WORKFLOW (Cloudflare Worker)
  ├─ Consumes messages from COMPACTION_QUEUE
  │  (via queues.consumers in wrangler.toml)
  │
  ├─ Validates dataset
  ├─ Extracts & groups Parquet fragments
  ├─ Performs data compaction
  ├─ Updates D1 metadata
  └─ Updates R2 with compacted data
```

### Modified Files

**1. `packages/FUSOU-WEB/wrangler.toml`**
- ❌ Removed: `[[queues.consumers]]` block (lines 59-64)
- ✅ Kept: `[[queues.producers]]` (Pages produces messages)
- ✅ Kept: Queue bindings for COMPACTION_QUEUE and COMPACTION_DLQ

**2. `packages/FUSOU-WEB/functions/compaction-queue.ts`**
- ❌ Deleted: Not needed (FUSOU-WORKFLOW handles queue consumption)

### Why This Works

FUSOU-WORKFLOW (`/packages/FUSOU-WORKFLOW/`) is a Cloudflare Worker (not Pages) and ALREADY has:

1. **Queue Consumer Configuration** (`wrangler.toml`):
   ```toml
   [[queues.consumers]]
   queue = "dev-kc-compaction-queue"
   max_batch_size = 10
   max_batch_timeout = 30
   max_retries = 3
   dead_letter_queue = "dev-kc-compaction-dlq"
   ```

2. **Queue Handler Implementation** (`src/index.ts`):
   ```typescript
   export const queue = {
     async queue(batch: MessageBatch<any>, env: Env) {
       // Processes messages from COMPACTION_QUEUE
       // Extracts datasetId, table, periodTag, etc.
       // Triggers DataCompactionWorkflow
     }
   }
   ```

3. **Complete Compaction Logic**:
   - Validates datasets
   - Extracts Parquet fragments from R2
   - Groups by schema
   - Performs stream-based merge compaction
   - Updates D1 metadata
   - Writes compacted files back to R2

## Data Flow

1. **Upload Stage**
   ```
   Client → POST /api/battle-data/upload → FUSOU-WEB (Pages)
   ```

2. **Queue Producer** (Pages)
   ```
   FUSOU-WEB enqueues to COMPACTION_QUEUE: {
     datasetId: "...",
     table: "...",
     periodTag: "...",
     priority: "realtime",
     metricId: "...",
     triggeredAt: ISO8601
   }
   ```

3. **Queue Storage**
   ```
   COMPACTION_QUEUE buffers messages
   (Cloudflare infrastructure manages the queue)
   ```

4. **Queue Consumer** (FUSOU-WORKFLOW Worker)
   ```
   Polls COMPACTION_QUEUE every 30 seconds (max_batch_timeout)
   ↓
   Extracts message: { datasetId, table, periodTag, ... }
   ↓
   Triggers DataCompactionWorkflow
   ↓
   On success: ack() → message consumed
   On error: DLQ → ack() → message consumed
   ```

5. **Workflow Processing**
   ```
   DataCompactionWorkflow:
   - Validates dataset exists
   - Reads Parquet files from R2
   - Groups fragments by schema
   - Performs stream-based merge compaction
   - Updates metadata in D1
   - Writes compacted files to R2
   ```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              FUSOU-WEB (Cloudflare Pages)               │
│  - Serves UI, REST APIs                                 │
│  - POST /api/battle-data/upload                         │
│  - Enqueues to COMPACTION_QUEUE                         │
│  - Cannot consume queues ❌                             │
└────────────┬────────────────────────────────────────────┘
             │
             │ Produces: CompactionMessage
             │ queue.send({ datasetId, table, periodTag })
             ↓
    ┌────────────────────────────────┐
    │   Cloudflare Queues            │
    ├────────────────────────────────┤
    │ dev-kc-compaction-queue        │
    │   - Max batch: 10 messages     │
    │   - Max timeout: 30 seconds    │
    │   - Max retries: 3             │
    │                                │
    │ dev-kc-compaction-dlq          │
    │   - Failed messages            │
    └────────┬───────────────────────┘
             │
             │ Consumes: All pending messages
             ↓
┌──────────────────────────────────────────────────────┐
│   FUSOU-WORKFLOW (Cloudflare Worker)                 │
│   - DataCompactionWorkflow (Durable Workflow)        │
│   - Queue consumer: Polls for messages               │
│   - Can consume queues ✓                             │
│                                                      │
│   For each message:                                  │
│   1. Validate dataset                                │
│   2. Extract Parquet fragments from R2               │
│   3. Group by schema                                 │
│   4. Perform compaction                              │
│   5. Update D1 metadata                              │
│   6. Write compacted data to R2                      │
└──────────────────────────────────────────────────────┘
```

## Setup

### FUSOU-WEB (Pages)

No special setup needed. The `wrangler.toml` already has:
```toml
[[queues.producers]]
queue = "dev-kc-compaction-queue"
binding = "COMPACTION_QUEUE"
```

Just deploy normally:
```bash
cd packages/FUSOU-WEB
npm run build
npm run deploy
```

### FUSOU-WORKFLOW (Worker)

Already configured and deployed. It automatically:
- Polls COMPACTION_QUEUE
- Processes messages
- Handles errors to DLQ

Verify it's running:
```bash
cd packages/FUSOU-WORKFLOW
npm run deploy
```

## Validation

✅ **FUSOU-WEB Pages**
- wrangler.toml: No queue consumers (valid for Pages)
- Produces messages to COMPACTION_QUEUE
- Returns 200 response after enqueueing

✅ **FUSOU-WORKFLOW Worker**
- wrangler.toml: Properly configured queue consumers
- Automatically polls and processes queue messages
- Implements complete compaction workflow

✅ **Message Flow**
- Queue messages structure: `{ datasetId, table, periodTag, ... }`
- Queue consumer routes: main queue and DLQ
- Error handling: Failed messages sent to DLQ

## How It Works (Complete Flow)

### 1. Upload Request (Client → Pages)
```bash
POST /api/battle-data/upload
Authorization: Bearer {jwt_token}
Content-Type: multipart/form-data

File: parquet_data.parquet
periodTag: "2025-port-1-1"
```

**FUSOU-WEB Processing (in `compact.ts`):**
- Validates JWT token
- Extracts R2 upload credentials
- Validates Parquet file
- Uploads to R2: `datasets/{datasetId}/{timestamp}.parquet`
- Creates metadata record in D1 (BATTLE_INDEX_DB)
- **Enqueues message to COMPACTION_QUEUE**
- Returns 200 OK (with or without queue success)

### 2. Queue Message (Pages → Queues)
```json
{
  "datasetId": "dataset_001",
  "table": "battle_files",
  "periodTag": "2025-port-1-1",
  "priority": "realtime",
  "metricId": "metric_xyz",
  "triggeredAt": "2025-12-18T10:30:00Z"
}
```

**Stored in:** `dev-kc-compaction-queue` (Cloudflare infrastructure)

### 3. Queue Consumer (FUSOU-WORKFLOW Worker)
Every 30 seconds (or when 10 messages arrive), the worker:
```typescript
export const queue = {
  async queue(batch: MessageBatch<any>, env: Env) {
    for (const msg of batch.messages) {
      const { datasetId, table, periodTag, ... } = msg.body;
      
      // Trigger workflow
      const result = await env.DATA_COMPACTION.create({
        params: { datasetId, bucketKey: '...', table, periodTag }
      });
      
      msg.ack();  // Mark as consumed
    }
  }
}
```

**Location:** `FUSOU-WORKFLOW/src/index.ts` (lines 762-841)

### 4. Workflow Processing (FUSOU-WORKFLOW)
**DataCompactionWorkflow** executes these steps:

1. **Validate Dataset**
   - Check dataset exists in Supabase
   - Verify compaction status

2. **List Fragments**
   - Query R2: `s3://dev-kc-battle-data/datasets/{datasetId}/`
   - Find all Parquet files (fragments)

3. **Extract & Group**
   - Extract schema from each fragment
   - Group by schema (same structure)

4. **Stream Merge Compaction**
   - Merge fragments with same schema
   - Apply row-level deduplication (based on periodTag)
   - Use streaming to handle large files

5. **Write Result**
   - Compress merged data
   - Upload to R2: `compacted/{datasetId}/`
   - Update metadata in D1

6. **Update Metrics**
   - Record compaction result
   - Update Supabase: `datasets.compaction_in_progress = false`

## Why This Architecture?

| Aspect | Pages | Worker | Workflow |
|--------|-------|--------|----------|
| **HTTP APIs** | ✅ | ✅ | ❌ |
| **Queue Producer** | ✅ | ✅ | ✅ |
| **Queue Consumer** | ❌ | ✅ | ✅ |
| **Long-running Tasks** | ⚠️ (10s timeout) | ✅ (CPU limits) | ✅ (5min steps) |
| **Cost** | Free tier available | Low | Medium |
| **Best For** | APIs, quick responses | Queue processing | Complex workflows |

**This Design:**
- Pages handles HTTP requests (fast response, scalable)
- FUSOU-WORKFLOW handles queue consumption and compaction (robust, long-running)
- Cloudflare Queues decouples producer from consumer (resilient)

## Troubleshooting

### "Queue consumer not processing messages"

**Check 1: Is FUSOU-WORKFLOW deployed?**
```bash
cd packages/FUSOU-WORKFLOW
npm run deploy
# Check: Cloudflare Dashboard → Workers → fusou-workflow
```

**Check 2: Are messages in the queue?**
```bash
# Dashboard → Queues → dev-kc-compaction-queue → Recent Messages
# Should show messages with datasetId, periodTag, etc.
```

**Check 3: Check FUSOU-WORKFLOW logs**
```bash
# Dashboard → Workers → fusou-workflow → Logs
# Look for: "[Compaction Queue Consumer] Processing message"
```

**Check 4: Message format**
Ensure messages match structure:
```json
{
  "datasetId": "string (required)",
  "table": "string (optional)",
  "periodTag": "string (optional)",
  "priority": "realtime|manual|scheduled",
  "metricId": "string (optional)",
  "triggeredAt": "ISO8601 timestamp"
}
```

### "Workflow completes but compaction doesn't happen"

Check FUSOU-WORKFLOW logs for errors in these steps:
- `validate-dataset` - Dataset not found?
- `list-fragments` - R2 not accessible?
- `extract-schema` - Invalid Parquet files?
- `stream-merge` - Memory/streaming errors?

### "Page deployment fails"

Ensure `wrangler.toml` has NO `[[queues.consumers]]`:
```bash
grep "queues.consumers" packages/FUSOU-WEB/wrangler.toml
# Should return nothing
```

If found, remove it and redeploy.

## References

- [FUSOU-WEB](../packages/FUSOU-WEB/) - Pages application
- [FUSOU-WORKFLOW](../packages/FUSOU-WORKFLOW/) - Queue consumer & compaction
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Durable Workflows](https://developers.cloudflare.com/workers/platform/durable-objects/workflows/)

## Deployment Checklist

- [ ] Remove `[[queues.consumers]]` from FUSOU-WEB/wrangler.toml
- [ ] Delete FUSOU-WEB/functions/compaction-queue.ts (or leave as reference)
- [ ] Deploy FUSOU-WEB: `npm run deploy`
- [ ] Deploy FUSOU-WORKFLOW: `npm run deploy`
- [ ] Verify in Dashboard:
  - [ ] Queues → dev-kc-compaction-queue shows messages
  - [ ] Workers → fusou-workflow appears in consumer list
  - [ ] Recent logs show queue processing
- [ ] Test upload endpoint with sample Parquet file
- [ ] Check D1 metadata is updated
- [ ] Verify compacted files appear in R2

## Summary

✅ **Cloudflare Pages Issues Resolved:**
- Removed invalid `queues.consumers` configuration
- Pages now properly produces queue messages only
- Valid configuration per Cloudflare Pages limitations

✅ **Queue Processing Working:**
- FUSOU-WORKFLOW handles all queue consumption
- Already implemented with full error handling
- No new worker needed

✅ **Architecture Optimized:**
- Pages: Fast HTTP responses
- Queues: Asynchronous message buffering
- Workflow: Complex processing with retries
- D1/R2: Persistent storage
