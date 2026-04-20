import type { APIRoute } from "astro";
import { handleShareBattleRequest } from "@/server/routes/share-battle-page";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  return handleShareBattleRequest(request);
};
