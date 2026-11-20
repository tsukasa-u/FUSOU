import { z } from "zod";

export type MasterDataJsonResponse = z.infer<
  typeof MasterDataJsonResponseSchema
>;
export const MasterDataJsonResponseSchema = z
  .looseObject({
    records: z.array(z.record(z.string(), z.unknown())).optional(),
    period_tag: z.string().optional(),
    period_revision: z.number().int().optional(),
    table_version: z.string().optional(),
  });

export const MasterShipListResponseSchema = z
  .looseObject({
    records: z
      .array(
        z
          .looseObject({
            id: z.number().optional(),
            name: z.string().optional(),
            stype: z.number().optional(),
          }),
      )
      .optional(),
    period_tag: z.string().optional(),
    period_revision: z.number().int().optional(),
    table_version: z.string().optional(),
  });

export const FleetSnapshotsListResponseSchema = z
  .looseObject({
    ok: z.boolean(),
    tags: z.array(
      z
        .looseObject({
          tag: z.string(),
          uploaded: z.string().optional(),
          size: z.number().optional(),
        }),
    ),
  });

export const ShortUrlResponseSchema = z
  .looseObject({
    ok: z.boolean(),
    shortUrl: z.string().min(1).optional(),
  });
