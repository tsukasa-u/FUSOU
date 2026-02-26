/** @jsxImportSource react */
import { useMemo } from "react";
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Scatter } from "react-chartjs-2";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);

export interface ActualVsPredictedPoint {
  actual: number;
  predicted: number;
  features?: Record<string, number>;
}

export interface ActualVsPredictedChartProps {
  data: ActualVsPredictedPoint[];
  targetName?: string;
}

/**
 * Scatter plot comparing actual target values with formula predictions.
 *
 * A perfect model would place all points on the y = x diagonal line.
 */
export function ActualVsPredictedChart({
  data,
  targetName = "target",
}: ActualVsPredictedChartProps) {
  const { points, diagonalLine, r2, metrics } = useMemo(() => {
    if (!data || data.length === 0) return { points: [], diagonalLine: [], r2: 0, metrics: null };

    const pts = data.map((d) => ({ x: d.actual, y: d.predicted }));

    // Compute R² for display
    const actuals = data.map((d) => d.actual);
    const predicted = data.map((d) => d.predicted);
    const meanActual = actuals.reduce((a, b) => a + b, 0) / actuals.length;
    const ssTot = actuals.reduce((s, a) => s + (a - meanActual) ** 2, 0);
    const ssRes = actuals.reduce((s, a, i) => s + (a - predicted[i]) ** 2, 0);
    const r2Val = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    const minVal = Math.min(...actuals, ...predicted);
    const maxVal = Math.max(...actuals, ...predicted);
    const margin = (maxVal - minVal) * 0.05;

    const line = [
      { x: minVal - margin, y: minVal - margin },
      { x: maxVal + margin, y: maxVal + margin },
    ];

    // Aggregate metrics
    const mae = actuals.reduce((s, a, i) => s + Math.abs(a - predicted[i]), 0) / actuals.length;
    const maxError = actuals.reduce(
      (m, a, i) => Math.max(m, Math.abs(a - predicted[i])),
      0
    );

    return {
      points: pts,
      diagonalLine: line,
      r2: r2Val,
      metrics: { mae, maxError, n: data.length },
    };
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-base-content/50">
        実測 vs 予測データがありません
      </div>
    );
  }

  const chartData = {
    datasets: [
      {
        label: `${targetName} (データ点)`,
        data: points,
        backgroundColor: "rgba(59, 130, 246, 0.4)",
        borderColor: "rgba(59, 130, 246, 0.6)",
        pointRadius: 2.5,
        pointHoverRadius: 5,
      },
      {
        label: "理想線 (y = x)",
        data: diagonalLine,
        showLine: true,
        borderColor: "rgba(239, 68, 68, 0.7)",
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        labels: { font: { size: 11 } },
      },
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            if (ctx.datasetIndex === 1) return "";
            const pt = data[ctx.dataIndex];
            const lines = [
              `実測: ${pt.actual.toFixed(4)}`,
              `予測: ${pt.predicted.toFixed(4)}`,
              `誤差: ${(pt.actual - pt.predicted).toFixed(4)}`,
            ];
            if (pt.features) {
              for (const [k, v] of Object.entries(pt.features)) {
                lines.push(`${k}: ${Number(v).toFixed(4)}`);
              }
            }
            return lines;
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: `実測値 (${targetName})` },
        type: "linear" as const,
      },
      y: {
        title: { display: true, text: `予測値 (${targetName})` },
        type: "linear" as const,
      },
    },
  };

  return (
    <div>
      {/* Metrics summary */}
      <div className="flex flex-wrap gap-3 text-xs mb-3">
        <span className="badge badge-outline">
          R² = {r2.toFixed(4)}
        </span>
        {metrics && (
          <>
            <span className="badge badge-outline">
              MAE = {metrics.mae.toFixed(4)}
            </span>
            <span className="badge badge-outline">
              最大誤差 = {metrics.maxError.toFixed(4)}
            </span>
            <span className="badge badge-outline">
              N = {metrics.n.toLocaleString()}
            </span>
          </>
        )}
      </div>

      {/* Chart */}
      <div style={{ height: "360px" }}>
        <Scatter data={chartData} options={options} />
      </div>

      <p className="text-xs text-base-content/50 mt-2 text-center">
        点が赤い対角線に近いほど予測精度が高いことを意味します
      </p>
    </div>
  );
}

export default ActualVsPredictedChart;
