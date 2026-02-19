/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import ELK from "elkjs/lib/elk.bundled.js";

import SchemaTableNode from "./SchemaTableNode";
import EndpointNode from "./EndpointNode";
import VersionSelector from "./VersionSelector";
import ApiGroupNav from "./ApiGroupNav";
import NodeDetailPanel from "./NodeDetailPanel";
import "./css/reactflow.css";

// Import pre-generated graph data (db versions loaded dynamically via glob)
import dbVersionsData from "../../data/graphs/db_versions.json";
import endpointData from "../../data/graphs/endpoints_by_group.json";

const nodeTypes = {
  schemaTableNode: SchemaTableNode,
  endpointNode: EndpointNode,
};

interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

// Dynamically import all version JSON files at build time
const dbVersionModules = import.meta.glob("../../data/graphs/db_v*.json", {
  eager: true,
}) as Record<string, { default: any }>;

const DB_VERSIONS: Record<string, any> = {};
for (const [path, mod] of Object.entries(dbVersionModules)) {
  const match = path.match(/db_(v\d+_\d+)\.json$/);
  if (match) {
    DB_VERSIONS[match[1]] = mod.default;
  }
}

// Extract version metadata from generated db_versions.json
const dbVersionsMeta = dbVersionsData as {
  versions: Record<string, { tableCount: number; version: string }>;
  sortedVersions: string[];
  majorVersions: Record<string, { versions: string[]; latest: string }>;
  diffs: Record<string, any>;
};

const ALL_DB_VERSIONS = dbVersionsMeta.sortedVersions;
const MAJOR_VERSIONS = dbVersionsMeta.majorVersions;
const SORTED_MAJOR_KEYS = Object.keys(MAJOR_VERSIONS).sort(
  (a, b) => parseInt(a.replace("v", ""), 10) - parseInt(b.replace("v", ""), 10),
);
const DEFAULT_MAJOR = SORTED_MAJOR_KEYS[SORTED_MAJOR_KEYS.length - 1];
const DEFAULT_VERSION =
  MAJOR_VERSIONS[DEFAULT_MAJOR]?.latest ??
  ALL_DB_VERSIONS[ALL_DB_VERSIONS.length - 1];

const NODE_WIDTH = 300;
const NODE_HEIGHT_BASE = 52;
const NODE_HEIGHT_PER_FIELD = 24;

type EdgeStyle = "bezier" | "smoothstep" | "straight";
type LayoutDir = "LR" | "TB";
type LayoutSpacing = "compact" | "normal" | "spacious";
type LayoutAlgo = "dagre" | "elk-layered" | "elk-mrtree";

const SPACING_MAP: Record<
  LayoutSpacing,
  { nodesep: number; ranksep: number; edgesep: number }
> = {
  compact: { nodesep: 40, ranksep: 120, edgesep: 30 },
  normal: { nodesep: 80, ranksep: 220, edgesep: 60 },
  spacious: { nodesep: 130, ranksep: 340, edgesep: 90 },
};

const ELK_SPACING_MAP: Record<
  LayoutSpacing,
  { nodeSpacing: number; layerSpacing: number }
> = {
  compact: { nodeSpacing: 40, layerSpacing: 100 },
  normal: { nodeSpacing: 80, layerSpacing: 200 },
  spacious: { nodeSpacing: 130, layerSpacing: 320 },
};

const elk = new ELK();

function estimateNodeHeight(node: Node): number {
  const fields = (node.data as any)?.fields;
  if (Array.isArray(fields)) {
    return NODE_HEIGHT_BASE + fields.length * NODE_HEIGHT_PER_FIELD;
  }
  return NODE_HEIGHT_BASE + 3 * NODE_HEIGHT_PER_FIELD;
}

function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDir = "LR",
  spacing: LayoutSpacing = "normal",
): Node[] {
  if (nodes.length === 0) return nodes;
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  const s = SPACING_MAP[spacing];
  g.setGraph({
    rankdir: direction,
    nodesep: s.nodesep,
    ranksep: s.ranksep,
    edgesep: s.edgesep,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: estimateNodeHeight(node) });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return node;
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - estimateNodeHeight(node) / 2,
      },
    };
  });
}

/**
 * ELK レイアウト — dagre より交差最小化が優秀。
 * ELK は非同期なので Promise を返す。
 */
