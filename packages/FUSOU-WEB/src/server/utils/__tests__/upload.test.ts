import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils", () => ({
  createEnvContext: vi.fn(() => ({ runtime: {} })),
  generateSignedToken: vi.fn(async () => "signed-upload-token"),
  getEnv: vi.fn(() => "dataset-token-secret"),
  resolveDatasetToken: vi.fn(
    (headerToken: string | null, bodyToken: unknown) =>
      headerToken || (typeof bodyToken === "string" ? bodyToken : ""),
  ),
  resolveDatasetTokenRevocationConfig: vi.fn(() => ({})),
  validateDatasetTokenSecret: vi.fn(() => ({ ok: true })),
  validateDatasetTokenWithConstraints: vi.fn(async () => ({
    ok: true,
    token: {
      dataset_id: "11111111-1111-4111-8111-111111111111",
      user_id: "canonical-user",
      device_id: "22222222-2222-4222-8222-222222222222",
    },
  })),
  validateJWT: vi.fn(async () => null),
  verifySignedToken: vi.fn(async () => ({
    content_hash: "committed-hash",
    user_id: "canonical-user",
  })),
}));

import { handleTwoStageUpload, readBodyWithinLimit } from "../upload";

function createContext(request: Request) {
  return {
    req: { raw: request, url: request.url },
    json(body: unknown, status = 200) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  } as never;
}

describe("readBodyWithinLimit", () => {
  it("rejects an oversized chunked body without Content-Length", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(4));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);

    await expect(readBodyWithinLimit(request, 4)).resolves.toEqual({
      kind: "too_large",
    });
  });

  it("accepts a body at the configured limit", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: new Uint8Array([1, 2, 3, 4]),
    });

    await expect(readBodyWithinLimit(request, 4)).resolves.toEqual({
      kind: "ok",
      data: new Uint8Array([1, 2, 3, 4]),
    });
  });
});

describe("handleTwoStageUpload dataset-token authentication", () => {
  it("accepts preparation without a Supabase JWT when a dataset token is required", async () => {
    const request = new Request("https://example.test/upload", {
      method: "POST",
      headers: { "X-Dataset-Token": "dataset-token" },
      body: JSON.stringify({ key: "asset.png" }),
    });
    const preparationValidator = vi.fn(async (_body, user, authContext) => {
      expect(user.id).toBe("canonical-user");
      expect(authContext.datasetToken?.dataset_id).toBe(
        "11111111-1111-4111-8111-111111111111",
      );
      return { tokenPayload: { key: "asset.png" } };
    });

    const response = await handleTwoStageUpload(
      createContext(request),
      {
        bucket: {} as never,
        signingSecret: "upload-secret",
        requireDatasetToken: true,
        preparationValidator,
        executionProcessor: async () => ({ response: { ok: true } }),
      },
    );

    expect(response.status).toBe(200);
    expect(preparationValidator).toHaveBeenCalledOnce();
  });

  it("uses a separate preparation body limit", async () => {
    const request = new Request("https://example.test/upload", {
      method: "POST",
      headers: { "X-Dataset-Token": "dataset-token" },
      body: JSON.stringify({ value: "x".repeat(32) }),
    });

    const response = await handleTwoStageUpload(createContext(request), {
      signingSecret: "upload-secret",
      requireDatasetToken: true,
      maxBodySize: 128,
      maxPreparationBodySize: 16,
      preparationValidator: async () => ({ tokenPayload: {} }),
      executionProcessor: async () => ({ response: { ok: true } }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "request_too_large" });
  });

  it("supports a fixed token TTL when the payload declares a file size", async () => {
    const request = new Request("https://example.test/upload", {
      method: "POST",
      headers: { "X-Dataset-Token": "dataset-token" },
      body: JSON.stringify({ file_size: 1024 }),
    });

    const response = await handleTwoStageUpload(createContext(request), {
      signingSecret: "upload-secret",
      requireDatasetToken: true,
      tokenTTL: () => 300,
      preparationValidator: async () => ({
        tokenPayload: { declared_size: 1024 },
      }),
      executionProcessor: async () => ({ response: { ok: true } }),
    });

    expect(response.status).toBe(200);
    const { generateSignedToken } = await import("../../utils");
    expect(generateSignedToken).toHaveBeenLastCalledWith(
      { declared_size: 1024, user_id: "canonical-user" },
      "upload-secret",
      300,
    );
  });

  it("accepts execution without a Supabase JWT for a dataset-token upload", async () => {
    const request = new Request("https://example.test/upload", {
      method: "POST",
      headers: { "X-Upload-Token": "signed-upload-token" },
      body: new Uint8Array([1, 2, 3]),
    });
    const executionProcessor = vi.fn(async (_payload, _data, user) => {
      expect(user.id).toBe("canonical-user");
      return { response: { ok: true } };
    });

    const response = await handleTwoStageUpload(
      createContext(request),
      {
        bucket: {} as never,
        signingSecret: "upload-secret",
        requireDatasetToken: true,
        preparationValidator: async () => ({ tokenPayload: {} }),
        executionProcessor,
      },
    );

    expect(response.status).toBe(200);
    expect(executionProcessor).toHaveBeenCalledOnce();
  });
});