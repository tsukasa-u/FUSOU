/** @jsxImportSource react */
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { useState, useMemo } from "react";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface CellTransition {
  from: number;
  to: number;
  count: number;
}

interface CellFlowChartProps {
  transitions: CellTransition[];
  mapLabel?: string;
}

export function CellFlowChart({ transitions, mapLabel }: CellFlowChartProps) {
  const [topN, setTopN] = useState(20);

  const sorted = useMemo(() => {
    return [...transitions]
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);
  }, [transitions, topN]);

  const data = {
    labels: sorted.map((t) => `${t.from} → ${t.to}`),
    datasets: [
      {
        label: "遷移回数",
        data: sorted.map((t) => t.count),
        backgroundColor: "#6A7FDB",
        borderRadius: 4,
      },
    ],
  };

  const options = {
    indexAxis: "y" as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { raw: unknown }) => `${ctx.raw}回`,
        },
      },
    },
    scales: {
      x: { title: { display: true, text: "回数" } },
      y: { title: { display: true, text: "セル遷移" } },
    },
  };

  if (transitions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        遷移データがありません
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        {mapLabel && <span className="font-bold">{mapLabel}</span>}
        <label className="text-sm">
          表示数:
          <select
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="select select-bordered select-xs ml-1"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </label>
      </div>
      <div style={{ height: Math.max(300, sorted.length * 28) }}>
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}
