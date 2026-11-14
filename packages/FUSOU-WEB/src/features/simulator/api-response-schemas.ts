import { z } from "zod";

export type MasterDataJsonResponse = z.infer<
  typeof MasterDataJsonResponseSchema
>;
export const MasterDataJsonResponseSchema = z
  .object({
    records: z.array(z.record(z.string(), z.unknown())).optional(),
    period_tag: z.string().optional(),
    period_revision: z.number().int().optional(),
    table_version: z.string().optional(),
  })
  .passthrough();

export const MasterShipListResponseSchema = z
  .object({
    records: z
      .array(
        z
          .object({
            id: z.number().finite().optional(),
            name: z.string().optional(),
            stype: z.number().finite().optional(),
          })
          .passthrough(),
      )
      .optional(),
    period_tag: z.string().optional(),
    period_revision: z.number().int().optional(),
    table_version: z.string().optional(),
  })
  .passthrough();

export const FleetSnapshotsListResponseSchema = z
  .object({
    ok: z.boolean(),
    tags: z.array(
      z
        .object({
          tag: z.string(),
          uploaded: z.string().optional(),
          size: z.number().finite().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const ShortUrlResponseSchema = z
  .object({
    ok: z.boolean(),
    shortUrl: z.string().min(1).optional(),
  })
  .passthrough();
