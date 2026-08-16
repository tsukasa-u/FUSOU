import { z } from "zod";

export const SnapshotPayloadSchema = z
  .object({
    snapshotShips: z.record(z.unknown()).optional(),
    snapshotSlotItems: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const ShareRecordResponseSchema = z
  .object({
    originalUrl: z.string().optional(),
    snapshotPayload: SnapshotPayloadSchema.nullable().optional(),
  })
  .passthrough();

export const ShortenerRequestSchema = z
  .object({
    url: z.string().min(1),
    snapshotPayload: SnapshotPayloadSchema.nullable().optional(),
  })
  .strip();

export type ShortenerRequest = z.infer<typeof ShortenerRequestSchema>;
export type SnapshotPayload = z.infer<typeof SnapshotPayloadSchema>;
export type ShareRecordResponse = z.infer<typeof ShareRecordResponseSchema>;