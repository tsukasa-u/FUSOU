import type { APIRoute } from "astro";
import { handleShareDetailRequest } from "@/server/routes/share-detail-page";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  return handleShareDetailRequest(request);
};
