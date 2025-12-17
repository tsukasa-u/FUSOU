import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as any;
    console.error("[Compaction DLQ] Received failed message", body);

    return new Response(
      JSON.stringify({
        success: true,
        message: "DLQ message logged",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Compaction DLQ] Error:", error);
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