async function applyElkLayout(
  nodes: Node[],
  edges: Edge[],
  algo: "elk-layered" | "elk-mrtree",
  direction: LayoutDir,
  spacing: LayoutSpacing,
): Promise<Node[]> {
  if (nodes.length === 0) return nodes;
  const s = ELK_SPACING_MAP[spacing];
  const elkDir = direction === "LR" ? "RIGHT" : "DOWN";

  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": algo === "elk-layered" ? "layered" : "mrtree",
      "elk.direction": elkDir,
      "elk.spacing.nodeNode": String(s.nodeSpacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(s.layerSpacing),
      // 交差最小化設定
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: NODE_WIDTH,
      height: estimateNodeHeight(n),
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const laid = await elk.layout(elkGraph);
  const posMap = new Map<string, { x: number; y: number }>();
  for (const child of laid.children ?? []) {
    if (child.x !== undefined && child.y !== undefined) {
      posMap.set(child.id, { x: child.x, y: child.y });
    }
  }

  return nodes.map((node) => {
    const pos = posMap.get(node.id);
    if (!pos) return node;
    return { ...node, position: { x: pos.x, y: pos.y } };
  });
}

const EDGE_BASE_COLOR = "oklch(0.65 0.15 250)";

/** Add arrow marker to edges */
function enrichEdges(edges: Edge[], edgeStyle: EdgeStyle): Edge[] {
  return edges.map((edge) => ({
    ...edge,
    type: edgeStyle === "bezier" ? undefined : edgeStyle,
    label: undefined,
    animated: false,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: EDGE_BASE_COLOR,
    },
    style: {
      stroke: EDGE_BASE_COLOR,
      strokeWidth: 1.5,
    },
  }));
}

/** Compute endpoint node view for a given version.
 *
 * "base": revert to the state WITHOUT any features.
 *   - Remove fields where diffStatus === "added" (only exist with feature)
 *   - Keep fields where diffStatus === "removed", clear annotations (exist in base)
 *   - Revert "changed" fields to diffDetail.withoutFeature type
 *
 * Any non-"base" version: keep data as-is (baked-in annotations show changes from base).
 */
function computeEndpointVersionView(nodes: Node[], version: string): Node[] {
  if (version !== "base") return nodes;

  return nodes.map((node) => {
    const data = { ...(node.data as any) };
    data.fields = data.fields
      .filter((f: any) => f.diffStatus !== "added")
      .map((f: any) => {
        if (f.diffStatus === "changed" && f.diffDetail?.withoutFeature) {
          return {
            ...f,
            type: f.diffDetail.withoutFeature,
            diffStatus: null,
            diffDetail: undefined,
          };
        }
        if (f.diffStatus) {
          return { ...f, diffStatus: null, diffDetail: undefined };
        }
        return f;
      });
    return { ...node, data };
  });
}

/** Apply version diff highlighting to nodes */
function applyDiffToNodes(nodes: Node[], version: string): Node[] {
  const diffs = (dbVersionsData as any).diffs || {};
  const diffKeys = Object.keys(diffs);
  const relevantKey = diffKeys.find((k) => k.endsWith(`_to_${version}`));
  if (!relevantKey) return nodes;

  const diff = diffs[relevantKey];
  return nodes.map((node) => {
    const tableDiff = diff[node.id];
    if (!tableDiff) return node;

    const data = { ...(node.data as any) };
    data.diffStatus = tableDiff.status;

    if (data.fields) {
      data.fields = data.fields.map((f: any) => ({
        ...f,
        diffStatus: tableDiff.addedFields?.includes(f.name)
          ? "added"
          : tableDiff.removedFields?.includes(f.name)
            ? "removed"
            : tableDiff.changedFields?.includes(f.name)
              ? "changed"
              : null,
      }));
    }

    return { ...node, data };
  });
}

/**
 * BFS で親テーブル (ancestor) と子テーブル (descendant) を収集する。
 * edge.source → edge.target は FK テーブル → 参照先 PK テーブル の方向。
 *
 * DB 用語:
 *   親テーブル (ancestor)   = 参照される側 (PK 側) — 選択ノードの FK が指す先
 *   子テーブル (descendant) = 参照する側 (FK 側)   — 選択ノードを FK で参照するテーブル
 *
 * 選択ノードが order (FK: user_id) の場合:
 *   ancestor  → outgoing edges の target = user (PK側) = 親 ✓
 *   descendant → incoming edges の source = order_item (FKでorderを参照) = 子 ✓
 */
