import { z } from "zod";

export const SnapshotPayloadSchema = z
  .object({
    snapshotShips: z.record(z.unknown()).optional(),
    snapshotSlotItems: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const ShortenerRequestSchema = z.object({
  url: z.string().min(1),
  snapshotPayload: z.unknown().optional(),
}).passthrough();

export type ShortenerRequest = z.infer<typeof ShortenerRequestSchema>;
export type SnapshotPayload = z.infer<typeof SnapshotPayloadSchema>;