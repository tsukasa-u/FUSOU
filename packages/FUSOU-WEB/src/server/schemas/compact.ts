import { z } from "zod";

export const SanitizeStateRequestSchema = z
  .looseObject({
    datasetId: z.string().optional(),
  });

export type SanitizeStateRequest = z.infer<typeof SanitizeStateRequestSchema>;