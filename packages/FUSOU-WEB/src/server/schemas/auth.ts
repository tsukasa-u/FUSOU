import { z } from "zod";

export const GoogleTokenResponseSchema = z
  .looseObject({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    refresh_token: z.string().min(1).optional(),
  });