import type { APIRoute } from "astro";
import { runCompactionJob } from "../../server/compaction/job";
import type { Bindings } from "../../server/types";

interface CompactionMessage {
  datasetId: string;
  table?: string;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as CompactionMessage;
    const env = (request as any).context?.cloudflare?.env as Bindings;

    if (!env) {
      return new Response(JSON.stringify({ error: "Missing env bindings" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { datasetId, table } = body;

    if (!datasetId) {
      return new Response(
        JSON.stringify({ error: "Missing datasetId" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const result = await runCompactionJob(env, datasetId, table);

    return new Response(
      JSON.stringify({
        success: true,
        datasetId,
        table,
        result,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Compaction Queue] Error:", error);
    return new Response(
      JSON.stringify({
        error: String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
