import { describe, expect, it, vi } from "vitest";

vi.mock("@fusou/avro-wasm", () => ({
	initWasm: async () => undefined,
	validateAvroOCF: async () => ({ valid: true }),
	validateAvroOCFSmart: async () => ({ valid: true }),
	validateAvroOCFByTable: async () => ({ valid: true }),
	matchClientSchema: async () => ({ matched: true }),
	validate_avro_ocf: async () => ({ valid: true }),
	validate_avro_ocf_smart: async () => ({ valid: true }),
	validate_avro_ocf_by_table: async () => ({ valid: true }),
	match_client_schema: async () => ({ matched: true }),
	get_available_schemas: () => [],
	get_available_versions: () => [],
	get_schema_json: () => null,
}));

import battleDataApp from "../battle_data";

describe("battle_data route integration", () => {
	it("GET /health should return service status", async () => {
		const response = await battleDataApp.request("http://localhost/health");
		const body = (await response.json()) as { status?: string; service?: string };

		expect(response.status).toBe(200);
		expect(body.status).toBe("ok");
		expect(body.service).toBe("battle_data");
	});

	it("POST /upload should fail closed when required bindings are missing", async () => {
		const response = await battleDataApp.request(
			"http://localhost/upload",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			},
			{
				BATTLE_DATA_BUCKET: undefined,
				BATTLE_DATA_SIGNING_SECRET: undefined,
			} as any,
		);

		const body = (await response.json()) as { error?: string };
		expect(response.status).toBe(500);
		expect(body.error).toContain("missing R2 bucket or signing secret");
	});

	it("GET /global/chunks should require table query parameter", async () => {
		const response = await battleDataApp.request(
			"http://localhost/global/chunks",
			{
				method: "GET",
			},
			{
				BATTLE_INDEX_DB: {},
			} as any,
		);

		const body = (await response.json()) as { error?: string };
		expect(response.status).toBe(400);
		expect(body.error).toBe("table is required");
	});

	it("GET /global/summary should reject unsupported tables", async () => {
		const response = await battleDataApp.request(
			"http://localhost/global/summary?table=unknown_table",
			{
				method: "GET",
			},
			{
				BATTLE_INDEX_DB: {},
			} as any,
		);

		const body = (await response.json()) as { error?: string; message?: string };
		expect(response.status).toBe(400);
		expect(body.error).toBe("INVALID_TABLE");
		expect(body.message).toContain("table must be one of");
	});
});
