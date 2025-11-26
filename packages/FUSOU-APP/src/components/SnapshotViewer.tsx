import { createSignal, createEffect, onCleanup } from 'solid-js';

type Props = {
  token: string;
  /** Optional function that returns a Promise resolving to a Bearer token (JWT) */
  getAuthToken?: () => Promise<string | null>;
};

export default function SnapshotViewer(props: Props) {
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [data, setData] = createSignal<any>(null);
  const [etag, setEtag] = createSignal<string | null>(null);

  let aborted = false;
  onCleanup(() => {
    aborted = true;
  });

  createEffect(() => {
    const token = props.token;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/s/${encodeURIComponent(token)}`;
        const headers: Record<string, string> = { Accept: 'application/json' };
        const currentEtag = etag();
        if (currentEtag) headers['If-None-Match'] = currentEtag;
        if (props.getAuthToken) {
          const t = await props.getAuthToken();
          if (t) headers['Authorization'] = `Bearer ${t}`;
        }

        const res = await fetch(url, { headers, credentials: 'include' });
        if (res.status === 304) {
          // Not modified
          setLoading(false);
          return;
        }
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

  return (
    <div>
      {loading() && <div>Loading snapshot…</div>}
      {error() && <div style={{ color: 'red' }}>{error()}</div>}
      {!loading() && !error() && !data() && <div>No snapshot loaded.</div>}
      {!loading() && data() && (
        <div>
          <h3>Snapshot</h3>
          <div>ETag: {etag()}</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(data(), null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
