import dagre from "@dagrejs/dagre";
import ELK from "elkjs/lib/elk.bundled.js";
import type { GraphEdge, GraphNode } from "./schemaGraphTypes";

export const NODE_WIDTH = 300;
export const NODE_HEIGHT_BASE = 52;
export const NODE_HEIGHT_PER_FIELD = 24;

export type LayoutDir = "LR" | "TB";
export type LayoutSpacing = "compact" | "normal" | "spacious";
export type LayoutAlgo = "dagre" | "elk-layered" | "elk-mrtree";

export const SPACING_MAP: Record<
  LayoutSpacing,
  { nodesep: number; ranksep: number; edgesep: number }
> = {
  compact: { nodesep: 40, ranksep: 120, edgesep: 30 },
  normal: { nodesep: 80, ranksep: 220, edgesep: 60 },
  spacious: { nodesep: 130, ranksep: 340, edgesep: 90 },
};

export const ELK_SPACING_MAP: Record<
  LayoutSpacing,
  { nodeSpacing: number; layerSpacing: number }
> = {
  compact: { nodeSpacing: 40, layerSpacing: 100 },
  normal: { nodeSpacing: 80, layerSpacing: 200 },
  spacious: { nodeSpacing: 130, layerSpacing: 320 },
};

const elk = new ELK();

export function estimateNodeHeight(node: GraphNode): number {
  const fields = node.data.fields;
  if (Array.isArray(fields)) {
    return NODE_HEIGHT_BASE + fields.length * NODE_HEIGHT_PER_FIELD;
  }
  return NODE_HEIGHT_BASE + 3 * NODE_HEIGHT_PER_FIELD;
}

/**
 * ソースノード内のフィールド定義順（上から下）に合わせてエッジを整列する。
 * これにより、レイアウトエンジンが同一テーブルから出るエッジの接続先をフィールド順に正しく配置し、
 * 上下逆転や交差を防ぐことができる。
 */
export function orderEdgesBySourceFields(
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphEdge[] {
  const fieldIndexMap = new Map<string, Map<string, number>>();
  for (const n of nodes) {
    const fMap = new Map<string, number>();
    const fields = n.data?.fields;
    if (Array.isArray(fields)) {
      fields.forEach((f, i) => fMap.set(f.name, i));
    }
    fieldIndexMap.set(n.id, fMap);
  }

  return [...edges].sort((a, b) => {
    if (a.source !== b.source) return 0;
    const fMap = fieldIndexMap.get(a.source);
    if (!fMap) return 0;
    const aField = a.sourceHandle
      ? a.sourceHandle.replace(`${a.source}-`, "")
      : typeof a.label === "string"
        ? a.label
        : "";
    const bField = b.sourceHandle
      ? b.sourceHandle.replace(`${b.source}-`, "")
      : typeof b.label === "string"
        ? b.label
        : "";
    const aIdx = fMap.has(aField) ? fMap.get(aField)! : 0;
    const bIdx = fMap.has(bField) ? fMap.get(bField)! : 0;
    return aIdx - bIdx;
  });
}

export function applyDagreLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: LayoutDir = "LR",
  spacing: LayoutSpacing = "normal",
): GraphNode[] {
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
  const orderedEdges = orderEdgesBySourceFields(nodes, edges);
  for (const edge of orderedEdges) {
    // エンドポイントのレスポンス／ルートノード（__ApiData, __Res など）から直接出るエッジは
    // 重みを高く設定する。これにより、子ノードの探索深度の違い（例: 葉ノードと深層ノード）に
    // よって直下の子ノードが異なるランク（列）に分散配置されて階層またぎの交差が発生するのを防ぎ、
    // 直下の子ノードを親のすぐ次の単一列にフィールド定義順に綺麗に整列させる。
    const isRootEdge =
      edge.source.endsWith("__ApiData") ||
      edge.source.endsWith("__Res") ||
      edge.source.endsWith("__Req") ||
      edge.source.includes("ApiData");
    const weight = isRootEdge ? 10 : 1;
    g.setEdge(edge.source, edge.target, { weight });
  }

  // disableOptimalOrderHeuristic を有効化することで、Dagre の交差最小化スイープ最終段階における
  // タイブレークによる逆順反転（biasRight=true）を防ぎ、ソースフィールドの上から下への並び順を
  // 接続先テーブルの垂直位置にそのまま反映させてエッジ交差を防止する。
  dagre.layout(g, { disableOptimalOrderHeuristic: true });

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
export async function applyElkLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  algo: "elk-layered" | "elk-mrtree",
  direction: LayoutDir,
  spacing: LayoutSpacing,
): Promise<GraphNode[]> {
  if (nodes.length === 0) return nodes;
  const s = ELK_SPACING_MAP[spacing];
  const elkDir = direction === "LR" ? "RIGHT" : "DOWN";
  const orderedEdges = orderEdgesBySourceFields(nodes, edges);

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
    edges: orderedEdges.map((e) => ({
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
