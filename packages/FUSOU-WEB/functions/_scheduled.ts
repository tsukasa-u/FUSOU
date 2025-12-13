type ScheduledHandler = (event: any, env: any, ctx: any) => Promise<void>;

// Environment variables expected to be available in Cloudflare Pages
// SUPABASE_URL, SUPABASE_KEY, API_BASE (optional), MAX_DATASETS_PER_RUN

const CONCURRENCY = Number(process.env.SCHEDULE_CONCURRENCY || 2);
const MAX_DATASETS_PER_RUN = Number(process.env.MAX_DATASETS_PER_RUN || 10);
const PER_DATASET_DELAY_MS = Number(process.env.SCHEDULE_DELAY_MS || 250);
const API_BASE = process.env.API_BASE || '';

async function fetchPendingDatasets(supabaseUrl: string, supabaseKey: string): Promise<string[]> {
  const url = `${supabaseUrl}/rest/v1/datasets?select=id,compaction_needed&compaction_needed=eq.true&order=updated_at.desc&limit=${MAX_DATASETS_PER_RUN}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) throw new Error(`Supabase fetch failed: ${resp.status}`);
  const json = await resp.json();
  return (json as Array<{ id: string }>).map((d) => d.id);
}

async function triggerCompaction(datasetId: string): Promise<void> {
  const url = `${API_BASE}/api/compaction/compact`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId }),
  });
  if (!resp.ok) throw new Error(`Trigger failed: ${resp.status}`);
}

export const scheduled: ScheduledHandler = async () => {
  const supabaseUrl = process.env.PUBLIC_SUPABASE_URL as string;
  const supabaseKey = process.env.PUBLIC_SUPABASE_ANON_KEY as string;

  if (!supabaseUrl || !supabaseKey) {
    console.log('Missing SUPABASE envs; skipping scheduled run');
    return;
  }

  const datasets = await fetchPendingDatasets(supabaseUrl, supabaseKey);
  if (datasets.length === 0) {
    console.log('No pending datasets to compact');
    return;
  }

  let index = 0;
  const worker = async () => {
    while (index < datasets.length) {
      const current = datasets[index++];
      try {
        const start = Date.now();
        await triggerCompaction(current);
        const dur = Date.now() - start;
        console.log(JSON.stringify({level:"info", event:"compact_triggered", dataset_id: current, duration_ms: dur}));
        await new Promise((r) => setTimeout(r, PER_DATASET_DELAY_MS));
      } catch (e) {
        console.error(JSON.stringify({level:"error", event:"compact_trigger_failed", dataset_id: current, error: String(e)}));
      }
    }
  };

  const runners = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(runners);
};
