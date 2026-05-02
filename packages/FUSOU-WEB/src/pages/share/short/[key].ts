import type { APIRoute } from "astro";
import { handleShareShortRequest } from "@/server/routes/share-short-page";

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  return handleShareShortRequest(request, params.key);
};
