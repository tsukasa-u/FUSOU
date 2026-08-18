import { z } from "zod";

export const SanitizeStateRequestSchema = z
  .object({
    datasetId: z.string().optional(),
  })
  .passthrough();

export type SanitizeStateRequest = z.infer<typeof SanitizeStateRequestSchema>;