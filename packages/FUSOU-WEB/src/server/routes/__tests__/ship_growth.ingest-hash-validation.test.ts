import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  validateJwtMock,
  verifySignedTokenMock,
  validateTokenPayloadMock,
} = vi.hoisted(() => ({
  validateJwtMock: vi.fn(),
  verifySignedTokenMock: vi.fn(),
  validateTokenPayloadMock: vi.fn(),
}));

vi.mock("../../utils", async () => {
  const actual = await vi.importActual<any>("../../utils");
  return {
    ...actual,
    validateJWT: validateJwtMock,
    verifySignedToken: verifySignedTokenMock,
    validateTokenPayload: validateTokenPayloadMock,
  };
});

vi.mock("../../utils/upload", async () => {
  const actual = await vi.importActual<any>("../../utils/upload");
  return {
    ...actual,
    enforceUploadExecutionSecurityGuards: async () => ({ ok: true }),
  };
});

import shipGrowthApp from "../ship_growth";

describe("ship_growth ingest hash validation", () => {
  beforeEach(() => {
    validateJwtMock.mockResolvedValue({ id: "test-user" });
    validateTokenPayloadMock.mockReturnValue({ valid: true });
    verifySignedTokenMock.mockReset();
  });

  it("rejects stage-2 payload when content_hash does not match", async () => {
    const ingestBody = {
      dataset_id: "a".repeat(64),
      request_id: "req-1",
      payload_hash: "b".repeat(64),
      event_type: "snapshot",
      timestamp_ms: Date.now(),
      period_tag: "2026-06-26",
      table_version: "0.5",
      ships: [
        {
          master_id: 1,
          lv: 1,
          exp_current: 0,
          exp_to_next: 100,
          kyouka: [0, 0, 0, 0, 0],
          kaihi_observed: 1,
          taisen_observed: 1,
          sakuteki_observed: 1,
          lucky_observed: 1,
          kaihi_naked: 1,
          taisen_naked: 1,
          sakuteki_naked: 1,
          lucky_naked: 1,
          kaihi_max: 100,
          taisen_max: 100,
          sakuteki_max: 100,
          slots: [],
        },
      ],
    };

    const encoded = new TextEncoder().encode(JSON.stringify(ingestBody));

    verifySignedTokenMock.mockResolvedValue({
      content_hash: "0".repeat(64),
      declared_size: encoded.byteLength,
      dataset_id: ingestBody.dataset_id,
      request_id: ingestBody.request_id,
      event_type: ingestBody.event_type,
    });

    const response = await shipGrowthApp.request(
      "http://localhost/ingest",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
          "X-Upload-Token": "upload-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ingestBody),
      },
      {
        SHIP_GROWTH_DB: {},
        SHIP_GROWTH_COLLECTION_ENABLED: "true",
        SHIP_GROWTH_SIGNING_SECRET: "test-signing-secret",
      } as any,
    );

    const body = (await response.json()) as { error?: string };
    expect(response.status).toBe(400);
    expect(body.error).toBe("Content hash mismatch - data may be corrupted");
  });
});
