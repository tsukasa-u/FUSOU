import { createSignal } from 'solid-js';
import SnapshotViewer from '../components/SnapshotViewer';

function getTokenFromPath() {
  try {
    const p = window.location.pathname || '';
    const m = p.match(/\/viewer\/(.+)$/);
    if (m) return decodeURIComponent(m[1]);
    const qp = new URLSearchParams(window.location.search);
    return qp.get('token') || '';
  } catch (e) {
    return '';
  }
}

export default function ViewerPage() {
  const token = getTokenFromPath();

  // Optional: supply a function to get auth token from your auth layer (supabase-js, etc.)
  const getAuthToken = async () => {
    // Example: if you use supabase-js in the app, return session.access_token
    // For now return null (public) — the user should implement this according to app auth.
    return null;
  };

  return (
    <main style={{ padding: 16 }}>
      <h2>Snapshot Viewer</h2>
      {!token ? (
        <div>Please provide token in path: /viewer/&lt;token&gt; or ?token=&lt;token&gt;</div>
      ) : (
        <SnapshotViewer token={token} getAuthToken={getAuthToken} />
      )}
    </main>
  );
}