function computeRelatedNodes(
  nodeId: string,
  edges: Edge[],
): { ancestors: Map<string, number>; descendants: Map<string, number> } {
  const ancestors = new Map<string, number>();
  const descendants = new Map<string, number>();

  // 親テーブル BFS: outgoing edges で辿る (自分が FK 側 → 参照先 PK 側)
  const aq: [string, number][] = [[nodeId, 0]];
  while (aq.length > 0) {
    const [cur, depth] = aq.shift()!;
    for (const e of edges) {
      if (e.source === cur && !ancestors.has(e.target) && e.target !== nodeId) {
        ancestors.set(e.target, depth + 1);
        aq.push([e.target, depth + 1]);
      }
    }
  }

  // 子テーブル BFS: incoming edges で辿る (自分が PK 側 ← FK を持つテーブルが source)
  const dq: [string, number][] = [[nodeId, 0]];
  while (dq.length > 0) {
    const [cur, depth] = dq.shift()!;
    for (const e of edges) {
      if (
        e.target === cur &&
        !descendants.has(e.source) &&
        e.source !== nodeId
      ) {
        descendants.set(e.source, depth + 1);
        dq.push([e.source, depth + 1]);
      }
    }
  }

  return { ancestors, descendants };
}

function getEndpointGraphData(
  groupName: string,
  endpointName: string,
): GraphData | null {
  const groups = (endpointData as any).groups;
  const group = groups[groupName];
  if (!group) return null;
  const ep = group.endpoints.find((e: any) => e.name === endpointName);
  if (!ep) return null;

  return { nodes: ep.nodes, edges: ep.edges };
}

export type GraphMode = "database" | "endpoints";

export interface SchemaGraphProps {
  initialMode?: GraphMode;
}

