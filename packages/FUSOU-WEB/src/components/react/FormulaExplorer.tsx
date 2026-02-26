/** @jsxImportSource react */
import { useState, useCallback } from "react";

/**
 * FormulaExplorer — interactive SQL-like query interface for formula artifacts.
 *
 * Provides a simple filter + detail view over the formula data.
 * In the future, this can be upgraded to use DuckDB-WASM for full SQL queries.
 */

export interface FormulaArtifactData {
  id: string;
  target: string;
  status: string;
  best_formula: {
    latex: string;
    sympy_str: string;
    complexity: number;
    coefficients: Record<string, number>;
  };
  pareto_front: Array<{
    complexity: number;
    loss: number;
    latex: string;
  }>;
  validation: {
    metrics: {
      mae: number;
      rmse: number;
      interval_accuracy: number;
      n_samples: number;
    };
  };
}

export interface FormulaExplorerProps {
  artifact: FormulaArtifactData;
}

export function FormulaExplorer({ artifact }: FormulaExplorerProps) {
  const [activeTab, setActiveTab] = useState<
    "overview" | "pareto" | "coefficients" | "raw"
  >("overview");

  return (
    <div className="bg-base-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold mb-3">数式データエクスプローラ</h3>

      {/* Tabs */}
      <div role="tablist" className="tabs tabs-boxed mb-4">
        <button
          role="tab"
          className={`tab ${activeTab === "overview" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          概要
        </button>
        <button
          role="tab"
          className={`tab ${activeTab === "pareto" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("pareto")}
        >
          パレートフロント
        </button>
        <button
          role="tab"
          className={`tab ${activeTab === "coefficients" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("coefficients")}
        >
          係数
        </button>
        <button
          role="tab"
          className={`tab ${activeTab === "raw" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("raw")}
        >
          生データ
        </button>
      </div>

      {/* Content */}
      {activeTab === "overview" && <OverviewTab artifact={artifact} />}
      {activeTab === "pareto" && <ParetoTab pareto={artifact.pareto_front} />}
      {activeTab === "coefficients" && (
        <CoefficientsTab
          coefficients={artifact.best_formula?.coefficients || {}}
        />
      )}
      {activeTab === "raw" && <RawTab artifact={artifact} />}
    </div>
  );
}

function OverviewTab({ artifact }: { artifact: FormulaArtifactData }) {
  const metrics = artifact.validation?.metrics;

  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <tbody>
          <tr>
            <th className="font-semibold">Target</th>
            <td>{artifact.target}</td>
          </tr>
          <tr>
            <th className="font-semibold">Status</th>
            <td>{artifact.status}</td>
          </tr>
          <tr>
            <th className="font-semibold">SymPy</th>
            <td className="font-mono text-sm">
              {artifact.best_formula?.sympy_str || "N/A"}
            </td>
          </tr>
          <tr>
            <th className="font-semibold">Complexity</th>
            <td>{artifact.best_formula?.complexity || "N/A"}</td>
          </tr>
          {metrics && (
            <>
              <tr>
                <th className="font-semibold">MAE</th>
                <td>{metrics.mae.toFixed(4)}</td>
              </tr>
              <tr>
                <th className="font-semibold">RMSE</th>
                <td>{metrics.rmse.toFixed(4)}</td>
              </tr>
              <tr>
                <th className="font-semibold">区間精度</th>
                <td>{(metrics.interval_accuracy * 100).toFixed(1)}%</td>
              </tr>
              <tr>
                <th className="font-semibold">サンプル数</th>
                <td>{metrics.n_samples.toLocaleString()}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ParetoTab({
  pareto,
}: {
  pareto: Array<{ complexity: number; loss: number; latex: string }>;
}) {
  if (!pareto || pareto.length === 0) {
    return <p className="text-sm text-base-content/50">データなし</p>;
  }

  return (
    <div className="overflow-x-auto max-h-80">
      <table className="table table-sm table-pin-rows">
        <thead>
          <tr>
            <th>#</th>
            <th>Complexity</th>
            <th>Loss</th>
            <th>Formula</th>
          </tr>
        </thead>
        <tbody>
          {pareto.map((p, i) => (
            <tr key={i} className="hover">
              <td>{i + 1}</td>
              <td>{p.complexity}</td>
              <td>{p.loss.toExponential(3)}</td>
              <td className="font-mono text-xs max-w-xs truncate">{p.latex}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoefficientsTab({
  coefficients,
}: {
  coefficients: Record<string, number>;
}) {
  const entries = Object.entries(coefficients);
  if (entries.length === 0) {
    return <p className="text-sm text-base-content/50">最適化された係数なし</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>パラメータ</th>
            <th>値</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <td className="font-mono">{key}</td>
              <td>
                {typeof value === "number" ? value.toFixed(6) : String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RawTab({ artifact }: { artifact: FormulaArtifactData }) {
  const [copied, setCopied] = useState(false);

  const json = JSON.stringify(artifact, null, 2);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [json]);

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button className="btn btn-xs btn-ghost" onClick={copyToClipboard}>
          {copied ? "コピー済み ✓" : "JSON をコピー"}
        </button>
      </div>
      <pre className="bg-base-300 rounded p-3 text-xs overflow-auto max-h-96 font-mono">
        {json}
      </pre>
    </div>
  );
}
