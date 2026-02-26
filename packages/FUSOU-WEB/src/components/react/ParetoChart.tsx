/** @jsxImportSource react */
import {
  Chart as ChartJS,
  LinearScale,
  LogarithmicScale,
  PointElement,
  Tooltip,
  Legend,
  LineElement,
} from "chart.js";
import { Scatter } from "react-chartjs-2";

ChartJS.register(LinearScale, LogarithmicScale, PointElement, LineElement, Tooltip, Legend);

export interface ParetoPoint {
  complexity: number;
  loss: number;
  latex: string;
  sympy_str: string;
}

export interface ParetoChartProps {
  data: ParetoPoint[];
  /** Index of the selected/best point (highlighted) */
  bestIndex?: number;
}

export function ParetoChart({ data, bestIndex }: ParetoChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-base-content/50">
        パレートフロントデータがありません
      </div>
    );
  }

  const points = data.map((p) => ({
    x: p.complexity,
    y: p.loss,
  }));

  const bestPoints =
    bestIndex != null && bestIndex >= 0 && bestIndex < data.length
      ? [{ x: data[bestIndex].complexity, y: data[bestIndex].loss }]
      : [];

  const chartData = {
    datasets: [
      {
        label: "Pareto Front",
        data: points,
        backgroundColor: "rgba(99, 102, 241, 0.6)",
        borderColor: "rgba(99, 102, 241, 1)",
        pointRadius: 6,
        pointHoverRadius: 9,
        showLine: true,
        borderDash: [5, 5],
        borderWidth: 1,
      },
      ...(bestPoints.length > 0
        ? [
            {
              label: "Best",
              data: bestPoints,
              backgroundColor: "rgba(239, 68, 68, 0.8)",
              borderColor: "rgba(239, 68, 68, 1)",
              pointRadius: 10,
              pointHoverRadius: 13,
              pointStyle: "star" as const,
            },
          ]
        : []),
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const idx = ctx.dataIndex;
            if (ctx.datasetIndex === 0 && data[idx]) {
              const p = data[idx];
              const latex = p.latex.length > 40 ? p.latex.slice(0, 40) + "..." : p.latex;
              return `C=${p.complexity} L=${p.loss.toExponential(2)} ${latex}`;
            }
            return `Best: C=${ctx.parsed.x} L=${ctx.parsed.y.toExponential(2)}`;
          },
        },
      },
      legend: {
        display: true,
        position: "top" as const,
      },
    },
    scales: {
      x: {
        title: { display: true, text: "Complexity" },
        type: "linear" as const,
      },
      y: {
        title: { display: true, text: "Loss" },
        type: "logarithmic" as const,
      },
    },
  };

  return (
    <div style={{ height: "350px" }}>
      <Scatter data={chartData} options={options} />
    </div>
  );
}
