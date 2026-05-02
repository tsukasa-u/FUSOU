/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { cachedFetch } from "@/utility/fetchCache";
import { AlertMessage } from "./common/AlertMessage";

// ── Types ──────────────────────────────────────────────────────────

type QuestRule = {
  rule_id: string;
  target_quest_id: number;
  prereq_set_json: string;
  set_size: number;
  class: string;
  support: number;
  confidence: number;
  lift: number;
  score: number;
  period_tag: string;
  table_version: string;
  is_primary: number;
  quality_tier: string;
  updated_at_ms: number;
};

type GraphEdge = {
  from: number;
  to: number;
  score: number;
  class: string;
};

type GraphData = {
  ok: boolean;
  period_tag: string;
  table_version: string;
  nodes: number[];
  edges: GraphEdge[];
};

type RulesData = {
  ok: boolean;
  target: number;
  period_tag: string;
  table_version: string;
  rules: QuestRule[];
};

// ── Helpers ────────────────────────────────────────────────────────

function parsePrereqSet(json: string): number[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed))
      return parsed.filter((v) => typeof v === "number");
  } catch {}
  return [];
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.9) return "badge-success";
  if (confidence >= 0.75) return "badge-warning";
  return "badge-error";
}

const QUALITY_LABELS: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

// ── SVG DAG (simple force-free layout using topological sort) ──────

interface DagNode {
  id: number;
  x: number;
  y: number;
  depth: number;
}

function computeSimpleLayout(
  nodes: number[],
  edges: GraphEdge[],
  width: number,
): { nodeMap: Map<number, DagNode>; svgHeight: number } {
  // Build adjacency: edges go from prerequisite (from) to target (to)
  const inDegree = new Map<number, number>();
  const outEdges = new Map<number, number[]>();
  for (const n of nodes) {
    inDegree.set(n, 0);
    outEdges.set(n, []);
  }
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    outEdges.get(e.from)?.push(e.to);
  }

  // Kahn's algorithm to assign depth layers
  const depth = new Map<number, number>();
  const queue: number[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n) ?? 0) === 0) {
      queue.push(n);
      depth.set(n, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const d = depth.get(current) ?? 0;
    for (const next of outEdges.get(current) ?? []) {
      const nextDepth = Math.max(depth.get(next) ?? 0, d + 1);
      depth.set(next, nextDepth);
      inDegree.set(next, (inDegree.get(next) ?? 1) - 1);
      if (inDegree.get(next) === 0) {
        queue.push(next);
      }
    }
  }

  // Group nodes by depth
  const layers = new Map<number, number[]>();
  for (const [id, d] of depth.entries()) {
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d)!.push(id);
  }

  const NODE_W = 60;
  const NODE_H = 30;
  const X_GAP = 90;
  const Y_GAP = 60;

  const nodeMap = new Map<number, DagNode>();
  let maxY = 0;

  for (const [d, layerNodes] of layers.entries()) {
    const totalW = layerNodes.length * X_GAP;
    const startX = Math.max(20, (width - totalW) / 2);
    layerNodes.forEach((id, i) => {
      const x = startX + i * X_GAP;
      const y = 40 + d * Y_GAP;
      nodeMap.set(id, { id, x, y, depth: d });
      if (y > maxY) maxY = y;
    });
  }

  return { nodeMap, svgHeight: maxY + NODE_H + 30 };
}

// ── Component ──────────────────────────────────────────────────────

