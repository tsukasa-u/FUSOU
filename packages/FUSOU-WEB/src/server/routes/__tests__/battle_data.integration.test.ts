import { describe, expect, it, vi } from "vitest";
import type { R2Bucket } from "@cloudflare/workers-types";
import { parseOcfHeader } from "../../../features/avro/ocf-header";
import { battleFixtureBytes } from "../../../features/avro/test-fixtures";

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

import battleDataApp, { attachSortieIds } from "../battle_data";

type QueryResult = { results?: Array<Record<string, unknown>> };
type D1QueryCall = { sql: string; params: unknown[] };
type D1Options = {
	calls?: D1QueryCall[];
	resultsForSql?: (sql: string) => QueryResult["results"];
};

function createD1(
	results: QueryResult["results"] = [],
	options: D1Options = {},
): D1Database {
	let preparedSql = "";
	let preparedParams: unknown[] = [];
	const statement = {
		bind: (...params: unknown[]) => {
			preparedParams = params;
			return statement;
		},
		all: async () => {
			options.calls?.push({ sql: preparedSql, params: [...preparedParams] });
			return { results: options.resultsForSql?.(preparedSql) ?? results };
		},
		first: async () => {
			options.calls?.push({ sql: preparedSql, params: [...preparedParams] });
			return results[0] ?? null;
		},
		run: async () => ({ success: true, meta: {} }),
	};
	return {
		prepare: (sql: string) => {
			preparedSql = sql;
			preparedParams = [];
			return statement;
		},
	} as unknown as D1Database;
}

