# Client Migration Guide: Old → New Queue Message Format

## Problem Statement

The FUSOU-APP Rust client currently sends messages to Cloudflare Queue in the **old Compaction format**, which is incompatible with the new **Hot/Cold system**.

**Impact:**
- All messages from FUSOU-APP are being **silently skipped** by buffer-consumer
- No data ingestion to D1 `buffer_logs` table
- Users' battle data is not being stored

**Root Cause:**
- [FUSOU-APP/src-tauri/src/storage/providers/r2/provider.rs](../FUSOU-APP/src-tauri/src/storage/providers/r2/provider.rs) sends Avro binary data to `/api/battle-data/upload`
- [FUSOU-WEB/src/server/routes/battle_data.ts](../FUSOU-WEB/src/server/routes/battle_data.ts) converts to old format (`avro_base64`) before queuing
- [FUSOU-WORKFLOW/src/buffer-consumer.ts](./src/buffer-consumer.ts) expects new format (`records` array)

---

## Solution Options

### Option 1: Update Rust Client (Recommended)

**Pros:**
- Clean separation: client sends final format
- No server-side Avro parsing overhead
- Easier to debug (human-readable JSON records)

**Cons:**
- Requires FUSOU-APP rebuild and redistribution
- Users must update app

**Implementation:**

1. **Add Avro Decoder to Rust Client**
   
   The Rust client currently concatenates Avro binary files. We need to decode them to JSON records.

   ```rust
   // In r2/provider.rs, after concatenating Avro data:
   
   use apache_avro::{Reader, from_avro_datum};
   
   async fn upload_to_r2(
       &self,
       period_tag: &str,
       path_tag: &str,
       dataset_id: &str,
       table_name: &str,
       data: Vec<u8>,
       table_offsets: String,
   ) -> Result<(), StorageError> {
       // NEW: Decode Avro to JSON records
       let records = decode_avro_to_json(&data)?;
       
       // NEW: Send to queue with new format
       self.send_to_queue(dataset_id, table_name, period_tag, records).await?;
       
       Ok(())
   }
   
   fn decode_avro_to_json(avro_data: &[u8]) -> Result<Vec<serde_json::Value>, StorageError> {
       let reader = Reader::new(avro_data)
           .map_err(|e| StorageError::Operation(format!("Avro decode failed: {}", e)))?;
       
       let mut records = Vec::new();
       for value in reader {
           let value = value
               .map_err(|e| StorageError::Operation(format!("Avro value read failed: {}", e)))?;
           
           let json = apache_avro::to_value(&value)
               .map_err(|e| StorageError::Operation(format!("Avro to JSON failed: {}", e)))?;
           
           records.push(json);
       }
       
       Ok(records)
   }
   
   async fn send_to_queue(
       &self,
       dataset_id: &str,
       table_name: &str,
       period_tag: &str,
       records: Vec<serde_json::Value>,
   ) -> Result<(), StorageError> {
       let configs = configs::get_user_configs_for_app();
       let queue_endpoint = configs.database.r2.get_queue_endpoint()?;
       
       let message = serde_json::json!({
           "dataset_id": dataset_id,
           "table": table_name,
           "period_tag": period_tag,
           "records": records,
           "uploaded_by": get_user_id().await
       });
       
       let client = reqwest::Client::new();
       let response = client
           .post(&queue_endpoint)
           .json(&message)
           .send()
           .await?;
       
       if !response.status().is_success() {
           return Err(StorageError::Operation(
               format!("Queue send failed: {}", response.status())
           ));
       }
       
       Ok(())
   }
   ```

2. **Update Cargo.toml**

   ```toml
   [dependencies]
   apache-avro = "0.16"
   ```

3. **Test Locally**

   ```bash
   cd packages/FUSOU-APP/src-tauri
   cargo build
   cargo test
   ```

4. **Deploy**

   ```bash
   # Build release
   cargo build --release
   
   # Test with single battle
   # Verify queue receives new format
   
   # Distribute to users
   ```

---

### Option 2: Update Server Endpoint (Quick Fix)

**Pros:**
- No client update required
- Immediate deployment

**Cons:**
- Server-side Avro parsing overhead
- More complex debugging
- Still need client update eventually

**Implementation:**

Modify [FUSOU-WEB/src/server/routes/battle_data.ts](../FUSOU-WEB/src/server/routes/battle_data.ts) lines 207-229:

```typescript
// BEFORE (Old format):
messages.push({
  body: {
    table: tname,
    avro_base64: b64,
    datasetId,
    periodTag,
    triggeredAt,
    userId: user.id,
  },
});

// AFTER (New format):
const records = await parseAvroToRecords(slice);  // NEW: Parse Avro
messages.push({
  body: {
    dataset_id: datasetId,
    table: tname,
    period_tag: periodTag,
    records: records,  // NEW: Send records array
    uploaded_by: user.id,
  },
});
```

Add Avro parser:

```typescript
import { parseDeflateAvroBlock } from './avro-parser';  // From FUSOU-WORKFLOW

async function parseAvroToRecords(avroData: Uint8Array): Promise<any[]> {
  // Read Avro OCF header
  // Parse blocks
  // Decode records
  // Return JSON array
  
  const records: any[] = [];
  // Implementation using parseDeflateAvroBlock or similar
  return records;
}
```

---

## Migration Timeline

### Phase 1: Immediate (2025-12-24)
- ✅ Deploy updated buffer-consumer (skips old format)
- ✅ Purge queue
- ✅ Document migration requirement

### Phase 2: Development (1-2 days)
- [ ] Choose Option 1 or Option 2
- [ ] Implement changes
- [ ] Test with local queue

### Phase 3: Testing (1 day)
- [ ] Deploy to dev environment
- [ ] Verify new format messages processed correctly
- [ ] Check D1 `buffer_logs` table has data
- [ ] Monitor wrangler tail logs

### Phase 4: Production (1 day)
- [ ] Deploy to production
- [ ] Monitor for errors
- [ ] Verify archival workflow works

---

## Verification Steps

After deployment, verify the migration:

1. **Check Queue Messages**
   ```bash
   npx wrangler tail --format=pretty
   ```
   
   Look for:
   ```
   ✅ Buffered 10 records (success: true)
   ```
   
   NOT:
   ```
   ❌ [DEPRECATED] Old format message detected
   ```

2. **Check D1 Data**
   ```bash
   npx wrangler d1 execute dev_kc_battle_index --command "SELECT COUNT(*) FROM buffer_logs"
   ```
   
   Should show non-zero count.

3. **Check R2 Archives** (after archival cron runs)
   ```bash
   npx wrangler r2 object list dev-kc-battle-data --prefix="avro/"
   ```
   
   Should show `.avro` files with recent timestamps.

---

## Rollback Plan

If migration fails:

1. **Revert buffer-consumer.ts** to accept old format
2. **Deploy reverted worker**
3. **Purge queue again**
4. **Re-enable old Compaction system**

---

## Support

Questions? Check:
- [AVRO_CLOUDFLARE_DEPLOYMENT.md](./AVRO_CLOUDFLARE_DEPLOYMENT.md) - Full deployment guide
- [Cloudflare Queues Docs](https://developers.cloudflare.com/queues/)
- [Wrangler Tail Logs](https://developers.cloudflare.com/workers/observability/logging/tail-workers/)
