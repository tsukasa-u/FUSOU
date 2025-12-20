# FUSOU-WORKFLOW Fix: Fallback to Full File Download

## Problem
From logs:
```
[OffsetExtractor] Table 'port_table' not found in offsets for fragment ...
Error: No valid fragments after table extraction
```

**Root cause**: When `extractTableSafe` returns `null` (target table not in offsets), the workflow skips the fragment entirely instead of falling back to full file download.

## Current Code (index.ts:381)
```typescript
} else {
  console.warn(`[Workflow] Failed to extract ${targetTable} from ${frag.key}, skipping`);
}
```

## Required Fix
Replace lines 381-382 in `packages/FUSOU-WORKFLOW/src/index.ts`:

```typescript
} else {
  // Target table not found in offsets - fallback to full file download
  console.warn(`[Workflow] Table ${targetTable} not in offsets for ${frag.key}, downloading full file`);
  const fullFile = await this.env.BATTLE_DATA_BUCKET.get(frag.key);
  if (fullFile) {
    const data = await fullFile.arrayBuffer();
    extractedFragments.push({
      key: frag.key,
      data,
      size: data.byteLength,
    });
  } else {
    console.warn(`[Workflow] Failed to download ${frag.key}, skipping`);
  }
}
```

## Why This Fixes the Issue
1. **Graceful degradation**: If `table_offsets` exists but doesn't contain the target table, download the whole file
2. **Backward compatibility**: Handles both legacy fragments (no offsets) and partial offset metadata (missing specific tables)
3. **Prevents "No valid fragments" error**: Ensures at least some data is extracted for processing

## Additional Context
- WEB upload now enforces strict offset validation, but existing data may lack proper offsets
- Some clients may upload files without `table_offsets` parameter
- This fallback ensures workflow continues even with incomplete metadata
