import { z } from "zod";

export const UpdateApiKeyRequestSchema = z.object({
  is_active: z.boolean().optional(),
});

export type UpdateApiKeyRequest = z.infer<typeof UpdateApiKeyRequestSchema>;

export const ApiKeyCreateRowsSchema = z
  .object({
    id: z.string().min(1),
    key: z.string().min(1),
  })
  .passthrough()
  .array();

export const ApiKeyIdRowsSchema = z
  .object({
    id: z.string().min(1),
  })
  .passthrough()
  .array();

export const ApiKeyListRowsSchema = z
  .object({
    id: z.string().min(1),
    key: z.string().min(1),
    email: z.string().min(1),
    is_active: z.boolean(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .passthrough()
  .array();