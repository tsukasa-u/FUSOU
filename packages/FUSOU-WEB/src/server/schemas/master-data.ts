import { z } from "zod";

export const MasterDataNextRevisionRowSchema = z
  .object({ next_revision: z.number().nullable().optional() })
  .passthrough();

export type MasterDataNextRevisionRow = z.infer<
  typeof MasterDataNextRevisionRowSchema
>;
