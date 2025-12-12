// Astro -> Hono adapter for compaction API
import compactApi from '../../../api/compact';

export const prerender = false;

export async function POST(context) {
  const request = new Request('http://internal/compact', {
    method: 'POST',
    body: await context.request.text(),
    headers: context.request.headers,
  });
  return compactApi.fetch(request);
}

export async function GET(context) {
  const request = new Request('http://internal/compact/status');
  return compactApi.fetch(request);
}
