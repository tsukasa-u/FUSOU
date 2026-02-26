/** @jsxImportSource react */
import React from "react";
import { LatexRenderer } from "./LatexRenderer";

/**
 * FormulaCard — displays a discovered formula with key metrics.
 *
 * Used as a card in the formula dashboard list and in detail pages.
 * LaTeX formula is displayed as styled monospace text (no KaTeX dependency).
 */

interface FormulaCardProps {
  id: string;
  target: string;
  status: "validated" | "candidate" | "failed" | string;
  latex: string;
  complexity: number;
  intervalAccuracy: number | null;
  createdAt: string;
  /** When true, the card is clickable and navigates to detail page */
  linkToDetail?: boolean;
}

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  validated: { cls: "badge-success", label: "検証済" },
  candidate: { cls: "badge-warning", label: "候補" },
  failed: { cls: "badge-error", label: "失敗" },
};

export function FormulaCard({
  id,
  target,
  status,
  latex,
  complexity,
  intervalAccuracy,
  createdAt,
  linkToDetail = true,
}: FormulaCardProps) {
  const badge = STATUS_BADGE[status] || {
    cls: "badge-neutral",
    label: status,
  };

  const formattedDate = new Date(createdAt).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const card = (
    <div className="card bg-base-200 shadow-md hover:shadow-lg transition-shadow">
      <div className="card-body p-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="card-title text-base">{target}</h3>
          <span className={`badge ${badge.cls} badge-sm`}>{badge.label}</span>
        </div>

        {/* Formula display */}
        <div className="bg-base-300 rounded-lg p-3 my-2 overflow-x-auto flex justify-center">
          <LatexRenderer
            latex={latex || "N/A"}
            displayMode={false}
            className="text-sm"
          />
        </div>

        {/* Metrics */}
        <div className="flex flex-wrap gap-3 text-xs text-base-content/70">
          <span className="flex items-center gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            複雑度: {complexity}
          </span>
          {intervalAccuracy != null && (
            <span className="flex items-center gap-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              精度: {(intervalAccuracy * 100).toFixed(1)}%
            </span>
          )}
          <span className="ml-auto">{formattedDate}</span>
        </div>
      </div>
    </div>
  );

  if (linkToDetail) {
    return (
      <a href={`/formulas/${id}`} className="block no-underline">
        {card}
      </a>
    );
  }

  return card;
}

/**
 * Formula list dashboard component.
 */
export interface FormulaListProps {
  entries: Array<{
    id: string;
    target: string;
    status: string;
    best_formula_latex: string;
    complexity: number;
    interval_accuracy: number | null;
    created_at: string;
  }>;
}

export function FormulaList({ entries }: FormulaListProps) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-base-content/50">
        <p className="text-lg">数式結果がまだありません</p>
        <p className="text-sm mt-2">
          パイプラインを実行して結果を生成してください
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {entries.map((entry) => (
        <FormulaCard
          key={entry.id}
          id={entry.id}
          target={entry.target}
          status={entry.status}
          latex={entry.best_formula_latex}
          complexity={entry.complexity}
          intervalAccuracy={entry.interval_accuracy}
          createdAt={entry.created_at}
        />
      ))}
    </div>
  );
}

export default FormulaCard;
