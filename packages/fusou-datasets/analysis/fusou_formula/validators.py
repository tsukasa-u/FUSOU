"""Validators: compare discovered formulas against known ground-truth.

This module is optional — it is only needed when a known formula exists
for comparison (e.g. during development or validation).  It does *not*
embed any domain knowledge into the pipeline's discovery process.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import sympy

from fusou_formula.phase3_symbolic import SymbolicSearcher


@dataclass
class ComparisonMetrics:
    """Numerical accuracy metrics when comparing two formulas on data."""

    mae: float = 0.0
    rmse: float = 0.0
    max_error: float = 0.0
    r2: float = 0.0
    n_samples: int = 0


@dataclass
class ComparisonResult:
    """Result of comparing a discovered expression vs a known one."""

    structural_match: bool
    structural_similarity: float  # 0..1
    numerical_metrics: ComparisonMetrics
    discovered_latex: str = ""
    known_latex: str = ""
    diff_summary: str = ""


class FormulaValidator:
    """Compare a discovered formula against a known ground-truth.

    This class is used *after* the pipeline has run, purely for
    evaluation purposes.  It does not influence the pipeline itself.
    """

    def evaluate_accuracy(
        self,
        expr: sympy.Expr,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> ComparisonMetrics:
        """Evaluate prediction accuracy on data.

        Parameters
        ----------
        expr : sympy.Expr
            The formula to evaluate.
        df : DataFrame
            Test data.
        target_col : str
        feature_cols : list of str

        Returns
        -------
        ComparisonMetrics
        """
        y_true = df[target_col].values.astype(np.float64)
        y_pred = SymbolicSearcher.evaluate_expr(expr, df, feature_cols)

        valid = np.isfinite(y_pred) & np.isfinite(y_true)
        y_true = y_true[valid]
        y_pred = y_pred[valid]

        if len(y_true) == 0:
            return ComparisonMetrics()

        errors = y_true - y_pred
        abs_errors = np.abs(errors)

        ss_res = float(np.sum(errors ** 2))
        ss_tot = float(np.sum((y_true - np.mean(y_true)) ** 2))
        if ss_tot > 0:
            r2 = 1.0 - ss_res / ss_tot
        elif ss_res == 0:
            r2 = 1.0  # perfect prediction of constant target
        else:
            r2 = 0.0

        return ComparisonMetrics(
            mae=float(np.mean(abs_errors)),
            rmse=float(np.sqrt(np.mean(errors ** 2))),
            max_error=float(np.max(abs_errors)),
            r2=r2,
            n_samples=len(y_true),
        )

    def compare_with_known(
        self,
        discovered_expr: sympy.Expr,
        known_expr: sympy.Expr,
        test_df: Optional[pd.DataFrame] = None,
        target_col: Optional[str] = None,
        feature_cols: Optional[List[str]] = None,
    ) -> ComparisonResult:
        """Compare a discovered expression against a known formula.

        Parameters
        ----------
        discovered_expr : sympy.Expr
        known_expr : sympy.Expr
        test_df : DataFrame or None
            If provided, also compute numerical accuracy.
        target_col : str or None
        feature_cols : list of str or None

        Returns
        -------
        ComparisonResult
        """
        structural_match, similarity = self._structural_compare(
            discovered_expr, known_expr,
        )

        metrics = ComparisonMetrics()
        if test_df is not None and target_col and feature_cols:
            metrics = self.evaluate_accuracy(
                discovered_expr, test_df, target_col, feature_cols,
            )

        return ComparisonResult(
            structural_match=structural_match,
            structural_similarity=similarity,
            numerical_metrics=metrics,
            discovered_latex=sympy.latex(discovered_expr),
            known_latex=sympy.latex(known_expr),
            diff_summary=self._diff_summary(discovered_expr, known_expr),
        )

    def generate_report(
        self,
        results: List[ComparisonResult],
        title: str = "Validation Report",
    ) -> str:
        """Generate a Markdown validation report."""
        lines = [f"# {title}", ""]

        for i, r in enumerate(results, 1):
            lines.append(f"## Formula {i}")
            lines.append(f"- **Discovered:** ${r.discovered_latex}$")
            lines.append(f"- **Known:** ${r.known_latex}$")
            lines.append(
                f"- **Structural match:** "
                f"{'Yes' if r.structural_match else 'No'}"
            )
            lines.append(
                f"- **Structural similarity:** {r.structural_similarity:.2%}"
            )

            m = r.numerical_metrics
            if m.n_samples > 0:
                lines.append(f"- **MAE:** {m.mae:.4f}")
                lines.append(f"- **RMSE:** {m.rmse:.4f}")
                lines.append(f"- **R²:** {m.r2:.4f}")
                lines.append(f"- **Samples:** {m.n_samples}")

            if r.diff_summary:
                lines.append(f"- **Diff:** {r.diff_summary}")
            lines.append("")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _structural_compare(
        expr1: sympy.Expr,
        expr2: sympy.Expr,
    ) -> tuple[bool, float]:
        """Compare two expressions structurally.

        Returns ``(exact_match, similarity_score)``.
        """
        # Exact symbolic equality
        try:
            diff = sympy.simplify(expr1 - expr2)
            if diff == 0:
                return True, 1.0
        except Exception:
            pass

        # Expanded form comparison
        try:
            e1 = sympy.expand(expr1)
            e2 = sympy.expand(expr2)
            diff = sympy.simplify(e1 - e2)
            if diff == 0:
                return True, 1.0
        except Exception:
            pass

        # Approximate similarity based on AST structure
        s1 = str(sympy.srepr(expr1))
        s2 = str(sympy.srepr(expr2))

        tokens1 = set(s1.split())
        tokens2 = set(s2.split())
        common = len(tokens1 & tokens2)
        total = max(len(tokens1 | tokens2), 1)
        similarity = common / total

        return False, similarity

    @staticmethod
    def _diff_summary(expr1: sympy.Expr, expr2: sympy.Expr) -> str:
        """Generate a human-readable diff summary."""
        ops1 = set(
            str(type(a).__name__) for a in sympy.preorder_traversal(expr1)
        )
        ops2 = set(
            str(type(a).__name__) for a in sympy.preorder_traversal(expr2)
        )

        only_in_discovered = ops1 - ops2
        only_in_known = ops2 - ops1

        parts = []
        if only_in_discovered:
            parts.append(
                f"discovered has: {', '.join(sorted(only_in_discovered))}"
            )
        if only_in_known:
            parts.append(f"known has: {', '.join(sorted(only_in_known))}")

        return "; ".join(parts) if parts else "identical operation sets"
