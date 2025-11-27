/**
 * performSnapshotSync: helper to POST a snapshot payload to the local edge endpoint
 * Usage: import { performSnapshotSync } from '~/utility/sync';
 */
export async function performSnapshotSync(
  payload?: any,
  getAuthToken?: () => Promise<string | null>
): Promise<{ ok: boolean; status: number; text?: string }>
{
  let body: any = payload;
  if (!body && typeof (window as any).__FUSOU_SNAPSHOT !== 'undefined') {
    body = (window as any).__FUSOU_SNAPSHOT;
  }

  if (!body) {
    throw new Error('No snapshot payload provided');
  }

  const url = '/api/fleet/snapshot';
  const headers: Record<string,string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (getAuthToken) {
    const t = await getAuthToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'include' });
  const text = await res.text().catch(() => undefined);
  if (res.ok) {
    try { localStorage.setItem('fusou.lastSync', new Date().toISOString()); } catch {}
  }
  return { ok: res.ok, status: res.status, text };
}
