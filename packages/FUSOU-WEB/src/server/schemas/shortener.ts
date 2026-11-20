import { z } from "zod";

export const SnapshotPayloadSchema = z
  .looseObject({
    snapshotShips: z.record(z.string(), z.unknown()).optional(),
    snapshotSlotItems: z.record(z.string(), z.unknown()).optional(),
  });

export const ShareRecordResponseSchema = z
  .looseObject({
    originalUrl: z.string().optional(),
    snapshotPayload: SnapshotPayloadSchema.nullable().optional(),
  });

export const ShortenerRequestSchema = z
  .object({
    url: z.string().min(1),
    snapshotPayload: SnapshotPayloadSchema.nullable().optional(),
  })
  .strip();

export type ShortenerRequest = z.infer<typeof ShortenerRequestSchema>;
export type SnapshotPayload = z.infer<typeof SnapshotPayloadSchema>;
export type ShareRecordResponse = z.infer<typeof ShareRecordResponseSchema>;