// Astro -> Hono adapter for compact trigger API
import compactApi from '../../../../api/compact';

export const prerender = false;

export async function GET(context) {
  const dataset_id = context.url.searchParams.get('dataset_id');
  const query = dataset_id ? `?dataset_id=${encodeURIComponent(dataset_id)}` : '';
  const request = new Request(`http://internal/compact/trigger${query}`);
  return compactApi.fetch(request);
}
