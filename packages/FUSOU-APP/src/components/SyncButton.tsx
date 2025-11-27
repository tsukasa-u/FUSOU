import { createSignal } from 'solid-js';
import { performSnapshotSync } from '../utility/sync';

type Props = {
  /** function that returns the snapshot payload to upload */
  getPayload?: () => Promise<any>;
  /** optional function to get a Bearer token */
  getAuthToken?: () => Promise<string | null>;
  /** optional label for the button */
  label?: string;
};

export default function SyncButton(props: Props) {
  const [status, setStatus] = createSignal<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [message, setMessage] = createSignal<string | null>(null);
  const [lastSync, setLastSync] = createSignal<string | null>(() => {
    try {
      return localStorage.getItem('fusou.lastSync');
    } catch {
      return null;
    }
  });

  async function doSync() {
    setMessage(null);
    setStatus('uploading');
    try {
      const payload = props.getPayload ? await props.getPayload() : undefined;
      const r = await performSnapshotSync(payload, props.getAuthToken);
      if (!r.ok) throw new Error(`Upload failed: ${r.status} ${r.text ?? ''}`);
      const now = new Date().toISOString();
      try {
        localStorage.setItem('fusou.lastSync', now);
      } catch {}
      setLastSync(now);
      setStatus('success');
      setMessage('Snapshot uploaded successfully.');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.message ?? String(err));
    }
  }

  return (
    <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
      <button
        disabled={status() === 'uploading'}
        onClick={doSync}
        style={{ padding: '6px 10px', 'border-radius': '6px' }}
      >
        {status() === 'uploading' ? 'Syncing…' : props.label ?? 'Sync'}
      </button>
      {lastSync() && <span style={{ color: '#6b7280' }}>Last sync: {new Date(lastSync()!).toLocaleString()}</span>}
      {message() && (
        <span style={{ color: status() === 'error' ? 'crimson' : 'green' }}>{message()}</span>
      )}
    </div>
  );
}
