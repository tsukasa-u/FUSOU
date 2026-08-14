import { z } from "zod";

export const VerifyDeviceRequestSchema = z
  .object({
    code: z.string().optional(),
  })
  .passthrough();

export const VerifyGoogleRequestSchema = z
  .object({
    email: z.unknown().optional(),
    google_token: z.string().optional(),
  })
  .passthrough();

export type VerifyDeviceRequest = z.infer<typeof VerifyDeviceRequestSchema>;
export type VerifyGoogleRequest = z.infer<typeof VerifyGoogleRequestSchema>;