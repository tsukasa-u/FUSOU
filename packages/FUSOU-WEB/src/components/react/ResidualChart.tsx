/** @jsxImportSource react */
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  BarElement,
  CategoryScale,
  Tooltip,
  Legend,
  LineElement,
} from "chart.js";
import { Scatter, Bar } from "react-chartjs-2";

ChartJS.register(
  LinearScale,
  PointElement,
  BarElement,
  CategoryScale,
  LineElement,
  Tooltip,
  Legend
);

export interface ResidualChartProps {
  histogram?: {
    bins: number[];
    counts: number[];
  };
  byInput?: Array<{ x: number; residual: number }>;
  featureName?: string;
}

export function ResidualChart({
  histogram,
  byInput,
  featureName = "x",
}: ResidualChartProps) {
  const hasHistogram = histogram && histogram.bins.length > 1;
  const hasByInput = byInput && byInput.length > 0;

  if (!hasHistogram && !hasByInput) {
    return (
      <div className="text-center py-8 text-base-content/50">
        残差データがありません
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {hasHistogram && <ResidualHistogram histogram={histogram} />}
      {hasByInput && (
        <ResidualScatter byInput={byInput} featureName={featureName} />
      )}
    </div>
  );
}

function ResidualHistogram({
  histogram,
}: {
  histogram: { bins: number[]; counts: number[] };
}) {
  const labels = histogram.counts.map((_, i) => {
    const lo = histogram.bins[i];
    const hi = histogram.bins[i + 1];
    if (lo == null || hi == null) return "";
    return `${lo.toFixed(1)}`;
  });

  const chartData = {
    labels,
    datasets: [
      {
        label: "Frequency",
        data: histogram.counts,
        backgroundColor: "rgba(59, 130, 246, 0.5)",
        borderColor: "rgba(59, 130, 246, 1)",
        borderWidth: 1,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items: any[]) => {
            const idx = items[0]?.dataIndex;
            if (idx == null) return "";
            const lo = histogram.bins[idx];
            const hi = histogram.bins[idx + 1];
            return `[${lo?.toFixed(2)}, ${hi?.toFixed(2)})`;
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: "Residual" },
      },
      y: {
        title: { display: true, text: "Count" },
        beginAtZero: true,
      },
    },
  };

  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">残差分布</h4>
      <div style={{ height: "280px" }}>
        <Bar data={chartData} options={options} />
      </div>
    </div>
  );
}

function ResidualScatter({
  byInput,
  featureName,
}: {
  byInput: Array<{ x: number; residual: number }>;
  featureName: string;
}) {
  const points = byInput.map((p) => ({ x: p.x, y: p.residual }));

  const chartData = {
    datasets: [
      {
        label: "Residual",
        data: points,
        backgroundColor: "rgba(239, 68, 68, 0.4)",
        pointRadius: 2,
      },
      {
        label: "Zero line",
        data: [
          { x: Math.min(...byInput.map((p) => p.x)), y: 0 },
          { x: Math.max(...byInput.map((p) => p.x)), y: 0 },
        ],
        showLine: true,
        borderColor: "rgba(100, 100, 100, 0.5)",
        borderDash: [5, 5],
        borderWidth: 1,
        pointRadius: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: {
        title: { display: true, text: featureName },
        type: "linear" as const,
      },
      y: {
        title: { display: true, text: "Residual" },
        type: "linear" as const,
      },
    },
  };

  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">残差 vs {featureName}</h4>
      <div style={{ height: "280px" }}>
        <Scatter data={chartData} options={options} />
      </div>
    </div>
  );
}
