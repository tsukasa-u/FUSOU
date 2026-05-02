import type { APIRoute } from "astro";
import { handleShareGrowthRequest } from "@/server/routes/share-growth-page";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  return handleShareGrowthRequest(request);
};
