import { z } from "zod";

export const RemodelDataIngestBodySchema = z.record(
  z.string(),
  z.unknown(),
);

export type RemodelDataIngestBody = z.infer<
  typeof RemodelDataIngestBodySchema
>;
