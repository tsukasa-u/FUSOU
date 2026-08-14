import { z } from "zod";

export const AssetKeyRowSchema = z
  .object({ key: z.string().min(1) })
  .passthrough();

export type AssetKeyRow = z.infer<typeof AssetKeyRowSchema>;
