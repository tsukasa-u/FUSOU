// Astro -> Hono adapter for R2 signing API
import r2Api from '../../../api/r2';

export const prerender = false;

export async function POST(context) {
  const request = new Request('http://internal/sign', {
    method: 'POST',
    body: await context.request.text(),
    headers: context.request.headers,
  });
  return r2Api.fetch(request);
}
