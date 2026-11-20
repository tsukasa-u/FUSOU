export type GraphMode = "database" | "endpoints";
import { z } from "zod";
import type { Edge, Node } from "@xyflow/react";

const DiffStatusSchema = z.enum(["added", "removed", "changed"]);

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const GraphEdgeSchema = z
  .looseObject({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    label: z.string().optional(),
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
  });

export const SchemaFieldSchema = z
  .looseObject({
    name: z.string(),
    type: z.string(),
    isUuid: z.boolean().optional(),
    isKey: z.boolean().optional(),
    isFk: z.boolean().optional(),
    isEnvRef: z.boolean().optional(),
    diffStatus: DiffStatusSchema.nullable().optional(),
  });

export const EndpointFieldSchema = z
  .looseObject({
    name: z.string(),
    type: z.string(),
    diffStatus: DiffStatusSchema.nullable().optional(),
    diffDetail: z
      .object({
        feature: z.string(),
        withFeature: z.string().nullable(),
        withoutFeature: z.string().nullable(),
      })
      .optional(),
  });

const RelationDataSchema = z.object({
  relationType: z.enum(["selected", "ancestor", "descendant"]).nullable().optional(),
  relationDepth: z.number().optional(),
});

export const SchemaTableNodeDataSchema = z
  .looseObject({
    tableName: z.string(),
    recordName: z.string(),
    structName: z.string().optional(),
    fields: z.array(SchemaFieldSchema),
    highlighted: z.boolean().optional(),
    diffStatus: DiffStatusSchema.nullable().optional(),
  })
  .extend(RelationDataSchema.shape);

export const EndpointNodeDataSchema = z
  .looseObject({
    structName: z.string(),
    fields: z.array(EndpointFieldSchema),
    isReq: z.boolean(),
    isRes: z.boolean(),
    isDataType: z.boolean(),
    diffStatus: DiffStatusSchema.nullable().optional(),
  })
  .extend(RelationDataSchema.shape);

export const GraphNodeSchema = z
  .looseObject({
    id: z.string(),
    position: PositionSchema,
    type: z.string().optional(),
    data: z.union([SchemaTableNodeDataSchema, EndpointNodeDataSchema]),
  });

export const GraphDataSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});

const DatabaseVersionDiffSchema = z
  .looseObject({
    status: DiffStatusSchema,
    addedFields: z.array(z.string()),
    changedFields: z.array(z.string()),
    removedFields: z.array(z.string()),
  });

export const DbVersionsSchema = z.object({
  versions: z.record(
    z.string(),
    z.looseObject({ tableCount: z.number(), version: z.string() }),
  ),
  sortedVersions: z.array(z.string()),
  majorVersions: z.record(
    z.string(),
    z.looseObject({ versions: z.array(z.string()), latest: z.string() }),
  ),
  diffs: z.record(z.string(), z.record(z.string(), DatabaseVersionDiffSchema)),
});

export const EndpointFeatureVariantsSchema = z
  .looseObject({
    activeFeatures: z.array(z.string()),
    allFeatures: z.array(z.string()),
    fieldDiffs: z.record(
      z.string(),
      z.record(
        z.string(),
        z.record(
          z.string(),
          z.object({
            with_feature: z.string().nullable(),
            without_feature: z.string().nullable(),
          }),
        ),
      ),
    ),
  });

export const EndpointGroupSchema = z.object({
  endpoints: z.array(
    GraphDataSchema.extend({
      name: z.string(),
      label: z.string(),
      path: z.string(),
    }),
  ),
});

export const EndpointGraphSchema = z
  .looseObject({
    featureVariants: EndpointFeatureVariantsSchema,
    groups: z.record(z.string(), EndpointGroupSchema),
  });

export type DiffStatus = "added" | "removed" | "changed";
export type RelationType = "selected" | "ancestor" | "descendant";

export type SchemaField = {
  name: string;
  type: string;
  isUuid?: boolean;
  isKey?: boolean;
  isFk?: boolean;
  isEnvRef?: boolean;
  diffStatus?: DiffStatus | null;
};

export type EndpointField = {
  name: string;
  type: string;
  diffStatus?: DiffStatus | null;
  diffDetail?: {
    feature: string;
    withFeature: string | null;
    withoutFeature: string | null;
  };
};

type RelationData = {
  relationType?: RelationType | null;
  relationDepth?: number;
};

export type SchemaTableNodeData = {
  tableName: string;
  recordName: string;
  structName?: string;
  fields: SchemaField[];
  highlighted?: boolean;
  diffStatus?: DiffStatus | null;
} & RelationData;

export type EndpointNodeData = {
  structName: string;
  fields: EndpointField[];
  isReq: boolean;
  isRes: boolean;
  isDataType: boolean;
  diffStatus?: DiffStatus | null;
} & RelationData;

export type GraphNodeData = SchemaTableNodeData | EndpointNodeData;
export type GraphNode = Node<GraphNodeData>;
export type GraphEdge = Edge;
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };
export type DbVersions = z.infer<typeof DbVersionsSchema>;
export type EndpointGraph = {
  featureVariants: {
    activeFeatures: string[];
    allFeatures: string[];
    fieldDiffs: Record<string, Record<string, Record<string, {
      with_feature: string | null;
      without_feature: string | null;
    }>>>;
  };
  groups: Record<string, {
    endpoints: Array<GraphData & {
      name: string;
      label: string;
      path: string;
    }>;
  }>;
};

export function parseDbVersions(value: unknown): DbVersions {
  return DbVersionsSchema.parse(value);
}

export function parseEndpointGraph(value: unknown): EndpointGraph {
  return EndpointGraphSchema.parse(value) as EndpointGraph;
}

export function parseGraphData(value: unknown): GraphData {
  return GraphDataSchema.parse(value) as GraphData;
}
