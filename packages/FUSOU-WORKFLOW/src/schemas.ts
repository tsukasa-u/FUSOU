import { z } from "zod";

export const JsonRecordSchema = z.record(z.unknown());

const LegacyQueueMessageSchema = z.object({
  batched: z.literal(false).optional(),
  table: z.string().min(1),
  avro_base64: z.string().min(1),
  datasetId: z.string().min(1),
  periodTag: z.string().min(1),
  tableVersion: z.string().min(1),
  triggeredAt: z.string().optional(),
  userId: z.string().optional(),
  trust_tag: z.string().optional(),
}).strict();

const SnakeCaseLegacyQueueMessageSchema = z.object({
  table: z.string().min(1),
  avro_base64: z.string().min(1),
  dataset_id: z.string().min(1),
  period_tag: z.string().min(1),
  table_version: z.string().min(1),
  triggered_at: z.string().optional(),
  user_id: z.string().optional(),
  trust_tag: z.string().optional(),
}).strict().transform((message) => ({
  table: message.table,
  avro_base64: message.avro_base64,
  datasetId: message.dataset_id,
  periodTag: message.period_tag,
  tableVersion: message.table_version,
  ...(message.triggered_at !== undefined ? { triggeredAt: message.triggered_at } : {}),
  ...(message.user_id !== undefined ? { userId: message.user_id } : {}),
  ...(message.trust_tag !== undefined ? { trust_tag: message.trust_tag } : {}),
}));

const TableOffsetSchema = z.object({
  table_name: z.string().min(1),
  start_byte: z.number().int().nonnegative(),
  byte_length: z.number().int().positive(),
  record_count: z.number().int().nonnegative().optional(),
}).strict();

const BatchedQueueMessageSchema = z.object({
  batched: z.literal(true),
  datasetId: z.string().min(1),
  periodTag: z.string().min(1),
  tableVersion: z.string().min(1),
  triggeredAt: z.string().optional(),
  userId: z.string().optional(),
  payload_base64: z.string().min(1),
  table_offsets: z.array(TableOffsetSchema).min(1),
  trust_tag: z.string().optional(),
}).strict();

export const QueueMessageSchema = z.union([
  LegacyQueueMessageSchema,
  SnakeCaseLegacyQueueMessageSchema,
  BatchedQueueMessageSchema,
]);

export type QueueMessage = z.infer<typeof QueueMessageSchema>;

export const AvroSchemaSchema = z
  .object({
    namespace: z.string().optional(),
  })
  .passthrough();

const FingerprintEntrySchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)),
]);

export const FingerprintVersionMapSchema = z.record(
  z.object({
    tables: z.record(FingerprintEntrySchema),
  }),
);

export type FingerprintVersionMap = z.infer<typeof FingerprintVersionMapSchema>;

export const R2KeysSchema = z.array(z.string().min(1)).min(1);
