// FUSOU-WEB/src/pages/api/debug-d1.ts
import type { APIRoute } from "astro";
import type { D1Database, D1Result } from "./asset-sync/types";

interface CloudflareEnv {
  ASSET_INDEX_DB?: D1Database;
}

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env as CloudflareEnv | undefined;
  const db = env?.ASSET_INDEX_DB;

  if (!db) {
    return new Response(
      JSON.stringify({ error: "D1 database (ASSET_INDEX_DB) is not bound." }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  try {
    // 最もシンプルなクエリを実行して、テーブルの存在を確認する
    const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files'");
    const result: D1Result | undefined = await stmt.first?.();

    if (!result) {
       return new Response(
        JSON.stringify({ status: "ok", message: "Successfully connected to D1, but 'files' table does not exist." }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    }
    
    return new Response(
      JSON.stringify({ status: "ok", message: "Successfully connected to D1 and 'files' table exists.", table_info: result }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  } catch (e: any) {
    console.error("D1 connection test failed", e);
    return new Response(
      JSON.stringify({ error: "Failed to execute query on D1.", details: e.message, cause: e.cause?.toString() }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};
