import { z } from "zod";

export const SokuSpeedIngestBodySchema = z
  .object({
    dataset_id: z.unknown().optional(),
    dataset_token: z.unknown().optional(),
    request_id: z.unknown().optional(),
    payload_hash: z.unknown().optional(),
    event_type: z.unknown().optional(),
    period_tag: z.unknown().optional(),
    table_version: z.unknown().optional(),
    ships: z.unknown().optional(),
    content_hash: z.unknown().optional(),
    file_size: z.unknown().optional(),
  })
  .passthrough();

export type SokuSpeedIngestBody = z.infer<typeof SokuSpeedIngestBodySchema>;
