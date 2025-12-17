# FUSOU Queue Consumer Worker

This is a Cloudflare Worker that consumes messages from the FUSOU compaction queue and triggers the compaction workflow.

## Why Separate Worker?

Cloudflare Pages **does not support queue consumers** directly in `wrangler.toml`. Queue consumers can only be configured in:
- Cloudflare Workers
- Cloudflare Queues (legacy)

Therefore, this is a separate Cloudflare Worker project that:
1. Consumes messages from `dev-kc-compaction-queue`
2. Validates message structure
3. Triggers the compaction workflow
4. Handles failures gracefully (DLQ forwarding)

## Architecture

```
FUSOU-WEB (Pages)
  ├─ /api/battle-data/upload (POST) → enqueues to COMPACTION_QUEUE
  │
  ↓
  
COMPACTION_QUEUE (Cloudflare Queue)
  │
  ├─ dev-kc-compaction-queue (messages waiting)
  ├─ dev-kc-compaction-dlq (errors/dead letters)
  │
  ↓

FUSOU-QUEUE-CONSUMER (Worker) ← YOU ARE HERE
  │
  ├─ Polls/consumes messages from dev-kc-compaction-queue
  ├─ Validates { datasetId, table, periodTag }
  ├─ Calls COMPACTION_WORKFLOW service
  ├─ On error: sends to dev-kc-compaction-dlq
  ├─ Acks message (consumed)
  │
  ↓

FUSOU-WORKFLOW (Durable Workflow)
  └─ Executes actual data compaction
```

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Cloudflare account:**
   ```bash
   npx wrangler login
   ```

3. **Update wrangler.toml:**
   - Replace `dev-kc-compaction-queue` with your actual queue name
   - Update service binding names if different

4. **Deploy:**
   ```bash
   npm run deploy
   ```

## Configuration

### Queue Names
Update in `wrangler.toml`:
- Consumer queue: `dev-kc-compaction-queue`
- DLQ queue: `dev-kc-compaction-dlq`

### Service Bindings
The worker expects:
- `COMPACTION_WORKFLOW`: Service binding to your compaction workflow
- `COMPACTION_DLQ`: Queue binding for error handling (optional)

## Message Format

Expected message structure:
```json
{
  "datasetId": "string (required)",
  "table": "string (optional)",
  "periodTag": "string (optional)",
  "triggeredAt": "ISO 8601 timestamp",
  "priority": "realtime|manual|scheduled",
  "metricId": "string (optional)"
}
```

## Monitoring

### Local Development
```bash
npm run dev
```

Logs will show:
- Message reception
- Processing progress
- Success/failure status
- DLQ sends

### Production Monitoring
Check in Cloudflare Dashboard:
1. Workers → fusou-queue-consumer → Logs
2. Queues → dev-kc-compaction-queue → Status
3. Queues → dev-kc-compaction-dlq → Messages (errors)

## Integration Points

### In FUSOU-WEB (Pages)

This worker complements the Pages setup:
- Pages produces messages to `COMPACTION_QUEUE`
- This Worker consumes messages from the queue
- Both services communicate via shared queues

### In Workflow

Update the workflow integration:
```typescript
// This worker should call your actual compaction logic
// Currently it's a placeholder that needs implementation
// depending on your workflow setup
```

## TODO

- [ ] Update queue message handling to match your actual workflow API
- [ ] Add service binding configuration details
- [ ] Implement actual compaction trigger logic
- [ ] Add retry logic for transient failures
- [ ] Add metrics/observability
- [ ] Production queue naming

## Related Files

- `/packages/FUSOU-WEB/src/server/routes/compact.ts` - Queue producer
- `/packages/FUSOU-WEB/wrangler.toml` - Pages config (producer only)
- `/packages/FUSOU-WORKFLOW/` - Actual compaction implementation
