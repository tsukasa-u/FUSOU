/** @jsxImportSource react */
import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  type Node,
  type Edge,
  type NodeTypes,
  Position,
  Handle,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";

// Import ReactFlow CSS directly so it works inside Astro React islands
import "@xyflow/react/dist/style.css";

/**
 * FormulaTree — ReactFlow-based AST visualization of a sympy expression.
 *
 * Accepts the `ast_tree` field from a FormulaArtifact JSON.
 */

export interface ASTNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: {
    label: string;
    type: string; // "operator" | "symbol" | "constant" | "function" | "variable"
    latex?: string;
  };
}

export interface ASTEdge {
  id: string;
  source: string;
  target: string;
}

export interface FormulaTreeProps {
  nodes: ASTNode[];
  edges: ASTEdge[];
  /** Width of the container */
  width?: string | number;
  /** Height of the container */
  height?: string | number;
}

// Node type colors
const TYPE_COLORS: Record<string, string> = {
  operator: "#6366f1", // indigo
  function: "#f59e0b", // amber
  symbol: "#10b981",   // emerald
  constant: "#6b7280", // gray
};

/**
 * Custom node component for the formula AST.
 */
function ASTNodeComponent({ data }: { data: { label: string; type: string } }) {
  const bg = TYPE_COLORS[data.type] || "#6b7280";

  return (
    <div
      style={{
        padding: "6px 12px",
        borderRadius: "8px",
        backgroundColor: bg,
        color: "white",
        fontSize: "12px",
        fontWeight: 600,
        fontFamily: "monospace",
        textAlign: "center",
        minWidth: "40px",
        border: "2px solid rgba(255,255,255,0.3)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      {data.label}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  astNode: ASTNodeComponent,
};

/**
 * Apply dagre layout to position nodes in a tree structure.
 */
function layoutNodes(
  nodes: ASTNode[],
  edges: ASTEdge[]
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 30, ranksep: 50 });

  for (const node of nodes) {
    g.setNode(node.id, { width: 80, height: 40 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes: Node[] = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      id: node.id,
      type: "astNode",
      position: {
        x: (pos?.x ?? 0) - 40,
        y: (pos?.y ?? 0) - 20,
      },
      data: node.data,
    };
  });

  const layoutedEdges: Edge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    style: { stroke: "#9ca3af", strokeWidth: 1.5 },
    animated: false,
  }));

  return { nodes: layoutedNodes, edges: layoutedEdges };
}

export function FormulaTree({
  nodes: rawNodes,
  edges: rawEdges,
  width = "100%",
  height = 400,
}: FormulaTreeProps) {
  const { nodes, edges } = useMemo(
    () => layoutNodes(rawNodes, rawEdges),
    [rawNodes, rawEdges]
  );

  if (rawNodes.length === 0) {
    return (
      <div className="text-center py-8 text-base-content/50">
        AST ツリーデータがありません
      </div>
    );
  }

  return (
    <div style={{ width, height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Controls position="top-right" />
        <MiniMap
          nodeStrokeWidth={3}
          nodeColor={(n: Node) => {
            const type = (n.data as any)?.type || "constant";
            return TYPE_COLORS[type] || "#6b7280";
          }}
        />
        <Background gap={16} size={1} />
      </ReactFlow>
    </div>
  );
}

/**
 * Legend for the AST node types.
 */
export function FormulaTreeLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {Object.entries(TYPE_COLORS).map(([type, color]) => (
        <span key={type} className="flex items-center gap-1">
          <span
            className="inline-block w-3 h-3 rounded"
            style={{ backgroundColor: color }}
          />
          {type}
        </span>
      ))}
    </div>
  );
}
