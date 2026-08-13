import { describe, expect, it, vi } from "vitest";

vi.mock("@fusou/avro-wasm", () => ({
	initWasm: vi.fn(),
	validateAvroOCF: vi.fn(),
	validateAvroOCFSmart: vi.fn(),
	validateAvroOCFByTable: vi.fn(),
	matchClientSchema: vi.fn(),
	validate_avro_ocf: vi.fn(),
	validate_avro_ocf_smart: vi.fn(),
	validate_avro_ocf_by_table: vi.fn(),
	match_client_schema: vi.fn(),
	get_available_schemas: vi.fn(),
	get_available_versions: vi.fn(),
	get_schema_json: vi.fn(),
}));

import battleDataApp from "../battle_data";

type QueryResult = { results?: Array<Record<string, unknown>> };

function createD1(results: QueryResult["results"] = []): D1Database {
	const statement = {
		bind: () => statement,
		all: async () => ({ results }),
		first: async () => results[0] ?? null,
		run: async () => ({ success: true, meta: {} }),
	};
	return {
		prepare: () => statement,
	} as unknown as D1Database;
}

function createPeriodCache(tags = ["2026-06-26"]): KVNamespace {
	return {
		get: async () => ({ tags }),
	} as unknown as KVNamespace;
}

function request(path: string, env: Record<string, unknown> = {}) {
	return battleDataApp.fetch(
		new Request(`https://example.com${path}`),
		env,
	);
}

function installCacheHit(payload: unknown) {
	const cache = {
		match: async () =>
			new Response(JSON.stringify(payload), {
				headers: { "Content-Type": "application/json" },
			}),
		put: async () => undefined,
		delete: async () => true,
	};
	(globalThis as { caches?: unknown }).caches = { default: cache };
}

describe("battle-data route integration", () => {
	it("returns the available period summary with cache headers", async () => {
		const response = await request("/global/summary", {
			BATTLE_INDEX_DB: createD1([
				{ period_tag: "2026-06-26", table_version: "v1" },
			]),
			DATA_LOADER_CACHE_KV: createPeriodCache(),
		});
		const body = (await response.json()) as {
			ok?: boolean;
			periods?: Array<{ period_tag: string; table_version: string }>;
		};

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("max-age=300");
		expect(body).toMatchObject({
			ok: true,
			periods: [{ period_tag: "2026-06-26", table_version: "v1" }],
		});
	});

	it("rejects an unknown summary table before querying data", async () => {
		const response = await request("/global/summary?table=not_a_table", {
			BATTLE_INDEX_DB: createD1(),
		});
		const body = (await response.json()) as { error?: string };

		expect(response.status).toBe(400);
		expect(body.error).toBe("INVALID_TABLE");
	});

	it("maps malformed records filters to a client error", async () => {
		const response = await request(
			"/global/records?table=battle&filter_json=%7Bbroken",
			{
				BATTLE_INDEX_DB: createD1(),
				BATTLE_DATA_BUCKET: {},
			},
		);
		const body = (await response.json()) as { error?: string };

		expect(response.status).toBe(400);
		expect(body.error).toBe("INVALID_FILTER");
	});

	it("returns a server error when overview storage is unavailable", async () => {
		const response = await request("/global/overview?period_tag=latest");
		const body = (await response.json()) as { error?: string };

		expect(response.status).toBe(500);
		expect(body.error).toBe("Failed to build overview payload");
	});

	it("returns a server error when drops storage is unavailable", async () => {
		const response = await request("/global/drops?period_tag=latest");
		const body = (await response.json()) as { error?: string };

		expect(response.status).toBe(500);
		expect(body.error).toBe("Failed to build drops payload");
	});

	it("serves cached overview, drops, and detail payloads without storage access", async () => {
		installCacheHit({ success: true, cached: true });
		const env = {};

		for (const path of [
			"/global/overview?period_tag=latest",
			"/global/drops?period_tag=latest",
			"/detail?env_uuid=fixture&battle_index=0&period_tag=latest",
		]) {
			const response = await request(path, env);
			expect(response.status).toBe(200);
			expect(response.headers.get("x-fusou-cache")).toBe("HIT");
			await expect(response.json()).resolves.toMatchObject({
				success: true,
				cached: true,
			});
		}

		delete (globalThis as { caches?: unknown }).caches;
	});

	it("validates detail identity before accessing storage", async () => {
		const missingUuid = await request("/detail?battle_index=0");
		expect(missingUuid.status).toBe(400);
		await expect(missingUuid.json()).resolves.toMatchObject({
			error: "env_uuid is required",
		});

		const missingIndex = await request("/detail?env_uuid=fixture");
		expect(missingIndex.status).toBe(400);
		await expect(missingIndex.json()).resolves.toMatchObject({
			error: "battle_index is required",
		});
	});
});