export default function QuestTreePanel() {
  const [periodTag] = createSignal("latest");
  const [tableVersion] = createSignal("0.5");
  const [targetInput, setTargetInput] = createSignal("");
  const [graphData, setGraphData] = createSignal<GraphData | null>(null);
  const [rulesData, setRulesData] = createSignal<RulesData | null>(null);
  const [loadingGraph, setLoadingGraph] = createSignal(false);
  const [loadingRules, setLoadingRules] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<"rules" | "graph">("rules");

  const SVG_WIDTH = 900;

  const dagLayout = createMemo(() => {
    const g = graphData();
    if (!g || g.nodes.length === 0) return null;
    // Limit graph for very large data sets
    const limitedNodes = g.nodes.slice(0, 200);
    const limitedEdges = g.edges.filter(
      (e) => limitedNodes.includes(e.from) && limitedNodes.includes(e.to),
    );
    return computeSimpleLayout(limitedNodes, limitedEdges, SVG_WIDTH);
  });

  async function fetchGraph() {
    setLoadingGraph(true);
    setError(null);
    try {
      const url = `/api/quest-tree/graph?period_tag=${encodeURIComponent(periodTag())}&table_version=${encodeURIComponent(tableVersion())}`;
      const res = await cachedFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as GraphData;
      if (!json.ok) throw new Error("Unexpected response");
      setGraphData(json);
    } catch (e) {
      setError(
        `グラフデータの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setLoadingGraph(false);
    }
  }

  async function fetchRules() {
    const target = parseInt(targetInput().trim(), 10);
    if (!Number.isFinite(target) || target <= 0) {
      setError("クエストIDを入力してください");
      return;
    }

    setLoadingRules(true);
    setError(null);
    try {
      const url = `/api/quest-tree/rules?target=${target}&period_tag=${encodeURIComponent(periodTag())}&table_version=${encodeURIComponent(tableVersion())}`;
      const res = await cachedFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as RulesData;
      if (!json.ok) throw new Error("Unexpected response");
      setRulesData(json);
    } catch (e) {
      setError(
        `ルールデータの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setLoadingRules(false);
    }
  }

  onMount(() => {
    fetchGraph();
  });

  return (
    <div class="space-y-6">
      {/* View toggle */}
      <div class="flex gap-2">
        <button
          class={`btn btn-sm ${viewMode() === "rules" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setViewMode("rules")}
        >
          条件ルール検索
        </button>
        <button
          class={`btn btn-sm ${viewMode() === "graph" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => {
            setViewMode("graph");
            if (!graphData()) fetchGraph();
          }}
        >
          全体グラフ
        </button>
      </div>

      <Show when={error()}>
        <AlertMessage type="error">{error()}</AlertMessage>
      </Show>

      {/* Rules view */}
      <Show when={viewMode() === "rules"}>
        <div class="card bg-base-100 shadow-sm">
          <div class="card-body">
            <h2 class="card-title text-lg">クエスト達成条件ルール</h2>
            <p class="text-sm text-base-content/60">
              特定のクエストIDに対する、マイニングされた達成条件ルールを表示します。
            </p>
            <div class="flex gap-2 items-end mt-2">
              <div class="form-control">
                <label class="label">
                  <span class="label-text">ターゲットクエストID</span>
                </label>
                <input
                  type="number"
                  class="input input-bordered input-sm w-36"
                  placeholder="例: 854"
                  value={targetInput()}
                  onInput={(e) => setTargetInput(e.currentTarget.value)}
                  min="1"
                  onKeyDown={(e) => e.key === "Enter" && fetchRules()}
                />
              </div>
              <button
                class="btn btn-primary btn-sm"
                disabled={loadingRules()}
                onClick={fetchRules}
              >
                <Show when={loadingRules()}>
                  <span class="loading loading-spinner loading-xs" />
                </Show>
                検索
              </button>
            </div>
          </div>
        </div>

        <Show when={rulesData()}>
          {(data) => (
            <div class="card bg-base-100 shadow-sm">
              <div class="card-body">
                <h2 class="card-title text-lg">
                  クエスト {data().target} の達成条件
                  <span class="badge badge-neutral ml-2">
                    {data().rules.length} ルール
                  </span>
                </h2>
                <p class="text-sm text-base-content/60">
                  期間: {data().period_tag} / v{data().table_version}
                </p>
                <Show when={data().rules.length === 0}>
                  <p class="text-base-content/50 mt-4">
                    このクエストのルールが見つかりません。
                  </p>
                </Show>
                <div class="space-y-3 mt-2">
                  <For each={data().rules}>
                    {(rule) => {
                      const prereqs = parsePrereqSet(rule.prereq_set_json);
                      return (
                        <div class="border border-base-300 rounded-lg p-4">
                          <div class="flex flex-wrap gap-2 items-center mb-2">
                            <Show when={rule.is_primary === 1}>
                              <span class="badge badge-primary badge-sm">
                                primary
                              </span>
                            </Show>
                            <span
                              class={`badge badge-sm ${confidenceColor(rule.confidence)}`}
                            >
                              信頼度 {(rule.confidence * 100).toFixed(1)}%
                            </span>
                            <span class="badge badge-outline badge-sm">
                              支持度 {(rule.support * 100).toFixed(2)}%
                            </span>
                            <span class="badge badge-outline badge-sm">
                              スコア {rule.score.toFixed(3)}
                            </span>
                            <span class="badge badge-ghost badge-sm">
                              品質:{" "}
                              {QUALITY_LABELS[rule.quality_tier] ??
                                rule.quality_tier}
                            </span>
                          </div>
                          <div class="flex flex-wrap gap-2 items-center">
                            <span class="text-sm text-base-content/60 whitespace-nowrap">
                              前提クエスト:
                            </span>
                            <For each={prereqs}>
                              {(qid) => (
                                <button
                                  class="badge badge-outline hover:badge-primary cursor-pointer text-sm"
                                  onClick={() => {
                                    setTargetInput(String(qid));
                                    fetchRules();
                                  }}
                                >
                                  #{qid}
                                </button>
                              )}
                            </For>
                            <span class="text-base-content/60 text-sm">→</span>
                            <span class="badge badge-secondary">
                              #{rule.target_quest_id}
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </div>
          )}
        </Show>
      </Show>

      {/* Graph view */}
      <Show when={viewMode() === "graph"}>
        <div class="card bg-base-100 shadow-sm">
          <div class="card-body">
            <h2 class="card-title text-lg">
              クエスト依存グラフ
              <Show when={graphData()}>
                {(g) => (
                  <span class="badge badge-neutral ml-2">
                    {g().nodes.length} ノード / {g().edges.length} エッジ
                  </span>
                )}
              </Show>
            </h2>
            <p class="text-sm text-base-content/60">
              マイニングされた primary ルールを有向グラフで表示します。
              ノードをクリックするとそのクエストのルール詳細を表示します。
              <Show when={graphData() && graphData()!.nodes.length > 200}>
                <span class="text-warning"> (最初の200ノードのみ表示)</span>
              </Show>
            </p>
            <Show when={loadingGraph()}>
              <div class="flex justify-center py-16">
                <span class="loading loading-spinner loading-lg" />
              </div>
            </Show>
            <Show when={!loadingGraph() && dagLayout()}>
              {(layout) => {
                const { nodeMap, svgHeight } = layout();
                const g = graphData()!;
                const limitedNodes = g.nodes.slice(0, 200);
                const limitedEdges = g.edges.filter(
                  (e) =>
                    limitedNodes.includes(e.from) &&
                    limitedNodes.includes(e.to),
                );
                return (
                  <div class="w-full overflow-x-auto">
                    <svg
                      width={SVG_WIDTH}
                      height={svgHeight}
                      class="bg-base-200 rounded-lg"
                      style={{ "max-width": "100%" }}
                    >
                      <defs>
                        <marker
                          id="arrowhead"
                          markerWidth="8"
                          markerHeight="6"
                          refX="8"
                          refY="3"
                          orient="auto"
                        >
                          <polygon
                            points="0 0, 8 3, 0 6"
                            fill="oklch(var(--bc)/0.5)"
                          />
                        </marker>
                      </defs>
                      {/* Edges */}
                      <For each={limitedEdges}>
                        {(edge) => {
                          const fromNode = nodeMap.get(edge.from);
                          const toNode = nodeMap.get(edge.to);
                          if (!fromNode || !toNode) return null;
                          const opacity = Math.min(1, 0.3 + edge.score * 0.7);
                          return (
                            <line
                              x1={fromNode.x}
                              y1={fromNode.y}
                              x2={toNode.x}
                              y2={toNode.y - 12}
                              stroke="oklch(var(--bc))"
                              stroke-opacity={opacity}
                              stroke-width="1.5"
                              marker-end="url(#arrowhead)"
                            />
                          );
                        }}
                      </For>
                      {/* Nodes */}
                      <For each={limitedNodes}>
                        {(id) => {
                          const node = nodeMap.get(id);
                          if (!node) return null;
                          return (
                            <g
                              class="cursor-pointer"
                              onClick={() => {
                                setTargetInput(String(id));
                                setViewMode("rules");
                                fetchRules();
                              }}
                            >
                              <rect
                                x={node.x - 26}
                                y={node.y - 12}
                                width={52}
                                height={24}
                                rx={4}
                                class="fill-primary/80 hover:fill-primary"
                              />
                              <text
                                x={node.x}
                                y={node.y + 5}
                                text-anchor="middle"
                                font-size="11"
                                fill="white"
                              >
                                #{id}
                              </text>
                            </g>
                          );
                        }}
                      </For>
                    </svg>
                  </div>
                );
              }}
            </Show>
            <Show when={!loadingGraph() && !dagLayout()}>
              <div class="flex justify-center py-16 text-base-content/50">
                グラフデータが見つかりません
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