export default function SchemaGraph({
  initialMode = "database",
}: SchemaGraphProps) {
  const [mode, setMode] = useState<GraphMode>(initialMode);
  const [selectedMajor, setSelectedMajor] = useState(DEFAULT_MAJOR);
  const [dbVersion, setDbVersion] = useState(DEFAULT_VERSION);
  const [endpointVersion, setEndpointVersion] = useState<string>(() => {
    const features =
      (endpointData as any).featureVariants?.activeFeatures || [];
    return features.length > 0 ? features[features.length - 1] : "base";
  });
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>("");
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  // Layout controls
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>("bezier");
  const [layoutDir, setLayoutDir] = useState<LayoutDir>("LR");
  const [layoutSpacing, setLayoutSpacing] = useState<LayoutSpacing>("normal");
  const [layoutAlgo, setLayoutAlgo] = useState<LayoutAlgo>("dagre");

  // Selected node ID for relation highlight (separate from detail panel)
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(
    null,
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const groupList = useMemo(() => {
    const groups = (endpointData as any).groups;
    return Object.keys(groups).sort();
  }, []);

  const minorVersionsForMajor = useMemo(
    () => MAJOR_VERSIONS[selectedMajor]?.versions ?? [],
    [selectedMajor],
  );

  const endpointList = useMemo(() => {
    if (!selectedGroup) return [];
    const groups = (endpointData as any).groups;
    const group = groups[selectedGroup];
    if (!group) return [];
    return group.endpoints.map((e: any) => e.name).sort();
  }, [selectedGroup]);

  const endpointVersionList = useMemo(() => {
    const features = (endpointData as any).featureVariants?.allFeatures || [];
    if (features.length === 0) return [];
    return ["base", ...features];
  }, []);

  const endpointVersionLabels = useMemo((): Record<string, string> => {
    const labels: Record<string, string> = { base: "Base" };
    for (const f of (endpointData as any).featureVariants?.allFeatures || []) {
      labels[f] = f;
    }
    return labels;
  }, []);

  // Load + layout graph data
  useEffect(() => {
    let cancelled = false;

    async function load() {
      let graphData: GraphData | null = null;

      if (mode === "database") {
        const versionData = DB_VERSIONS[dbVersion];
        if (versionData) {
          graphData = {
            nodes: [...versionData.nodes],
            edges: [...versionData.edges],
          };
        }
      } else if (mode === "endpoints" && selectedGroup && selectedEndpoint) {
        graphData = getEndpointGraphData(selectedGroup, selectedEndpoint);
      }

      if (graphData) {
        let layoutNodes = graphData.nodes;
        let layoutEdges = graphData.edges;

        if (mode === "database") {
          layoutNodes = applyDiffToNodes(layoutNodes, dbVersion);
        } else if (mode === "endpoints") {
          layoutNodes = computeEndpointVersionView(
            layoutNodes,
            endpointVersion,
          );
        }

        if (layoutAlgo === "dagre") {
          layoutNodes = applyDagreLayout(
            layoutNodes,
            layoutEdges,
            layoutDir,
            layoutSpacing,
          );
        } else {
          layoutNodes = await applyElkLayout(
            layoutNodes,
            layoutEdges,
            layoutAlgo,
            layoutDir,
            layoutSpacing,
          );
        }

        layoutEdges = enrichEdges(layoutEdges, edgeStyle);

        if (!cancelled) {
          setNodes(layoutNodes);
          setEdges(layoutEdges);
          setSelectedNode(null);
          setHighlightedNodeId(null);
        }
      } else if (mode === "endpoints" && !selectedEndpoint) {
        if (!cancelled) {
          setNodes([]);
          setEdges([]);
          setSelectedNode(null);
          setHighlightedNodeId(null);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [
    mode,
    dbVersion,
    endpointVersion,
    selectedGroup,
    selectedEndpoint,
    layoutAlgo,
    layoutDir,
    layoutSpacing,
    edgeStyle,
    setNodes,
    setEdges,
  ]);

  useEffect(() => {
    if (mode === "endpoints" && !selectedGroup && groupList.length > 0) {
      setSelectedGroup(groupList[0]);
    }
  }, [mode, selectedGroup, groupList]);

  useEffect(() => {
    if (endpointList.length > 0 && !endpointList.includes(selectedEndpoint)) {
      setSelectedEndpoint(endpointList[0]);
    }
  }, [endpointList, selectedEndpoint]);

  // 選択ノードに基づいて祖先・子孫をハイライト
  useEffect(() => {
    if (!highlightedNodeId) {
      // ハイライト解除 — relationType を undefined に戻す（null だと opacity-30 が適用される）
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: {
            ...(n.data as any),
            relationType: undefined,
            relationDepth: undefined,
          },
        })),
      );
      setEdges((eds) =>
        eds.map((e) => ({
          ...e,
          style: { stroke: EDGE_BASE_COLOR, strokeWidth: 1.5 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: EDGE_BASE_COLOR,
          },
          animated: false,
          opacity: 1,
        })),
      );
      return;
    }

    setNodes((nds) => {
      const related = computeRelatedNodes(highlightedNodeId, edges);
      return nds.map((n) => {
        let relationType: string | null = null;
        let relationDepth = 0;
        if (n.id === highlightedNodeId) {
          relationType = "selected";
        } else if (related.ancestors.has(n.id)) {
          relationType = "ancestor";
          relationDepth = related.ancestors.get(n.id)!;
        } else if (related.descendants.has(n.id)) {
          relationType = "descendant";
          relationDepth = related.descendants.get(n.id)!;
        }
        return {
          ...n,
          data: { ...(n.data as any), relationType, relationDepth },
        };
      });
    });

    setEdges((eds) => {
      const related = computeRelatedNodes(highlightedNodeId, eds);
      const allRelatedIds = new Set([
        highlightedNodeId,
        ...related.ancestors.keys(),
        ...related.descendants.keys(),
      ]);
      return eds.map((e) => {
        const isRelated =
          allRelatedIds.has(e.source) && allRelatedIds.has(e.target);
        const isDirect =
          e.source === highlightedNodeId || e.target === highlightedNodeId;
        if (isRelated) {
          const color = isDirect
            ? "oklch(0.65 0.2 145)"
            : "oklch(0.65 0.15 220)";
          return {
            ...e,
            style: { stroke: color, strokeWidth: isDirect ? 2.5 : 1.8 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color,
            },
            animated: isDirect,
            opacity: 1,
          };
        }
        return {
          ...e,
          style: { stroke: EDGE_BASE_COLOR, strokeWidth: 1 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: EDGE_BASE_COLOR,
          },
          animated: false,
          opacity: 0.2,
        };
      });
    });
  }, [highlightedNodeId]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode(node);
      setHighlightedNodeId((prev) => (prev === node.id ? null : node.id));
    },
    [edges],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setHighlightedNodeId(null);
  }, []);

  return (
    <div className="w-full h-[calc(100vh-12rem)] flex flex-col gap-2">
      {/* Top controls */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        {/* Mode tabs */}
        <div role="tablist" className="tabs tabs-box tabs-sm">
          <button
            role="tab"
            className={`tab ${mode === "database" ? "tab-active" : ""}`}
            onClick={() => setMode("database")}
          >
            Database Tables
          </button>
          <button
            role="tab"
            className={`tab ${mode === "endpoints" ? "tab-active" : ""}`}
            onClick={() => setMode("endpoints")}
          >
            API Endpoints
          </button>
        </div>

        {/* Database-mode controls */}
        {mode === "database" && (
          <VersionSelector
            majorVersions={SORTED_MAJOR_KEYS}
            selectedMajor={selectedMajor}
            onMajorChange={(major) => {
              setSelectedMajor(major);
              setDbVersion(MAJOR_VERSIONS[major]?.latest ?? "");
            }}
            versions={minorVersionsForMajor}
            selected={dbVersion}
            onChange={setDbVersion}
          />
        )}

        {/* Endpoint-mode controls */}
        {mode === "endpoints" && (
          <ApiGroupNav
            groups={groupList}
            selectedGroup={selectedGroup}
            onGroupChange={(g) => {
              setSelectedGroup(g);
              setSelectedEndpoint("");
            }}
            endpoints={endpointList}
            selectedEndpoint={selectedEndpoint}
            onEndpointChange={setSelectedEndpoint}
          />
        )}

        {/* Endpoint version selector */}
        {mode === "endpoints" && endpointVersionList.length > 0 && (
          <VersionSelector
            versions={endpointVersionList}
            selected={endpointVersion}
            onChange={setEndpointVersion}
            labels={endpointVersionLabels}
            label="Version:"
          />
        )}

        {/* Stats */}
        <div className="ml-auto text-xs text-base-content/50">
          {nodes.length} nodes / {edges.length} edges
        </div>
      </div>

      {/* Layout controls bar */}
      <div className="flex flex-wrap items-center gap-4 px-1">
        {/* Direction */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-base-content/50 font-medium">
            Direction
          </span>
          <div className="join">
            <button
              className={`join-item btn btn-xs ${layoutDir === "LR" ? "btn-neutral" : "btn-ghost"}`}
              onClick={() => setLayoutDir("LR")}
              title="Left to Right"
            >
              LR →
            </button>
            <button
              className={`join-item btn btn-xs ${layoutDir === "TB" ? "btn-neutral" : "btn-ghost"}`}
              onClick={() => setLayoutDir("TB")}
              title="Top to Bottom"
            >
              TB ↓
            </button>
          </div>
        </div>

        {/* Spacing */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-base-content/50 font-medium">
            Spacing
          </span>
          <div className="join">
            {(["compact", "normal", "spacious"] as LayoutSpacing[]).map((s) => (
              <button
                key={s}
                className={`join-item btn btn-xs ${layoutSpacing === s ? "btn-neutral" : "btn-ghost"}`}
                onClick={() => setLayoutSpacing(s)}
              >
                {s === "compact"
                  ? "Compact"
                  : s === "normal"
                    ? "Normal"
                    : "Spacious"}
              </button>
            ))}
          </div>
        </div>

        {/* Edge style */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-base-content/50 font-medium">
            Edge
          </span>
          <div className="join">
            {(["bezier", "smoothstep", "straight"] as EdgeStyle[]).map((es) => (
              <button
                key={es}
                className={`join-item btn btn-xs ${edgeStyle === es ? "btn-neutral" : "btn-ghost"}`}
                onClick={() => setEdgeStyle(es)}
              >
                {es === "bezier"
                  ? "Bezier"
                  : es === "smoothstep"
                    ? "Step"
                    : "Straight"}
              </button>
            ))}
          </div>
        </div>

        {/* Layout algorithm */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-base-content/50 font-medium">
            Algorithm
          </span>
          <div className="join">
            <button
              className={`join-item btn btn-xs ${layoutAlgo === "dagre" ? "btn-neutral" : "btn-ghost"}`}
              onClick={() => setLayoutAlgo("dagre")}
              title="Dagre: 高速・軽量"
            >
              Dagre
            </button>
            <button
              className={`join-item btn btn-xs ${layoutAlgo === "elk-layered" ? "btn-neutral" : "btn-ghost"}`}
              onClick={() => setLayoutAlgo("elk-layered")}
              title="ELK Layered: 交差最小化に優秀"
            >
              ELK
            </button>
            <button
              className={`join-item btn btn-xs ${layoutAlgo === "elk-mrtree" ? "btn-neutral" : "btn-ghost"}`}
              onClick={() => setLayoutAlgo("elk-mrtree")}
              title="ELK MrTree: ツリー構造向け"
            >
              Tree
            </button>
          </div>
        </div>

        {highlightedNodeId && (
          <div className="flex items-center gap-2 ml-auto text-[10px]">
            <span className="text-base-content/50">ノード選択中:</span>
            <span className="font-mono text-primary">{highlightedNodeId}</span>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setHighlightedNodeId(null)}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-1 text-[10px] text-base-content/50">
        {mode === "database" && (
          <>
            <span>
              <span className="inline-block w-2 h-2 rounded-full bg-warning mr-1"></span>
              PK = Primary Key
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded-full bg-secondary mr-1"></span>
              FK = Foreign Key
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded-full bg-info mr-1"></span>
              EV = Env reference
            </span>
            <span>Arrow: FK → referenced PK table</span>
            {Object.keys(dbVersionsMeta.diffs).some((k) =>
              k.endsWith(`_to_${dbVersion}`),
            ) && (
              <>
                <span className="border-l border-base-300 pl-3">
                  <span className="inline-block w-2 h-2 rounded bg-success/30 mr-1"></span>
                  Added
                </span>
                <span>
                  <span className="inline-block w-2 h-2 rounded bg-warning/30 mr-1"></span>
                  Changed
                </span>
              </>
            )}
            <span className="border-l border-base-300 pl-3">
              <span className="inline-block w-2 h-2 rounded border-2 border-warning bg-warning/10 mr-1"></span>
              親テーブル
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded border-2 border-success bg-success/10 mr-1"></span>
              子テーブル
            </span>
            <span className="text-base-content/35">
              (クリックで関連ハイライト)
            </span>
          </>
        )}
        {mode === "endpoints" && (
          <>
            <span>
              <span className="inline-block w-3 h-2 rounded bg-info mr-1"></span>
              Request struct
            </span>
            <span>
              <span className="inline-block w-3 h-2 rounded bg-success mr-1"></span>
              Response struct
            </span>
            <span>
              <span className="inline-block w-3 h-2 rounded bg-neutral mr-1"></span>
              Data type
            </span>
            <span>Arrow: field type → nested struct</span>
            {endpointVersion !== "base" && endpointVersionList.length > 0 && (
              <>
                <span className="border-l border-base-300 pl-3">
                  <span className="inline-block w-2 h-2 rounded bg-success/30 mr-1"></span>
                  + Added
                </span>
                <span>
                  <span className="inline-block w-2 h-2 rounded bg-error/30 mr-1"></span>
                  - Removed
                </span>
                <span>
                  <span className="inline-block w-2 h-2 rounded bg-warning/30 mr-1"></span>
                  ~ Changed
                </span>
                <span className="text-base-content/35">changes from Base</span>
              </>
            )}
          </>
        )}
      </div>

      {/* Graph area */}
      <div className="flex-1 rounded-xl border border-base-300 overflow-hidden relative">
        {nodes.length > 0 ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.1, maxZoom: 1.2 }}
            minZoom={0.02}
            maxZoom={3}
          >
            <Controls />
            <MiniMap
              nodeStrokeWidth={3}
              pannable
              zoomable
              style={{ width: 150, height: 100 }}
            />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          </ReactFlow>
        ) : (
          <div className="flex items-center justify-center h-full text-base-content/40">
            {mode === "endpoints"
              ? "Select an API group and endpoint to view the graph"
              : "No data available"}
          </div>
        )}

        {/* Detail panel overlay */}
        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode}
            mode={mode}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}
