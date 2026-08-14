import { z } from "zod";

export const UpdateApiKeyRequestSchema = z.object({
  is_active: z.boolean().optional(),
});

export type UpdateApiKeyRequest = z.infer<typeof UpdateApiKeyRequestSchema>;