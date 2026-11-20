import { z } from "zod";

export const UpdateApiKeyRequestSchema = z.object({
  is_active: z.boolean().optional(),
});

export type UpdateApiKeyRequest = z.infer<typeof UpdateApiKeyRequestSchema>;

export const SupabaseApiUserSchema = z
  .looseObject({
    id: z.string().min(1),
    email: z.string().min(1),
  });

export const ApiKeyCreateRowsSchema = z
  .looseObject({
    id: z.string().min(1),
    key: z.string().min(1),
  })
  .array();

export const ApiKeyIdRowsSchema = z
  .looseObject({
    id: z.string().min(1),
  })
  .array();

export const TrustedDeviceListRowsSchema = z
  .looseObject({
    id: z.string().min(1),
    client_id: z.string().min(1),
    device_name: z.string().nullable(),
    created_at: z.string().min(1),
    last_used_at: z.string().nullable(),
  })
  .array();

export const TrustedDeviceIdRowsSchema = z
  .looseObject({
    id: z.string().min(1),
  })
  .array();

export const ApiKeyListRowsSchema = z
  .looseObject({
    id: z.string().min(1),
    key: z.string().min(1),
    email: z.string().min(1),
    is_active: z.boolean(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .array();