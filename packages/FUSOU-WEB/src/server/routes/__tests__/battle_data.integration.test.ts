import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { mergeAvroOCF, mergeAvroOCFWithBoundaries, decodeAvroOcfToJson } from "@fusou/compaction-core";
import battleDataApp, { attachSortieIds, extractTimestampFromUuidV7, getDynamicSnapshotPeriodTags, pruneSubsumedTierBlocks, queryGlobalRecordsDirectBatch } from "../battle_data";

type QueryResult = { results?: Array<Record<string, unknown>> };
type D1QueryCall = { sql: string; params: unknown[] };
type D1Options = {
	calls?: D1QueryCall[];
	resultsForSql?: (sql: string) => QueryResult["results"];
};

const TEST_DATASET_ID = "11111111-1111-4111-8111-111111111111";

function createD1(
	results: QueryResult["results"] = [],
	options: D1Options = {},
): D1Database {
	function createStatement(sql: string) {
		let statementParams: unknown[] = [];
		const stmt = {
			bind: (...params: unknown[]) => {
				statementParams = params;
				return stmt;
			},
			all: async () => {
				options.calls?.push({ sql, params: [...statementParams] });
				return { results: options.resultsForSql?.(sql) ?? results };
			},
			first: async () => {
				options.calls?.push({ sql, params: [...statementParams] });
				return results[0] ?? null;
			},
			run: async () => ({ success: true, meta: {} }),
		};
		return stmt;
	}
	return {
		prepare: (sql: string) => createStatement(sql),
		batch: async (statements: Array<{ all: () => Promise<QueryResult> }>) => {
			return Promise.all(statements.map((s) => s.all()));
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
			`/global/latest?table=battle&period_tag=2026-06-26&dataset_id=${TEST_DATASET_ID}`,
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
				TEST_DATASET_ID,
		]);
	});

	describe("battle snapshot audit regressions", () => {
		beforeEach(() => vi.stubGlobal("caches", undefined));
		afterEach(() => vi.unstubAllGlobals());

		it("isolates single-battle KV entries by period and canonical numeric index", async () => {
			const values = new Map<string, string>();
			const kv = {
				get: async (key: string) => values.get(key) ?? null,
				put: async (key: string, value: string) => { values.set(key, value); },
			};
			const get = vi.fn(async (key: string) => {
				const match = key.match(/^snapshots\/detail\/([^/]+)\/same-sortie_2\.json$/);
				return match
					? { arrayBuffer: async () => Buffer.from(JSON.stringify({
						success: true, period_tag: match[1],
						battle: { index: 2, timestamp: 1792000000000 },
						derived: { friendly_fleet: [{ shipId: 1 }] },
					})) }
					: null;
			});
			const bucket = {
				list: async () => ({ objects: [
					{ key: "snapshots/overview/2026-10-14.json.br" },
					{ key: "snapshots/overview/2026-08-05.json.br" },
				] }),
				get,
			};
			for (const period of ["2026-10-14", "2026-08-05"]) {
				const response = await request(`/detail?env_uuid=same-sortie&battle_index=02&period_tag=${period}`, {
					BATTLE_DATA_BUCKET: bucket, DATA_LOADER_CACHE_KV: kv,
				});
				expect(response.status).toBe(200);
				expect(await response.json()).toMatchObject({ period_tag: period });
			}
			expect(values.has("v9:battle_detail:2026-10-14:same-sortie:2")).toBe(true);
			expect(values.has("v9:battle_detail:2026-08-05:same-sortie:2")).toBe(true);
			const count = get.mock.calls.length;
			const cached = await request("/detail?env_uuid=same-sortie&battle_index=2&period_tag=2026-08-05", {
				BATTLE_DATA_BUCKET: bucket, DATA_LOADER_CACHE_KV: kv,
			});
			expect(cached.status).toBe(200);
			expect(get).toHaveBeenCalledTimes(count);
		});

		it.each(["overview", "drops"])("serves plain %s objects identically in individual and all-period modes", async (kind) => {
			const bucket = {
				list: async () => ({ objects: [{ key: "snapshots/overview/2026-10-14.json" }] }),
				get: async (key: string) => key === `snapshots/${kind}/2026-10-14.json`
					? { arrayBuffer: async () => Buffer.from(JSON.stringify({
						battles: [{ env_uuid: "one", index: 0 }], cells: [], mst_ships: [],
					})) } : null,
			};
			for (const period of ["2026-10-14", "all"]) {
				const response = await request(`/global/${kind}?period_tag=${period}`, { BATTLE_DATA_BUCKET: bucket });
				expect(response.status).toBe(200);
				expect(await response.json()).toMatchObject({ battles: [{ env_uuid: "one" }] });
			}
		});

		it("paginates discovery instead of silently omitting later periods", async () => {
			const list = vi.fn()
				.mockResolvedValueOnce({ objects: [{ key: "snapshots/overview/2026-08-05.json" }], truncated: true, cursor: "next" })
				.mockResolvedValueOnce({ objects: [{ key: "snapshots/overview/2026-10-14.json.br" }], truncated: false });
			const bucket = { list };
			expect(await getDynamicSnapshotPeriodTags(bucket, undefined)).toEqual(["2026-10-14", "2026-08-05"]);
			expect(list.mock.calls[1]![0]).toMatchObject({ cursor: "next" });
		});

		it("does not return successful empty aggregates after a required snapshot is missing", async () => {
			vi.spyOn(console, "error").mockImplementation(() => undefined);
			const response = await request("/global/overview?period_tag=all", {
				BATTLE_DATA_BUCKET: {
					list: async () => ({ objects: [{ key: "snapshots/overview/2026-10-14.json.br" }] }),
					get: async () => null,
				},
			});
			expect(response.status).toBeGreaterThanOrEqual(500);
		});
	});

	it("scopes global chunks to the requested period and dataset", async () => {
		const calls: D1QueryCall[] = [];
		const response = await request(
			`/global/chunks?table=battle&period_tag=2026-06-26&dataset_id=${TEST_DATASET_ID}`,
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
				TEST_DATASET_ID,
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
						dataset_id: TEST_DATASET_ID,
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
			{ offset: 0, length: avroBytes.byteLength },
		]);
	});

	it("reads legacy dataset IDs from indexed battle blocks", async () => {
		const avroBytes = battleFixtureBytes;
		const headerLength = parseOcfHeader(avroBytes).bodyOffset;
		const bucket = {
			get: async (
				_key: string,
				options?: { range?: { offset: number; length: number } },
			) => {
				const range = options?.range;
				if (!range) throw new Error("expected an R2 range read");
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
			"/global/records?table=battle&period_tag=2026-06-26",
			{
				BATTLE_INDEX_DB: createD1([
					{
						id: 1,
						dataset_id: "legacy-member-hash",
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

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			success: true,
		});
	});

	it("prunes latest R2 blocks by dataset and resolved table version", async () => {
				const avroBytes = battleFixtureBytes;
		const headerLength = parseOcfHeader(avroBytes).bodyOffset;
		const ranges: Array<{ offset: number; length: number }> = [];
		const blockRow = {
			id: 2,
			dataset_id: TEST_DATASET_ID,
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
			`/global/records?table=battle&period_tag=latest&dataset_id=${TEST_DATASET_ID}`,
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
			{ offset: 0, length: avroBytes.byteLength },
		]);
		const latestQuery = calls.find((call) =>
			call.sql.includes("SELECT DISTINCT period_tag, table_version"),
		);
		expect(latestQuery?.sql).toContain("AND dataset_id = ?");
			expect(latestQuery?.params).toEqual(["battle", TEST_DATASET_ID]);
		const blockQuery = calls.find((call) =>
			call.sql.includes("bi.table_version = ?"),
		);
		expect(blockQuery?.params).toContain("v2");
			expect(blockQuery?.params).toContain(TEST_DATASET_ID);
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

	it("coalesces contiguous R2 block ranges for the same file and injects dataset_id", async () => {
		const merged = mergeAvroOCFWithBoundaries([
			battleFixtureBytes,
			battleFixtureBytes,
		]);
		const ranges: Array<{ offset: number; length: number }> = [];
		const bucket = {
			get: async (
				_key: string,
				options?: { range?: { offset: number; length: number } },
			) => {
				const range = options?.range;
				if (!range) throw new Error("expected an R2 range read");
				ranges.push(range);
				const body = merged.merged.slice(
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

		const calls: D1QueryCall[] = [];
		const b0 = merged.boundaries[0]!;
		const b1 = merged.boundaries[1]!;
		const response = await request(
			"/global/records?table=battle&period_tag=2026-06-26",
			{
				BATTLE_INDEX_DB: createD1(
					[
						{
							id: 10,
							dataset_id: "user-dataset-alpha",
							start_byte: b0.startByte,
							length: b0.length,
							start_timestamp: 1783429200000,
							end_timestamp: 1783429200000,
							period_tag: "2026-06-26",
							table_version: "v1",
							window_start_ms: null,
							window_end_ms: null,
							compaction_tier: "daily",
							file_path: "compacted-battle.avro",
						},
						{
							id: 11,
							dataset_id: "user-dataset-beta",
							start_byte: b1.startByte,
							length: b1.length,
							start_timestamp: 1783429100000,
							end_timestamp: 1783429100000,
							period_tag: "2026-06-26",
							table_version: "v1",
							window_start_ms: null,
							window_end_ms: null,
							compaction_tier: "daily",
							file_path: "compacted-battle.avro",
						},
					],
					{ calls },
				),
				BATTLE_DATA_BUCKET: bucket,
				DATA_LOADER_CACHE_KV: createPeriodCache(),
			},
		);

		const body = (await response.json()) as {
			count?: number;
			records?: Array<Record<string, unknown>>;
		};
		expect(response.status).toBe(200);
		expect(body.count).toBe(4);
		expect(body.records?.[0]?.["dataset_id"]).toBe("user-dataset-alpha");
		expect(body.records?.[1]?.["dataset_id"]).toBe("user-dataset-alpha");
		expect(body.records?.[2]?.["dataset_id"]).toBe("user-dataset-beta");
		expect(body.records?.[3]?.["dataset_id"]).toBe("user-dataset-beta");
		// Single-RTT coalesced header + contiguous block range read (1 R2 request instead of 3)
		expect(ranges).toEqual([
			{ offset: 0, length: b0.startByte + b0.length + b1.length },
		]);
		// Only 1 block query to D1 (plus 1 table_version metadata query) instead of 4 sequential tier queries
		const blockQueries = calls.filter((c) =>
			c.sql.includes("FROM block_indexes bi"),
		);
		expect(blockQueries).toHaveLength(1);
	});

	it("extracts epoch ms timestamp from UUIDv7 env_uuid", () => {
		// 0x01982a3b4c5d = 1753055186013 ms
		const uuidV7 = "01982a3b-4c5d-7000-8000-000000000001";
		expect(extractTimestampFromUuidV7(uuidV7)).toBe(0x01982a3b4c5d);
		expect(extractTimestampFromUuidV7("11111111-1111-4111-8111-111111111111")).toBeNull();
		expect(extractTimestampFromUuidV7("not-a-uuid")).toBeNull();
	});

	it("serves detail from env_detail bundled snapshot even with period_tag=all", async () => {
		const targetEnvUuid = "01a07619-84b8-7003-96a5-fbdccfa41494";
		const bundlePayload = {
			success: true,
			period_tag: "2026-08-05",
			table_version: "0.6.0",
			battles: {
				"2": {
					success: true,
					period_tag: "2026-08-05",
					table_version: "0.6.0",
					battle: { index: 2, timestamp: 1788687779000 },
					refs: {
						mst_ship: [{ id: 541, name: "夕張改二特" }],
						mst_slotitem: [{ id: 40, name: "12.7cm連装砲B型改二" }],
					},
					derived: {
						friendly_fleet: [{ shipId: 541, name: "夕張改二特" }],
						enemy_fleet: [{ shipId: 1505, name: "軽巡ホ級" }],
					},
				},
			},
		};

		const bucket = {
			list: async () => ({
				objects: [{ key: "snapshots/overview/2026-08-05.json.br" }],
			}),
			get: async (key: string) => {
				if (key === "snapshots/env_detail/2026-08-05/" + targetEnvUuid + ".json.br") {
					const jsonStr = JSON.stringify(bundlePayload);
					return {
						arrayBuffer: async () => Buffer.from(jsonStr, "utf-8"),
						httpEtag: "test-etag",
					};
				}
				return null;
			},
		};

		const d1 = {
			prepare: (sql: string) => ({
				bind: (...args: unknown[]) => ({
					first: async () => {
						if (sql.includes("start_timestamp <= ?")) {
							return { period_tag: "2026-08-05" };
						}
						return { period_tag: "2026-10-14" };
					},
				}),
			}),
		};

		const res = await request(
			"/detail?env_uuid=" + targetEnvUuid + "&battle_index=2&period_tag=all",
			{
				BATTLE_DATA_BUCKET: bucket,
				BATTLE_INDEX_DB: d1,
			},
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("X-FUSOU-Cache")).toBe("SNAPSHOT-HIT");
		const data = (await res.json()) as any;
		expect(data.refs?.mst_ship?.[0]?.name).toBe("夕張改二特");
		expect(data.derived?.friendly_fleet?.[0]?.name).toBe("夕張改二特");
	});

	it("serves detail from env_detail raw-tables snapshot format (FUSOU-WORKFLOW schema)", async () => {
		const targetEnvUuid = "01a1729e-b4b0-7001-9706-4d24bf9b25cc";
		const workflowSnapshotPayload = {
			env_uuid: targetEnvUuid,
			period_tag: "2026-10-14",
			table_version: "0.6.0",
			timestamp: 1792454400000,
			tables: {
				battle: [{ index: 0, env_uuid: targetEnvUuid, timestamp: 1792454400000 }],
				cells: [{ env_uuid: targetEnvUuid, maparea_id: 1, mapinfo_no: 2 }],
				battle_result: [{ env_uuid: targetEnvUuid, drop_ship_id: 541 }],
				own_ship: [{ env_uuid: targetEnvUuid, ship_id: 541, name: "夕張改二特" }],
				own_slotitem: [{ env_uuid: targetEnvUuid, mst_slotitem_id: 40 }],
			},
		};

		const bucket = {
			list: async () => ({
				objects: [
					{ key: "snapshots/overview/2026-10-14.json.br" },
					{ key: "snapshots/overview/2026-08-05.json.br" },
				],
			}),
			get: async (key: string) => {
				if (key === "snapshots/env_detail/2026-10-14/" + targetEnvUuid + ".json.br") {
					const jsonStr = JSON.stringify(workflowSnapshotPayload);
					return {
						arrayBuffer: async () => Buffer.from(jsonStr, "utf-8"),
						httpEtag: "test-etag",
					};
				}
				if (key.includes("mst_ship")) {
					return {
						arrayBuffer: async () => Buffer.from(JSON.stringify([{ id: 541, name: "夕張改二特" }])),
					};
				}
				if (key.includes("mst_slotitem")) {
					return {
						arrayBuffer: async () => Buffer.from(JSON.stringify([{ id: 40, name: "12.7cm連装砲B型改二" }])),
					};
				}
				return null;
			},
		};

		const d1 = {
			prepare: (sql: string) => ({
				bind: (...args: unknown[]) => ({
					first: async () => {
						return { period_tag: "2026-10-14" };
					},
					all: async () => ({
						results: [{ period_tag: "2026-10-14", table_version: "0.6.0" }],
					}),
				}),
			}),
		};

		const res = await request(
			"/detail?env_uuid=" + targetEnvUuid + "&battle_index=0&period_tag=latest",
			{
				BATTLE_DATA_BUCKET: bucket,
				BATTLE_INDEX_DB: d1,
				MASTER_DATA_INDEX_DB: d1,
				MASTER_DATA_BUCKET: bucket,
			},
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("X-FUSOU-Cache")).toBe("SNAPSHOT-HIT");
		const data = (await res.json()) as any;
		expect(data.battle?.index).toBe(0);
		expect(data.period_tag).toBe("2026-10-14");
	});

	it("consolidates multiple null-codec OCF blocks into a single block during mergeAvroOCF", () => {
		const reblocked = mergeAvroOCF([battleFixtureBytes, battleFixtureBytes]);
		const unReblocked = mergeAvroOCF(
			[battleFixtureBytes, battleFixtureBytes],
			{ reblock: false },
		);
		// Reblocked OCF strips intermediate 16-byte sync marker + block count/size varints
		expect(reblocked.byteLength).toBeLessThan(unReblocked.byteLength);
		const decoded = decodeAvroOcfToJson(reblocked);
		expect(decoded).toHaveLength(4);
	});

	it("prunes lower-tier blocks already subsumed by higher-tier compacted blocks", async () => {
		const avroBytes = battleFixtureBytes;
		const headerLength = parseOcfHeader(avroBytes).bodyOffset;
		const requestedKeys: string[] = [];
		const bucket = {
			get: async (
				key: string,
				options?: { range?: { offset: number; length: number } },
			) => {
				const range = options?.range;
				if (!range) throw new Error("expected an R2 range read");
				requestedKeys.push(key);
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

		const rows = [
			{
				id: 100,
				dataset_id: TEST_DATASET_ID,
				start_byte: headerLength,
				length: avroBytes.byteLength - headerLength,
				start_timestamp: 1783400000000,
				end_timestamp: 1783450000000,
				period_tag: "2026-06-26",
				table_version: "v1",
				window_start_ms: null,
				window_end_ms: null,
				compaction_tier: "weekly",
				file_path: "compacted/weekly/battle.avro",
			},
			{
				id: 90,
				dataset_id: TEST_DATASET_ID,
				start_byte: headerLength,
				length: avroBytes.byteLength - headerLength,
				start_timestamp: 1783410000000,
				end_timestamp: 1783440000000,
				period_tag: "2026-06-26",
				table_version: "v1",
				window_start_ms: null,
				window_end_ms: null,
				compaction_tier: "daily",
				file_path: "compacted/daily/battle.avro",
			},
			{
				id: 80,
				dataset_id: TEST_DATASET_ID,
				start_byte: headerLength,
				length: avroBytes.byteLength - headerLength,
				start_timestamp: 1783420000000,
				end_timestamp: 1783425000000,
				period_tag: "2026-06-26",
				table_version: "v1",
				window_start_ms: null,
				window_end_ms: null,
				compaction_tier: "hourly",
				file_path: "compacted/hourly/battle.avro",
			},
		];

		expect(pruneSubsumedTierBlocks(rows).rows).toHaveLength(1);
		expect(pruneSubsumedTierBlocks(rows).rows[0]?.file_path).toBe(
			"compacted/weekly/battle.avro",
		);

		const response = await request(
			"/global/records?table=battle&period_tag=2026-06-26",
			{
				BATTLE_INDEX_DB: createD1(rows),
				BATTLE_DATA_BUCKET: bucket,
				DATA_LOADER_CACHE_KV: createPeriodCache(),
			},
		);
		const body = (await response.json()) as {
			count?: number;
			records?: Array<Record<string, unknown>>;
		};

		expect(response.status).toBe(200);
		expect(requestedKeys).toEqual(["compacted/weekly/battle.avro"]);
		expect(body.count).toBe(2);
	});

	it("executes multi-table queries using D1 batch API", async () => {
		let batchCalledCount = 0;
		const baseD1 = createD1([]);
		const batchD1 = {
			...baseD1,
			batch: async (statements: Array<{ all: () => Promise<QueryResult> }>) => {
				batchCalledCount++;
				return Promise.all(statements.map((s) => s.all()));
			},
		} as unknown as D1Database;

		const mockContext = {
			env: {
				BATTLE_INDEX_DB: batchD1,
				BATTLE_DATA_BUCKET: { get: async () => null } as unknown as R2Bucket,
				DATA_LOADER_CACHE_KV: createPeriodCache(),
			},
			req: { url: "http://localhost/api/battle-data" },
		} as any;

		const results = await queryGlobalRecordsDirectBatch(mockContext, [
			{ table: "cells", periodTag: "2026-06-26", tableVersion: "v1", limitBlocks: 10, limitRecords: 100 },
			{ table: "battle_result", periodTag: "2026-06-26", tableVersion: "v1", limitBlocks: 10, limitRecords: 100 },
		]);

		expect(results).toHaveLength(2);
		expect(batchCalledCount).toBe(1);
	});

	it("aggregates overview snapshots across all periods when period_tag=all", async () => {
		const snap1 = {
			battles: [{ env_uuid: "e1", index: 0, uuid: "b1", maparea_id: 1, mapinfo_no: 1 }],
			cells: [{ env_uuid: "e1", uuid: "c1", maparea_id: 1, mapinfo_no: 1 }],
			enemy_decks: [{ env_uuid: "e1", uuid: "d1" }],
			enemy_ships: [{ env_uuid: "e1", uuid: "s1", index: 0 }],
		};
		const snap2 = {
			battles: [{ env_uuid: "e2", index: 0, uuid: "b2", maparea_id: 62, mapinfo_no: 1 }],
			cells: [{ env_uuid: "e2", uuid: "c2", maparea_id: 62, mapinfo_no: 1 }],
			enemy_decks: [{ env_uuid: "e2", uuid: "d2" }],
			enemy_ships: [{ env_uuid: "e2", uuid: "s2", index: 0 }],
		};

		const zlib = await import("node:zlib");
		const { promisify } = await import("node:util");
		const compress = promisify(zlib.brotliCompress);
		const snap1Buf = await compress(Buffer.from(JSON.stringify(snap1)));
		const snap2Buf = await compress(Buffer.from(JSON.stringify(snap2)));

		const bucket = {
			list: async () => ({
				objects: [
					{ key: "snapshots/overview/2026-10-14.json.br" },
					{ key: "snapshots/overview/2026-08-05.json.br" },
				],
			}),
			get: async (key: string) => {
				if (key.includes("2026-10-14")) {
					return { arrayBuffer: async () => snap1Buf, httpEtag: "etag1" };
				}
				if (key.includes("2026-08-05")) {
					return { arrayBuffer: async () => snap2Buf, httpEtag: "etag2" };
				}
				return null;
			},
		} as unknown as R2Bucket;

		const response = await request("/global/overview?period_tag=all", {
			env: { BATTLE_DATA_BUCKET: bucket },
		});
		const body = (await response.json()) as {
			success: boolean;
			period_tag: string;
			battles: Array<{ uuid: string; maparea_id: number; mapinfo_no: number }>;
		};

		expect(response.status).toBe(200);
		expect(response.headers.get("X-FUSOU-Cache")).toBe("SNAPSHOT-AGGREGATED");
		expect(body.success).toBe(true);
		expect(body.period_tag).toBe("all");
		expect(body.battles).toHaveLength(2);
		expect(body.battles.map((b) => `${b.maparea_id}-${b.mapinfo_no}`)).toEqual(["1-1", "62-1"]);
	});
});
