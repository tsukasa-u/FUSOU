import { z } from "zod";

export const MemberLookupRequestSchema = z
  .object({
    member_id_hash: z.string().optional(),
  })
  .passthrough();

export type MemberLookupRequest = z.infer<typeof MemberLookupRequestSchema>;