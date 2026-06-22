import { brotliCompressSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateEnvContext, mockGetEnv, mockResolveAllowedExtensions } =
  vi.hoisted(() => ({
    mockCreateEnvContext: vi.fn(),
    mockGetEnv: vi.fn(),
    mockResolveAllowedExtensions: vi.fn(),
  }));

vi.mock("../../utils", () => ({
  extractBearer: vi.fn(),
  validateJWT: vi.fn(),
  resolveAllowedExtensions: mockResolveAllowedExtensions,
  sanitizeKey: vi.fn(),
  sanitizeFileName: vi.fn(),
  violatesAllowList: vi.fn(() => false),
  parseSize: vi.fn(),
  createEnvContext: mockCreateEnvContext,
  getEnv: mockGetEnv,
  timingSafeEqual: vi.fn((a: string, b: string) => a === b),
}));

import assetsApp from "../assets";

function createBucketMock(payloadByKey: Record<string, Uint8Array | null>) {
  return {
    get: vi.fn(async (key: string) => {
      const payload = payloadByKey[key];
      if (!payload) {
        return null;
      }
      return {
        arrayBuffer: async () =>
          payload.buffer.slice(
            payload.byteOffset,
            payload.byteOffset + payload.byteLength,
          ),
      };
    }),
  };
}

describe("assets /ship-type-icon-frames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateEnvContext.mockImplementation((ctx: any) => ({
      runtime: ctx?.env ?? {},
      buildtime: {},
      isDev: false,
    }));
    mockGetEnv.mockImplementation(
      (ctx: any, key: string) => ctx.runtime?.[key],
    );
    mockResolveAllowedExtensions.mockReturnValue([]);
  });

  it("returns plain JSON when atlas is stored uncompressed", async () => {
    const payload = {
      frames: { icon_a: { frame: { x: 0, y: 0, w: 16, h: 16 } } },
      meta: { size: { w: 16, h: 16 } },
    };
    const key = "assets/kcs2/img/organize/organize_ship.json";
    const bucket = createBucketMock({
      [key]: new TextEncoder().encode(JSON.stringify(payload)),
    });

    const response = await assetsApp.request(
      "http://localhost/ship-type-icon-frames",
      { method: "GET" },
      {
        ASSET_SYNC_BUCKET: bucket,
      } as any,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
  });

  it("decompresses Brotli-compressed JSON atlas", async () => {
    const payload = {
      frames: { icon_b: { frame: { x: 16, y: 0, w: 16, h: 16 } } },
      meta: { size: { w: 32, h: 16 } },
    };
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const key = "assets/kcs2/img/organize/organize_ship.json";
    const bucket = createBucketMock({
      [key]: new Uint8Array(brotliCompressSync(raw)),
    });

    const response = await assetsApp.request(
      "http://localhost/ship-type-icon-frames",
      { method: "GET" },
      {
        ASSET_SYNC_BUCKET: bucket,
      } as any,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
  });
});
