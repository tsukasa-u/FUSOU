/** @jsxImportSource react */
import {
  Chart as ChartJS,
  LinearScale,
  CategoryScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(LinearScale, CategoryScale, BarElement, Tooltip, Legend);

export interface FeatureRanking {
  name: string;
  mi_score: number;
  tree_importance: number;
  permutation_importance: number;
  combined_rank: number;
}

export interface FeatureSelectionData {
  target_col: string;
  all_features: string[];
  selected_features: string[];
  rankings: FeatureRanking[];
  metadata?: Record<string, any>;
}

export interface DataSummary {
  n_rows: number;
  n_features: number;
  target_stats: {
    mean: number;
    std: number;
    min: number;
    max: number;
  };
}

export interface DataSource {
  type: "sdk" | "csv" | "synthetic" | "unknown";
  tables?: string[];
  table_descriptions?: Record<string, string>;
  column_descriptions?: Record<string, string>;
  csv_path?: string;
  formula_description?: string;
  note?: string;
}

export interface AnalysisContextProps {
  /** Display name (e.g. "synthetic_target") */
  target: string;
  featureSelection: FeatureSelectionData | null;
  dataSummary: DataSummary | null;
  pipelineConfig?: Record<string, any>;
  dataSource?: DataSource | null;
}

/**
 * AnalysisContext — prominently explains:
 *   1. What dataset columns are involved (actual field names)
 *   2. Why each variable was selected or rejected (scores vs threshold)
 *   3. Human-readable summary so anyone can understand the analysis at a glance
 */
export function AnalysisContext({
  target,
  featureSelection,
  dataSummary,
  pipelineConfig,
  dataSource,
}: AnalysisContextProps) {
  const targetCol = featureSelection?.target_col ?? target;
  const allFeatures = featureSelection?.all_features ?? [];
  const selectedFeatures = featureSelection?.selected_features ?? [];
  const threshold = pipelineConfig?.fs_selection_threshold ?? 0.05;

  const colDescs = dataSource?.column_descriptions ?? {};

  return (
    <div className="space-y-5">
      {/* ─── 0. Data Source Alert ─── */}
      <DataSourceBanner
        dataSource={dataSource ?? null}
        targetCol={targetCol}
        allFeatures={allFeatures}
      />

      {/* ─── 1. What Is This Analysis? ─── */}
      <div className="bg-base-300 rounded-lg p-4 border-l-4 border-primary">
        <h3 className="font-bold text-base mb-2">この解析について</h3>
        <p className="text-sm leading-relaxed">
          {dataSource?.type === "sdk" && dataSource.tables && (
            <>
              {"fusou-datasets の "}
              {dataSource.tables.map((t, i) => (
                <span key={t}>
                  {i > 0 && " + "}
                  <code className="bg-base-100 px-1.5 py-0.5 rounded font-bold text-accent">
                    {t}
                  </code>
                  {dataSource.table_descriptions?.[t] && (
                    <span className="text-xs text-base-content/60">
                      ({dataSource.table_descriptions[t]})
                    </span>
                  )}
                </span>
              ))}
              {" テーブルから、"}
            </>
          )}
          {dataSource?.type === "csv" && dataSource.csv_path && (
            <>
              {"CSV ファイル "}
              <code className="bg-base-100 px-1.5 py-0.5 rounded font-bold">
                {dataSource.csv_path}
              </code>
              {" から、"}
            </>
          )}
          {"カラム "}
          <code className="bg-base-100 px-1.5 py-0.5 rounded font-bold text-primary">
            {targetCol}
          </code>
          {colDescs[targetCol] && (
            <span className="text-xs text-base-content/60">
              （{colDescs[targetCol]}）
            </span>
          )}
          {" を"}
          <strong>目的変数</strong>として、
          {allFeatures.length > 0 ? (
            <>
              {"候補となる入力カラム "}
              {allFeatures.map((f, i) => (
                <span key={f}>
                  {i > 0 && "、"}
                  <code className="bg-base-100 px-1 py-0.5 rounded">
                    {f}
                  </code>
                  {colDescs[f] && (
                    <span className="text-xs text-base-content/60">
                      ({colDescs[f]})
                    </span>
                  )}
                </span>
              ))}
              {" の中から統計的に有意な変数を自動選択し、"}
            </>
          ) : (
            "入力変数から"
          )}
          <code className="bg-base-100 px-1.5 py-0.5 rounded font-bold text-primary">
            {targetCol}
          </code>{" "}
          を最もよく説明する数式を抽出しました。
        </p>

        {dataSummary && (
          <p className="text-xs text-base-content/60 mt-2">
            データ: {dataSummary.n_rows.toLocaleString()}行 ×{" "}
            {dataSummary.n_features + 1}列 (入力カラム{dataSummary.n_features}
            個 + 目的カラム1個)
          </p>
        )}
      </div>

      {/* ─── 2. Column Map: Target + Inputs ─── */}
      <div className="bg-base-300 rounded-lg p-4">
        <h3 className="font-bold text-sm mb-3">データセットのカラム構成</h3>

        {/* Target column */}
        <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg mb-3 border border-primary/30">
          <div className="shrink-0">
            <span className="badge badge-primary badge-md font-bold">
              目的変数 (Y)
            </span>
          </div>
          <div>
            <span className="font-mono font-bold text-base">{targetCol}</span>
            {colDescs[targetCol] && (
              <span className="text-xs text-base-content/60 ml-2">
                ({colDescs[targetCol]})
              </span>
            )}
            {dataSummary && (
              <span className="text-xs text-base-content/60 ml-2">
                (平均: {dataSummary.target_stats.mean.toFixed(2)}, 範囲:{" "}
                {dataSummary.target_stats.min.toFixed(2)} 〜{" "}
                {dataSummary.target_stats.max.toFixed(2)})
              </span>
            )}
          </div>
        </div>

        {/* Input columns table */}
        {featureSelection && featureSelection.rankings.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table table-sm table-zebra w-full">
              <thead>
                <tr>
                  <th>カラム名</th>
                  <th>説明</th>
                  <th>役割</th>
                  <th className="text-right">統合スコア</th>
                  <th className="text-right">閾値 ({threshold})</th>
                  <th>判定</th>
                </tr>
              </thead>
              <tbody>
                {featureSelection.rankings
                  .slice()
                  .sort((a, b) => b.combined_rank - a.combined_rank)
                  .map((rk) => {
                    const isSelected = selectedFeatures.includes(rk.name);
                    return (
                      <tr
                        key={rk.name}
                        className={isSelected ? "" : "opacity-60"}
                      >
                        <td className="font-mono font-bold">{rk.name}</td>
                        <td className="text-xs text-base-content/60">
                          {colDescs[rk.name] || "—"}
                        </td>
                        <td>
                          <span
                            className={`badge badge-xs ${
                              isSelected ? "badge-success" : "badge-ghost"
                            }`}
                          >
                            {isSelected ? "入力変数 (X)" : "不使用"}
                          </span>
                        </td>
                        <td className="text-right font-mono">
                          {rk.combined_rank.toFixed(4)}
                        </td>
                        <td className="text-right">
                          {isSelected ? (
                            <span className="text-success">
                              {"\u2265"} {threshold} {"\u2713"}
                            </span>
                          ) : (
                            <span className="text-error">
                              {"<"} {threshold} {"\u2717"}
                            </span>
                          )}
                        </td>
                        <td>
                          {isSelected ? (
                            <span className="text-success font-bold">採用</span>
                          ) : (
                            <span className="text-base-content/40">除外</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── 3. Why: Selection reasoning per variable ─── */}
      {featureSelection && featureSelection.rankings.length > 0 && (
        <div className="bg-base-300 rounded-lg p-4">
          <h3 className="font-bold text-sm mb-3">
            各カラムの選択理由
          </h3>

          <div className="space-y-3">
            {featureSelection.rankings
              .slice()
              .sort((a, b) => b.combined_rank - a.combined_rank)
              .map((rk) => {
                const isSelected = selectedFeatures.includes(rk.name);
                return (
                  <SelectionReasonCard
                    key={rk.name}
                    ranking={rk}
                    isSelected={isSelected}
                    threshold={threshold}
                    targetCol={targetCol}
                    colDesc={colDescs[rk.name]}
                    targetDesc={colDescs[targetCol]}
                  />
                );
              })}
          </div>
        </div>
      )}

      {/* ─── 4. Feature importance chart ─── */}
      {featureSelection && featureSelection.rankings.length > 0 && (
        <FeatureImportanceChart
          rankings={featureSelection.rankings}
          selected={selectedFeatures}
          threshold={threshold}
        />
      )}

      {/* ─── 5. Method explanation (collapsed) ─── */}
      {featureSelection && (
        <details className="bg-base-300 rounded-lg p-4">
          <summary className="font-bold text-sm cursor-pointer select-none">
            変数選択の手法について（詳細）
          </summary>
          <div className="mt-3 text-xs text-base-content/70 leading-relaxed space-y-2">
            <p>
              3つの独立した手法で各カラムの重要度を評価し、正規化して統合スコアを算出。
              統合スコアが閾値（{threshold}）以上のカラムのみを入力変数として採用しています。
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>相互情報量 (MI)</strong> — 目的変数 <code>{targetCol}</code> との非線形な統計的依存関係を測定。
                値が大きいほど情報量が多い。
              </li>
              <li>
                <strong>ツリー重要度</strong> — ランダムフォレスト（{pipelineConfig?.fs_n_estimators ?? 200}本）
                の不純度低減量。モデル内での利用頻度と効果を反映。
              </li>
              <li>
                <strong>置換重要度</strong> — カラムの値をシャッフルした時のモデル性能低下量。
                因果的な貢献度の指標。
              </li>
            </ul>
            {featureSelection.metadata?.oob_r2 != null && (
              <p className="mt-1">
                ランダムフォレストの Out-of-Bag R²:{" "}
                <strong>
                  {Number(featureSelection.metadata.oob_r2).toFixed(4)}
                </strong>
                {Number(featureSelection.metadata.oob_r2) > 0.8
                  ? "（良好 — 特徴量の評価が信頼できます）"
                  : "（低め — 特徴量の評価にやや不確実性があります）"}
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

/**
 * Banner showing the data source type prominently.
 * For synthetic data, displays a warning that the data is not from real tables.
 */
function DataSourceBanner({
  dataSource,
  targetCol,
  allFeatures,
}: {
  dataSource: DataSource | null;
  targetCol: string;
  allFeatures: string[];
}) {
  if (!dataSource) return null;

  if (dataSource.type === "synthetic") {
    return (
      <div className="bg-warning/10 border border-warning/40 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-warning text-xl">⚠️</span>
          <div>
            <h3 className="font-bold text-sm text-warning mb-1">
              合成テストデータ（fusou-datasets のテーブルではありません）
            </h3>
            <p className="text-xs text-base-content/70 leading-relaxed">
              この解析はパイプラインの動作検証用に生成した<strong>合成（ダミー）データ</strong>に対して実行されました。
              カラム名{" "}
              <code className="bg-base-100 px-1 rounded">{targetCol}</code>
              {allFeatures.map((f) => (
                <span key={f}>
                  , <code className="bg-base-100 px-1 rounded">{f}</code>
                </span>
              ))}
              {" は fusou-datasets のテーブルのフィールドとは<strong>一切関係ありません</strong>。"}
            </p>
            {dataSource.formula_description && (
              <p className="text-xs text-base-content/60 mt-1">
                生成式: <code className="bg-base-100 px-1 rounded">{dataSource.formula_description}</code>
              </p>
            )}
            {dataSource.note && (
              <p className="text-xs text-base-content/60 mt-1">
                {dataSource.note}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (dataSource.type === "sdk") {
    return (
      <div className="bg-info/10 border border-info/40 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-info text-xl">📊</span>
          <div>
            <h3 className="font-bold text-sm text-info mb-1">
              fusou-datasets SDK データ
            </h3>
            {dataSource.tables && dataSource.tables.length > 0 && (
              <div className="text-xs text-base-content/70 leading-relaxed">
                <p className="mb-1">ソーステーブル:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {dataSource.tables.map((t) => (
                    <li key={t}>
                      <code className="bg-base-100 px-1 rounded font-bold">{t}</code>
                      {dataSource.table_descriptions?.[t] && (
                        <span className="text-base-content/60">
                          {" — "}{dataSource.table_descriptions[t]}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (dataSource.type === "csv") {
    return (
      <div className="bg-info/10 border border-info/40 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-info text-xl">📄</span>
          <div>
            <h3 className="font-bold text-sm text-info mb-1">
              CSV ファイルからの入力
            </h3>
            {dataSource.csv_path && (
              <p className="text-xs text-base-content/70">
                ファイル: <code className="bg-base-100 px-1 rounded">{dataSource.csv_path}</code>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Unknown
  return (
    <div className="bg-base-300 border border-base-content/20 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <span className="text-base-content/40 text-xl">❓</span>
        <div>
          <h3 className="font-bold text-sm text-base-content/60 mb-1">
            データソース不明
          </h3>
          <p className="text-xs text-base-content/50">
            このアーティファクトにはデータソース情報が含まれていません。
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Card explaining why a single variable was selected or rejected.
 */
function SelectionReasonCard({
  ranking,
  isSelected,
  threshold,
  targetCol,
  colDesc,
  targetDesc,
}: {
  ranking: FeatureRanking;
  isSelected: boolean;
  threshold: number;
  targetCol: string;
  colDesc?: string;
  targetDesc?: string;
}) {
  const { name, mi_score, tree_importance, permutation_importance, combined_rank } =
    ranking;

  // Build human-readable reason
  const nameLabel = colDesc ? `${name}（${colDesc}）` : name;
  const targetLabel = targetDesc ? `${targetCol}（${targetDesc}）` : targetCol;
  let reason: string;
  if (isSelected) {
    const reasons: string[] = [];
    if (mi_score > 0.5) reasons.push("高い相互情報量");
    if (tree_importance > 0.3) reasons.push("高いツリー重要度");
    if (permutation_importance > 0.3) reasons.push("高い置換重要度");
    if (reasons.length === 0) reasons.push("統合スコアが閾値以上");
    reason = `カラム「${nameLabel}」は統合スコア ${combined_rank.toFixed(4)} で閾値 ${threshold} を上回りました。${reasons.join("・")}を示しており、目的変数「${targetLabel}」と強い関連があるため、数式の入力変数として採用しました。`;
  } else {
    reason = `カラム「${nameLabel}」は統合スコア ${combined_rank.toFixed(4)} で閾値 ${threshold} を下回りました。3つの評価手法（MI=${mi_score.toFixed(4)}, ツリー=${tree_importance.toFixed(4)}, 置換=${permutation_importance.toFixed(4)}）いずれにおいても目的変数「${targetLabel}」との関連が弱く、数式に含めても精度改善に寄与しないため除外しました。`;
  }

  return (
    <div
      className={`rounded-lg p-3 border ${
        isSelected
          ? "bg-success/5 border-success/30"
          : "bg-base-200 border-base-content/10"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <code className="font-bold text-sm">{name}</code>
        <span
          className={`badge badge-xs ${
            isSelected ? "badge-success" : "badge-ghost"
          }`}
        >
          {isSelected ? "\u2713 採用" : "\u2717 除外"}
        </span>
      </div>
      <p className="text-xs text-base-content/70 leading-relaxed">{reason}</p>
      <div className="flex gap-3 mt-2 text-[10px] text-base-content/50 font-mono">
        <span>MI: {mi_score.toFixed(4)}</span>
        <span>Tree: {tree_importance.toFixed(4)}</span>
        <span>Perm: {permutation_importance.toFixed(4)}</span>
        <span className="font-bold">Combined: {combined_rank.toFixed(4)}</span>
      </div>
    </div>
  );
}

/**
 * Horizontal bar chart showing feature importance by three methods.
 */
function FeatureImportanceChart({
  rankings,
  selected,
  threshold,
}: {
  rankings: FeatureRanking[];
  selected: string[];
  threshold: number;
}) {
  const sorted = [...rankings].sort(
    (a, b) => b.combined_rank - a.combined_rank
  );
  const labels = sorted.map((r) => r.name);

  const chartData = {
    labels,
    datasets: [
      {
        label: "相互情報量 (MI)",
        data: sorted.map((r) => r.mi_score),
        backgroundColor: "rgba(99, 102, 241, 0.6)",
        borderColor: "rgba(99, 102, 241, 1)",
        borderWidth: 1,
      },
      {
        label: "ツリー重要度",
        data: sorted.map((r) => r.tree_importance),
        backgroundColor: "rgba(16, 185, 129, 0.6)",
        borderColor: "rgba(16, 185, 129, 1)",
        borderWidth: 1,
      },
      {
        label: "置換重要度",
        data: sorted.map((r) => r.permutation_importance),
        backgroundColor: "rgba(245, 158, 11, 0.6)",
        borderColor: "rgba(245, 158, 11, 1)",
        borderWidth: 1,
      },
    ],
  };

  const options = {
    indexAxis: "y" as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        labels: { font: { size: 11 } },
      },
      tooltip: {
        callbacks: {
          afterLabel: (ctx: any) => {
            const name = labels[ctx.dataIndex];
            const rk = sorted[ctx.dataIndex];
            const sel = selected.includes(name);
            return [
              sel ? "\u2713 採用" : "\u2717 除外",
              `統合スコア: ${rk.combined_rank.toFixed(4)} (閾値: ${threshold})`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: "スコア（正規化済み）" },
        beginAtZero: true,
      },
      y: {
        ticks: {
          font: { family: "monospace", size: 12 },
          color: (ctx: any) => {
            const name = labels[ctx.index];
            return selected.includes(name)
              ? "rgba(16, 185, 129, 1)"
              : "rgba(156, 163, 175, 0.6)";
          },
        },
      },
    },
  };

  const height = Math.max(200, sorted.length * 50 + 80);

  return (
    <div className="bg-base-300 rounded-lg p-4">
      <h3 className="font-bold text-sm mb-1">特徴量重要度の比較</h3>
      <p className="text-xs text-base-content/60 mb-3">
        各カラムの3手法スコア。緑ラベル = 採用された入力変数、灰色 = 除外されたカラム
      </p>
      <div style={{ height: `${height}px` }}>
        <Bar data={chartData} options={options} />
      </div>
    </div>
  );
}

export default AnalysisContext;
