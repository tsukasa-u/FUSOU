import { createSignal } from 'solid-js';
import FleetInspector from '../components/FleetInspector';
import { getAuthToken } from '../utility/auth';

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
  // use centralized auth helper
     // const getAuthTokenLocal = getAuthToken; // Removed unused local alias

  return (
    <main style={{ padding: '16px' }}>
      <h2>Snapshot Viewer</h2>
      {!token ? (
        <div>Please provide token in path: /viewer/&lt;token&gt; or ?token=&lt;token&gt;</div>
      ) : (
        <FleetInspector token={token} getAuthToken={getAuthToken} />
      )}
    </main>
  );
}
