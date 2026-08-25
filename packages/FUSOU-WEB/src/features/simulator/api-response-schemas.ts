import { z } from "zod";

export const MasterDataJsonResponseSchema = z
  .object({
    records: z.array(z.record(z.unknown())).optional(),
    period_tag: z.string().optional(),
    period_revision: z.number().int().optional(),
    table_version: z.string().optional(),
  })
  .passthrough();

export const MasterShipListResponseSchema = z
  .object({
    records: z
      .array(
        z
          .object({
            id: z.number().finite().optional(),
            name: z.string().optional(),
            stype: z.number().finite().optional(),
          })
          .passthrough(),
      )
      .optional(),
    period_tag: z.string().optional(),
    period_revision: z.number().int().optional(),
    table_version: z.string().optional(),
  })
  .passthrough();

const QuestRuleSchema = z
  .object({
    rule_id: z.string(),
    target_quest_id: z.number().int(),
    prereq_set_json: z.string(),
    set_size: z.number().int(),
    class: z.string(),
    support: z.number().finite(),
    confidence: z.number().finite(),
    lift: z.number().finite(),
    score: z.number().finite(),
    period_tag: z.string(),
    table_version: z.string(),
    is_primary: z.number().int(),
    quality_tier: z.string(),
    updated_at_ms: z.number().finite(),
  })
  .passthrough();

const QuestGraphEdgeSchema = z
  .object({
    from: z.number().int(),
    to: z.number().int(),
    score: z.number().finite(),
    class: z.string(),
  })
  .passthrough();

export const QuestGraphResponseSchema = z
  .object({
    ok: z.boolean(),
    period_tag: z.string(),
    table_version: z.string(),
    nodes: z.array(z.number().int()),
    edges: z.array(QuestGraphEdgeSchema),
  })
  .passthrough();

export const QuestRulesResponseSchema = z
  .object({
    ok: z.boolean(),
    target: z.number().int(),
    period_tag: z.string(),
    table_version: z.string(),
    rules: z.array(QuestRuleSchema),
  })
  .passthrough();

export const FleetSnapshotsListResponseSchema = z
  .object({
    ok: z.boolean(),
    tags: z.array(
      z
        .object({
          tag: z.string(),
          uploaded: z.string().optional(),
          size: z.number().finite().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const ShortUrlResponseSchema = z
  .object({
    ok: z.boolean(),
    shortUrl: z.string().min(1).optional(),
  })
  .passthrough();
