/**
 * Manual Compaction Trigger Script
 * Usage:
 *   pnpm compact
 *   node scripts/trigger-compaction.mjs [workflow-url] [token]
 */

const workflowUrl = (process.argv[2] || process.env.WORKFLOW_URL || 'http://localhost:8787').replace(/\/+$/, '');
const token = process.argv[3] || process.env.UPLOAD_INGEST_TOKEN || process.env.ADMIN_TOKEN || 'local-dev-token';

console.log(`[Compaction Trigger] Target URL: ${workflowUrl}/admin/compact`);

async function triggerCompaction() {
  try {
    const response = await fetch(`${workflowUrl}/admin/compact`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const status = response.status;
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    if (!response.ok) {
      console.error(`[Compaction Trigger] Failed with status ${status}:`, body);
      process.exit(1);
    }

    console.log('[Compaction Trigger] Compaction triggered successfully:', body);
  } catch (error) {
    console.error('[Compaction Trigger] Network error connecting to workflow worker:', error instanceof Error ? error.message : String(error));
    console.error('Ensure that fusou-workflow is running (e.g. pnpm --filter fusou-workflow dev)');
    process.exit(1);
  }
}

triggerCompaction();
