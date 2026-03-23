/** @jsxImportSource react */
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
);

interface BattleStatsData {
  dailySorties: { date: string; count: number }[];
  rankDistribution: Record<string, number>;
  formationUsage: Record<string, number>;
  airStateDistribution: Record<string, number>;
}

const RANK_COLORS: Record<string, string> = {
  S: "#22c55e",
  A: "#3b82f6",
  B: "#eab308",
  C: "#ef4444",
  D: "#dc2626",
  E: "#991b1b",
};

const AIR_STATE_COLORS: Record<string, string> = {
  "制空権確保": "#22c55e",
  "航空優勢": "#3b82f6",
  "航空均衡": "#eab308",
  "航空劣勢": "#f97316",
  "制空権喪失": "#ef4444",
};

export function StatsCharts({ data }: { data: BattleStatsData }) {
  // Daily sortie trend
  const sortieLineData = {
    labels: data.dailySorties.map((d) => d.date),
    datasets: [
      {
        label: "出撃数",
        data: data.dailySorties.map((d) => d.count),
        borderColor: "#6A7FDB",
        backgroundColor: "rgba(106,127,219,0.15)",
        fill: true,
        tension: 0.3,
      },
    ],
  };

  // Rank distribution doughnut
  const rankLabels = Object.keys(data.rankDistribution);
  const rankDoughnut = {
    labels: rankLabels,
    datasets: [
      {
        data: rankLabels.map((k) => data.rankDistribution[k]),
        backgroundColor: rankLabels.map((k) => RANK_COLORS[k] ?? "#888"),
      },
    ],
  };

  // Formation usage bar
  const formLabels = Object.keys(data.formationUsage);
  const formBarData = {
    labels: formLabels,
    datasets: [
      {
        label: "使用回数",
        data: formLabels.map((k) => data.formationUsage[k]),
        backgroundColor: "#6A7FDB",
        borderRadius: 4,
      },
    ],
  };

  // Air state distribution
  const airLabels = Object.keys(data.airStateDistribution);
  const airDoughnut = {
    labels: airLabels,
    datasets: [
      {
        data: airLabels.map((k) => data.airStateDistribution[k]),
        backgroundColor: airLabels.map((k) => AIR_STATE_COLORS[k] ?? "#888"),
      },
    ],
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Daily Sortie Trend */}
      <div className="bg-base-100 rounded-box p-4 shadow-sm">
        <h3 className="font-bold mb-2">日別出撃数</h3>
        <div style={{ height: 250 }}>
          <Line
            data={sortieLineData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: { y: { beginAtZero: true } },
            }}
          />
        </div>
      </div>

      {/* Rank Distribution */}
      <div className="bg-base-100 rounded-box p-4 shadow-sm">
        <h3 className="font-bold mb-2">戦闘結果分布</h3>
        <div style={{ height: 250 }} className="flex justify-center">
          <Doughnut
            data={rankDoughnut}
            options={{ responsive: true, maintainAspectRatio: false }}
          />
        </div>
      </div>

      {/* Formation Usage */}
      <div className="bg-base-100 rounded-box p-4 shadow-sm">
        <h3 className="font-bold mb-2">陣形使用率</h3>
        <div style={{ height: 250 }}>
          <Bar
            data={formBarData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: { y: { beginAtZero: true } },
            }}
          />
        </div>
      </div>

      {/* Air State Distribution */}
      <div className="bg-base-100 rounded-box p-4 shadow-sm">
        <h3 className="font-bold mb-2">制空状態分布</h3>
        <div style={{ height: 250 }} className="flex justify-center">
          <Doughnut
            data={airDoughnut}
            options={{ responsive: true, maintainAspectRatio: false }}
          />
        </div>
      </div>
    </div>
  );
}
