import { z } from "zod";
import { MAX_QUEST_TREE_UPLOAD_BYTES } from "../constants";
import { PublicIdSchema } from "./public-id";

const ALLOWED_EVENT_TYPES = new Set(["snapshot", "start", "stop", "complete"]);
const MAX_QUEST_LIST_ENTRIES = 1000;
const MAX_QUEST_TITLE_LENGTH = 512;
const MAX_QUEST_DETAIL_LENGTH = 8192;

function toInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return undefined;
}

const OptionalIntegerFieldSchema = z.preprocess(
  toInteger,
  z.number().int().optional(),
);

const OptionalNonnegativeIntegerFieldSchema = z.preprocess(
  toInteger,
  z.number().int().min(0).optional(),
);

const OptionalTrimmedStringFieldSchema = z.preprocess(
  (value) => (value == null ? undefined : String(value).trim()),
  z.string().max(256).optional(),
);

const OptionalStringFieldSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : undefined),
  z.string().max(MAX_QUEST_TITLE_LENGTH).optional(),
);

const OptionalQuestDetailSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : undefined),
  z.string().max(MAX_QUEST_DETAIL_LENGTH).optional(),
);

const OptionalInputStringSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.string().max(4096).optional(),
);

const OptionalQuestUploadSizeSchema = z.preprocess(
  (value) => {
    if (value == null || (typeof value === "string" && value.trim() === "")) {
      return undefined;
    }
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : value;
    return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed > 0
      ? parsed
      : value;
  },
  z
    .number()
    .int()
    .positive()
    .max(MAX_QUEST_TREE_UPLOAD_BYTES)
    .optional(),
);

const QuestListEntrySchema = z.preprocess(
  (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {},
  z
    .object({
      quest_id: OptionalIntegerFieldSchema,
      type: OptionalIntegerFieldSchema,
      category: OptionalIntegerFieldSchema,
      label_type: OptionalIntegerFieldSchema,
      title: OptionalStringFieldSchema,
      detail: OptionalQuestDetailSchema,
    })
    .strip(),
);

export const QuestIngestEventIdRowSchema = z
  .looseObject({
    id: z.number().int(),
  })
  .nullable();

export const QuestIngestConflictRowSchema = z
  .looseObject({
    id: z.number().int(),
    payload_hash: z.string().min(1),
  })
  .nullable();

export const QuestCollectionSessionRowSchema = z
  .looseObject({
    collection_session_id: z.string().min(1),
    ended_at_ms: z.number().int().nullable(),
    bootstrap_completed_at_ms: z.number().int().nullable(),
  })
  .nullable();

export const QuestCollectionSessionIdRowSchema = z
  .looseObject({ collection_session_id: z.string().min(1) })
  .nullable();

export const QuestAppearanceEventRowSchema = z
  .looseObject({
    target_quest_id: z.number().int(),
    appeared_at_ms: z.number(),
    collection_session_id: z.string().min(1),
    is_bootstrap_unknown: z.number().int(),
  });

export const QuestStateEventRowSchema = z
  .looseObject({
    quest_id: z.number().int(),
    event_type: z.string().min(1),
    state_after: z.enum(["active", "visible_inactive", "claimed"]),
    timestamp_ms: z.number(),
    collection_session_id: z.string().min(1),
  });

export const QuestSnapshotPageRowSchema = z
  .looseObject({
    page_no: z.number().int(),
    visible_quest_ids_json: z.string().nullable().optional(),
  });

export const QuestTreeIngestBodySchema = z
  .object({
    dataset_id: OptionalTrimmedStringFieldSchema,
    dataset_token: OptionalInputStringSchema,
    request_id: OptionalTrimmedStringFieldSchema,
    payload_hash: OptionalTrimmedStringFieldSchema,
    event_type: OptionalTrimmedStringFieldSchema,
    timestamp_ms: OptionalIntegerFieldSchema,
    period_tag: OptionalTrimmedStringFieldSchema,
    table_version: OptionalTrimmedStringFieldSchema,
    page_no: OptionalNonnegativeIntegerFieldSchema,
    quest_id: OptionalIntegerFieldSchema,
    quests: z.preprocess(
      (value) => (Array.isArray(value) ? value : []),
      z.array(QuestListEntrySchema).max(MAX_QUEST_LIST_ENTRIES),
    ).optional(),
    content_hash: OptionalInputStringSchema,
    file_size: OptionalQuestUploadSizeSchema,
  })
  .strip();

export const ValidatedQuestTreeIngestBodySchema =
  QuestTreeIngestBodySchema.superRefine((body, context) => {
    const datasetId = body.dataset_id ?? "";
    const requestId = body.request_id ?? "";
    const payloadHash = body.payload_hash ?? "";
    const eventType = body.event_type ?? "";
    const periodTag = body.period_tag ?? "";
    const tableVersion = body.table_version ?? "";

    if (!datasetId) {
      context.addIssue({
        code: "custom",
        path: ["dataset_id"],
        message: "dataset_id is required",
      });
    } else if (!PublicIdSchema.safeParse(datasetId).success) {
      context.addIssue({
        code: "custom",
        path: ["dataset_id"],
        message: "dataset_id must be a UUID v4 public_id",
      });
    }

    if (!requestId) {
      context.addIssue({
        code: "custom",
        path: ["request_id"],
        message: "request_id is required",
      });
    }
    if (!payloadHash) {
      context.addIssue({
        code: "custom",
        path: ["payload_hash"],
        message: "payload_hash is required",
      });
    }
    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      context.addIssue({
        code: "custom",
        path: ["event_type"],
        message: "event_type must be one of: snapshot, start, stop, complete",
      });
    }
    if (!periodTag) {
      context.addIssue({
        code: "custom",
        path: ["period_tag"],
        message: "period_tag is required",
      });
    }
    if (!tableVersion) {
      context.addIssue({
        code: "custom",
        path: ["table_version"],
        message: "table_version is required",
      });
    }
  });

export type QuestTreeIngestBody = z.infer<typeof QuestTreeIngestBodySchema>;
export type QuestListEntry = NonNullable<QuestTreeIngestBody["quests"]>[number];
