import { z } from "zod";

export const FleetMemberMapRowSchema = z
  .object({ member_id_hash: z.string().nullable().optional() })
  .passthrough();

export const FleetRotationRowsSchema = z
  .object({
    pid_from: z.string().nullable().optional(),
    pid_to: z.string().nullable().optional(),
  })
  .passthrough()
  .array();