function createPeriodCache(tags = ["2026-06-26"]): KVNamespace {
	return {
		get: async (key: string) =>
			key === "data_loader:period_tags:list" ? { tags } : null,
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
	it("scopes global latest to the requested period and dataset", async () => {
		const calls: D1QueryCall[] = [];
		const response = await request(
			"/global/latest?table=battle&period_tag=2026-06-26&dataset_id=dataset-a",
			{
				BATTLE_INDEX_DB: createD1(
					[
						{
							id: 1,
							table_name: "battle",
							length: 10,
							table_version: "v1",
							file_path: "battle.avro",
							start_timestamp: 0,
							record_count: 1,
						},
					],
					{ calls },
				),
			},
		);

		expect(response.status).toBe(200);
		expect(calls[0]?.sql).toContain("bi.period_tag = ?");
		expect(calls[0]?.sql).toContain("bi.dataset_id = ?");
		expect(calls[0]?.params).toEqual([
			"battle",
			"2026-06-26",
			"dataset-a",
		]);
	});

	it("scopes global chunks to the requested period and dataset", async () => {
		const calls: D1QueryCall[] = [];
		const response = await request(
			"/global/chunks?table=battle&period_tag=2026-06-26&dataset_id=dataset-a",
			{
				BATTLE_INDEX_DB: createD1(
					[
						{
							id: 1,
							table_name: "battle",
							size: 10,
							table_version: "v1",
							file_path: "battle.avro",
							start_timestamp: 0,
							end_timestamp: 1,
							record_count: 1,
						},
					],
					{ calls },
				),
			},
		);

		expect(response.status).toBe(200);
		expect(calls[0]?.sql).toContain("bi.period_tag = ?");
		expect(calls[0]?.sql).toContain("bi.dataset_id = ?");
		expect(calls[0]?.params).toEqual([
			"battle",
			"2026-06-26",
			"dataset-a",
			1000,
			0,
		]);
	});

	it("reads indexed AVRO blocks with R2 ranges", async () => {
				const avroBytes = battleFixtureBytes;
		const headerLength = parseOcfHeader(avroBytes).bodyOffset;
		const ranges: Array<{ offset: number; length: number }> = [];
		const bucket = {
			get: async (
				_key: string,
				options?: { range?: { offset: number; length: number } },
			) => {
				const range = options?.range;
				if (!range) throw new Error("expected an R2 range read");
				ranges.push(range);
				const body = avroBytes.slice(
					range.offset,
					range.offset + range.length,
				);
				return {
					arrayBuffer: async () =>
						body.buffer.slice(
							body.byteOffset,
							body.byteOffset + body.byteLength,
						),
				};
			},
		} as unknown as R2Bucket;
		const response = await request(
			"/global/records?table=battle&period_tag=2026-06-26",
			{
				BATTLE_INDEX_DB: createD1([
					{
						id: 1,
						dataset_id: "dataset",
						start_byte: headerLength,
						length: avroBytes.byteLength - headerLength,
						start_timestamp: 1783429200000,
						end_timestamp: 1783429200000,
						period_tag: "2026-06-26",
						table_version: "v1",
						window_start_ms: null,
						window_end_ms: null,
						compaction_tier: "hourly",
						file_path: "battle.avro",
					},
				]),
				BATTLE_DATA_BUCKET: bucket,
				DATA_LOADER_CACHE_KV: createPeriodCache(),
			},
		);
		const body = (await response.json()) as {
			count?: number;
			records?: Array<Record<string, unknown>>;
		};

		expect(response.status).toBe(200);
		expect(body.count).toBeGreaterThan(0);
		expect(body.records?.[0]).toMatchObject({
			env_uuid: expect.any(String),
		});
		expect(ranges).toEqual([
			{ offset: 0, length: headerLength },
			{ offset: headerLength, length: avroBytes.byteLength - headerLength },
		]);
	});

	it("prunes latest R2 blocks by dataset and resolved table version", async () => {
				const avroBytes = battleFixtureBytes;
		const headerLength = parseOcfHeader(avroBytes).bodyOffset;
		const ranges: Array<{ offset: number; length: number }> = [];
		const blockRow = {
			id: 2,
			dataset_id: "dataset-a",
			table_version: "v2",
			start_byte: headerLength,
			length: avroBytes.byteLength - headerLength,
			start_timestamp: 1783429200000,
			end_timestamp: 1783429200000,
			period_tag: "2026-06-26",
			window_start_ms: null,
			window_end_ms: null,
			compaction_tier: "hourly",
			file_path: "battle.avro",
		};
		const calls: D1QueryCall[] = [];
		const bucket = {
			get: async (
				_key: string,
				options?: { range?: { offset: number; length: number } },
			) => {
				const range = options?.range;
				if (!range) throw new Error("expected an R2 range read");
				ranges.push(range);
				const body = avroBytes.slice(range.offset, range.offset + range.length);
				return {
					arrayBuffer: async () =>
						body.buffer.slice(
							body.byteOffset,
							body.byteOffset + body.byteLength,
						),
				};
			},
		} as unknown as R2Bucket;
		const response = await request(
			"/global/records?table=battle&period_tag=latest&dataset_id=dataset-a",
			{
				BATTLE_INDEX_DB: createD1([], {
					calls,
					resultsForSql: (sql) =>
						sql.includes("SELECT DISTINCT period_tag, table_version")
							? [
									{ period_tag: "2026-06-26", table_version: "v2" },
									{ period_tag: "2026-06-26", table_version: "v1" },
								]
							: [blockRow],
				}),
				BATTLE_DATA_BUCKET: bucket,
				DATA_LOADER_CACHE_KV: createPeriodCache(["2026-06-26"]),
			},
		);

		expect(response.status).toBe(200);
		expect(ranges).toEqual([
			{ offset: 0, length: headerLength },
			{ offset: headerLength, length: avroBytes.byteLength - headerLength },
		]);
		const latestQuery = calls.find((call) =>
			call.sql.includes("SELECT DISTINCT period_tag, table_version"),
		);
		expect(latestQuery?.sql).toContain("AND dataset_id = ?");
		expect(latestQuery?.params).toEqual(["battle", "dataset-a"]);
		const blockQuery = calls.find((call) =>
			call.sql.includes("bi.table_version = ?"),
		);
		expect(blockQuery?.params).toContain("v2");
		expect(blockQuery?.params).toContain("dataset-a");
	});

	it("does not widen a missing detail battle to all periods", async () => {
		const calls: D1QueryCall[] = [];
		const response = await request(
			"/detail?env_uuid=missing&battle_index=0&period_tag=2026-06-26",
			{
				BATTLE_INDEX_DB: createD1([], { calls }),
				BATTLE_DATA_BUCKET: { get: async () => null },
				DATA_LOADER_CACHE_KV: createPeriodCache(["2026-06-26", "2026-07-08"]),
			},
		);

		expect(response.status).toBe(404);
		expect(calls.every((call) => !call.params.includes("all"))).toBe(true);
	});

	it("treats non-positive map coordinates as missing", () => {
				const records: Array<Record<string, unknown>> = [
			{
				dataset_id: "dataset",
				maparea_id: null,
				mapinfo_no: null,
				timestamp: 1,
			},
			{
				dataset_id: "dataset",
				maparea_id: 0,
				mapinfo_no: 0,
				timestamp: 2,
			},
		];

		attachSortieIds(records);

		expect(records[0]?.["__sortie_id"]).toBe(
			"dataset:unknown:1",
		);
		expect(records[1]?.["__sortie_id"]).toBe("dataset:unknown:2");
	});

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
