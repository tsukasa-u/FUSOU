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

const FleetSnapshotRecordSchema = z.record(z.unknown());
const FleetSnapshotArraySchema = FleetSnapshotRecordSchema.array();

export const FleetSnapshotPayloadSchema = z
  .object({
    s3s: FleetSnapshotArraySchema.optional(),
    u7s: FleetSnapshotArraySchema.optional(),
    s8s: FleetSnapshotArraySchema.optional(),
    d8k: FleetSnapshotArraySchema.optional(),
    c11g: z.number().finite().nullable().optional(),
  })
  .passthrough()
  .superRefine((payload, context) => {
    if (!("s3s" in payload || "u7s" in payload || "s8s" in payload || "d8k" in payload)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fleet snapshot must contain at least one fleet data array",
      });
    }
  });

export type FleetSnapshotPayload = z.infer<typeof FleetSnapshotPayloadSchema>;

export function parseFleetSnapshotPayload(
  value: unknown,
): FleetSnapshotPayload | null {
  const result = FleetSnapshotPayloadSchema.safeParse(value);
  return result.success ? result.data : null;
}