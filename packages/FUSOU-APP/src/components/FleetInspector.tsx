import { createSignal, createEffect, onCleanup } from 'solid-js';
import { registerSnapshotCollector } from '../utility/snapshot';

type Props = {
  token: string;
  getAuthToken?: () => Promise<string | null>;
};

function KeyValue({ k, v }: { k: string; v: any }) {
  if (v === null || v === undefined) return <div class="text-slate-400">{k}: —</div>;
  if (typeof v === 'object') return (
    <details class="my-1">
      <summary class="font-semibold cursor-pointer">{k} (expand)</summary>
      <pre class="whitespace-pre-wrap text-sm bg-slate-900 text-sky-100 p-2 rounded mt-2">{JSON.stringify(v, null, 2)}</pre>
    </details>
  );
  return <div class="my-1"><strong>{k}:</strong> <span class="ml-2">{String(v)}</span></div>;
}

export default function FleetInspector(props: Props) {
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [data, setData] = createSignal<any>(null);
  const [etag, setEtag] = createSignal<string | null>(null);

  let aborted = false;
  onCleanup(() => { aborted = true; });

  // Register a snapshot collector that returns the currently-loaded snapshot.
  const unregisterCollector = registerSnapshotCollector(async () => data());
  onCleanup(() => {
    try { unregisterCollector(); } catch {}
  });

  createEffect(() => {
    const token = props.token;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `https://sync-fleet-info.fusou.pages.dev/s/${encodeURIComponent(token)}`;
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (props.getAuthToken) {
          const t = await props.getAuthToken();
          if (t) headers['Authorization'] = `Bearer ${t}`;
        }
        const res = await fetch(url, { headers, credentials: 'include' });
        if (res.status === 304) return;
        if (res.status === 401) throw new Error('Unauthorized');
        if (res.status === 403) throw new Error('Forbidden');
        if (!res.ok) throw new Error(`Error: ${res.status}`);
        const newEtag = res.headers.get('ETag');
        if (newEtag) setEtag(newEtag);
        const json = await res.json();
        if (aborted) return;
        setData(json);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
  });

  const renderSection = (title: string, obj: any) => {
    if (!obj) return <div style={{ color: '#999' }}>No {title}</div>;
    // If object is array => table-like
      if (Array.isArray(obj)) {
      return (
        <div style="margin-top: 8px;">
          <div style="font-weight: 700; margin-bottom: 6px;">{title} (array · {obj.length})</div>
          <div style="overflow: auto; border-radius: 6px; border: 1px solid #e6eef822; padding: 8px;">
            {obj.map((item: any, idx: number) => (
              <div style="margin-bottom: 10px; padding: 8px; background: #071223; border-radius: 6px;">
                <div style="font-weight: 600; margin-bottom: 6px;">#{idx + 1}</div>
                <pre style="white-space: pre-wrap; font-size: 12px; color: #e6eef8;">{JSON.stringify(item, null, 2)}</pre>
              </div>
            ))}
          </div>
        </div>
      );
    }
    // object => list keys
    const keys = Object.keys(obj);
    return (
      <div style="margin-top: 8px;">
        <div style="font-weight: 700; margin-bottom: 6px;">{title}</div>
        <div style="display: grid; gap: 8px;">
          {keys.map(k => <KeyValue k={k} v={obj[k]} />)}
        </div>
      </div>
    );
  };

  return (
    <div class="font-sans text-sky-100 p-6">
      <div class="flex items-center gap-3 mb-3 justify-between">
        <div class="flex items-center gap-3">
          <h2 class="text-2xl font-semibold m-0">Fleet Inspector</h2>
          {etag() && <div class="text-sky-300 text-sm">ETag: {etag()}</div>}
        </div>
        <div class="flex items-center gap-2">
          <button class="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm" onClick={() => {
            const current = document.documentElement.classList.toggle('dark');
            try { localStorage.setItem('fusou-app-theme', current ? 'dark' : 'light'); } catch {}
          }} title="Toggle theme">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m8.66-11.66l-.7.7M4.04 19.96l-.7.7M21 12h-1M4 12H3m16.66 4.66l-.7-.7M4.04 4.04l-.7-.7"/></svg>
            <span class="sr-only">Toggle theme</span>
          </button>
        </div>
      </div>

      {loading() && <div>Loading snapshot…</div>}
      {error() && <div class="text-rose-300">{error()}</div>}
      {!loading() && !error() && !data() && <div class="text-slate-400">No snapshot loaded.</div>}

      {data() && (
        <div class="grid gap-6 lg:[grid-template-columns:1fr_380px]">
          <div>
            <section class="mb-3 p-4 bg-slate-800 rounded-lg">
              <div class="font-extrabold mb-2">Metadata</div>
              {Object.entries(data().meta ?? {}).length === 0 ? <div class="text-slate-400">No metadata</div> : (
                <div class="grid gap-2">
                  {Object.entries(data().meta ?? {}).map(([k, v]: any) => <KeyValue k={k} v={v} />)}
                </div>
              )}
            </section>

            <section class="p-4 bg-slate-800 rounded-lg">
              <div class="font-extrabold mb-2">Port</div>
              {renderSection('port', data().port ?? data().payload?.port ?? data().require_info?.port ? data().port ?? data().payload?.port : null)}
            </section>

            <section class="mt-3 p-4 bg-slate-800 rounded-lg">
              <div class="font-extrabold mb-2">Require Info</div>
              {renderSection('require_info', data().require_info ?? data().payload?.require_info ?? null)}
            </section>

            <details class="mt-3 p-0" open>
              <summary class="cursor-pointer mb-2 p-2 bg-slate-800 rounded-lg font-extrabold flex items-center justify-between">
                <span>Raw Snapshot</span>
                <button class="text-sm text-slate-300 px-2 py-1 rounded hover:bg-slate-700" onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard?.writeText(JSON.stringify(data(), null, 2));
                }}>Copy</button>
              </summary>
              <div class="p-3 bg-slate-900 rounded-b-lg">
                <pre class="whitespace-pre-wrap text-sm text-sky-100">{JSON.stringify(data(), null, 2)}</pre>
              </div>
            </details>
          </div>

          <aside class="p-4 bg-slate-800 rounded-lg lg:sticky lg:top-20">
            <div class="font-extrabold mb-2">Quick Info</div>
            <div class="grid gap-2">
              <div class="flex items-center justify-between">
                <div class="text-sm break-all">Token: <span class="font-mono ml-2 text-xs">{props.token}</span></div>
                <button class="text-xs px-2 py-1 bg-slate-700 rounded hover:bg-slate-600" onClick={() => navigator.clipboard?.writeText(String(props.token))}>Copy</button>
              </div>
              <div class="flex items-center justify-between"><div class="text-sm">Size:</div><div class="font-mono">{data().size ?? '—'}</div></div>
              <div class="flex items-center justify-between"><div class="text-sm">Version:</div><div class="font-mono">{data().version ?? '—'}</div></div>
              <div class="flex items-center justify-between"><div class="text-sm break-all">R2 Key: <span class="font-mono ml-2 text-xs">{data().r2_key ?? '—'}</span></div><button class="text-xs px-2 py-1 bg-slate-700 rounded hover:bg-slate-600" onClick={() => navigator.clipboard?.writeText(String(data().r2_key ?? ''))}>Copy</button></div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
