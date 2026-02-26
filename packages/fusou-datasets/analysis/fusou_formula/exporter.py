"""Exporter: converts pipeline results to FormulaArtifact JSON for Web display.

The output format exactly matches the ``FormulaArtifact`` TypeScript interface
defined in ``FUSOU-WEB/src/server/stores/formula-store.ts``.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import sympy

from fusou_formula.phase3_symbolic import SymbolicSearcher
from fusou_formula.pipeline import PipelineConfig, PipelineResult, RegionModel


class FormulaExporter:
    """Export pipeline results as FormulaArtifact JSON files.

    The artifact format is designed for display on FUSOU-WEB's ``/formulas``
    pages.
    """

    def export(
        self,
        pipeline_result: PipelineResult,
        artifact_id: str,
        target_name: str,
        status: str = "candidate",
        df: Optional[pd.DataFrame] = None,
        target_col: Optional[str] = None,
        feature_cols: Optional[List[str]] = None,
        data_source: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Convert a PipelineResult into a FormulaArtifact dict.

        Parameters
        ----------
        pipeline_result : PipelineResult
        artifact_id : str
            Unique identifier (e.g. ``"analysis_damage_v1"``).
        target_name : str
            Human-readable target name.
        status : str
            ``"validated"`` / ``"candidate"`` / ``"failed"``.
        df : DataFrame, optional
            Original data for residual computation.
        target_col : str, optional
            Target column name in *df*.
        feature_cols : list of str, optional
            Feature column names in *df*.
        data_source : dict, optional
            Data source metadata.  Expected keys:
            - ``type``: ``"sdk"`` / ``"csv"`` / ``"synthetic"``
            - ``tables``: list of table names (for SDK)
            - ``table_descriptions``: dict mapping table name to description
            - ``column_descriptions``: dict mapping column name to description
            - ``csv_path``: path (for CSV)
            - ``formula_description``: human-readable formula (for synthetic)

        Returns
        -------
        dict
            FormulaArtifact JSON-serializable dictionary matching the
            FUSOU-WEB ``FormulaArtifact`` interface.
        """
        r = pipeline_result
        now = datetime.now(timezone.utc).isoformat()

        # --- Global best formula ---
        best_section: Dict[str, Any] = {}
        best_expr = r.best_expr
        if best_expr is not None:
            best_section = {
                "latex": sympy.latex(best_expr),
                "sympy_str": str(best_expr),
                "complexity": int(sympy.count_ops(best_expr)),
                "coefficients": self._extract_coefficients(best_expr),
                "ast_tree": SymbolicSearcher.sympy_to_ast_tree(best_expr),
            }

        # --- Pareto front (top-level, from best region model) ---
        pareto_front: List[Dict[str, Any]] = []
        for rm in r.region_models:
            if rm.symbolic_result and rm.symbolic_result.pareto_front:
                pareto_front = [
                    {
                        "complexity": c.complexity,
                        "loss": c.loss,
                        "latex": c.latex,
                        "sympy_str": str(c.sympy_expr),
                    }
                    for c in rm.symbolic_result.pareto_front
                ]
                break

        # --- Regime info ---
        regime_info: Optional[Dict[str, Any]] = None
        if r.phase2 and r.phase2.splits:
            # Normalise split scores to [0, 1] for confidence display
            scores = [
                float(sp.score) if sp.score is not None else 0.0
                for sp in r.phase2.splits
            ]
            max_score = max(scores) if scores else 1.0
            if max_score <= 0:
                max_score = 1.0

            breakpoints = [
                {
                    "value": float(sp.threshold),
                    "variable": sp.feature,
                    "confidence": round(
                        (float(sp.score) / max_score) if sp.score is not None else 0.5,
                        4,
                    ),
                }
                for sp in r.phase2.splits
            ]
            regimes: List[Dict[str, Any]] = []
            for region in r.phase2.regions:
                regimes.append({
                    "range": [None, None],
                    "slope": None,
                    "intercept": None,
                })
            regime_info = {
                "breakpoints": breakpoints,
                "regimes": regimes,
            }

        # --- Validation (FUSOU-WEB expected structure) ---
        validation: Dict[str, Any] = {
            "known_formula_match": None,
            "known_formula_latex": None,
            "structural_similarity": None,
            "metrics": {
                "mae": 0.0,
                "rmse": 0.0,
                "interval_accuracy": 0.0,
                "n_samples": 0,
            },
        }

        for rm in r.region_models:
            if rm.validation:
                v = rm.validation
                validation["metrics"] = {
                    "mae": float(v.overall_mae),
                    "rmse": float(v.overall_rmse),
                    "interval_accuracy": float(v.interval_coverage),
                    "n_samples": int(v.n_samples),
                }
                break

        # --- Residual analysis ---
        if best_expr is not None and df is not None and target_col and feature_cols:
            try:
                residual_data = self.compute_residuals(
                    best_expr, df, target_col, feature_cols,
                )
                if residual_data.get("histogram"):
                    validation["residual_histogram"] = residual_data["histogram"]
                if residual_data.get("by_input"):
                    validation["residual_by_input"] = residual_data["by_input"]
            except Exception:
                pass  # residuals are optional

        # --- Data summary ---
        data_summary: Dict[str, Any] = {}
        if df is not None and target_col:
            try:
                data_summary = {
                    "n_rows": int(len(df)),
                    "n_features": len(feature_cols) if feature_cols else 0,
                    "target_stats": {
                        "mean": float(df[target_col].mean()),
                        "std": float(df[target_col].std()),
                        "min": float(df[target_col].min()),
                        "max": float(df[target_col].max()),
                    },
                }
            except Exception:
                pass

        # --- Feature selection details (Phase 1) ---
        feature_selection: Optional[Dict[str, Any]] = None
        if r.phase1:
            p1 = r.phase1
            feature_selection = {
                "target_col": p1.target_col,
                "all_features": p1.all_features,
                "selected_features": p1.selected_features,
                "rankings": [
                    {
                        "name": rk.name,
                        "mi_score": float(rk.mi_score),
                        "tree_importance": float(rk.tree_importance),
                        "permutation_importance": float(rk.permutation_importance),
                        "combined_rank": float(rk.combined_rank),
                    }
                    for rk in p1.rankings
                ],
                "metadata": {
                    k: (float(v) if isinstance(v, (np.floating, float)) else v)
                    for k, v in p1.metadata.items()
                },
            }

        # --- Actual vs Predicted data ---
        actual_vs_predicted: Optional[List[Dict[str, Any]]] = None
        if best_expr is not None and df is not None and target_col and feature_cols:
            try:
                actual_vs_predicted = self._compute_actual_vs_predicted(
                    best_expr, df, target_col, feature_cols
                )
            except Exception:
                pass

        artifact: Dict[str, Any] = {
            "id": artifact_id,
            "created_at": now,
            "target": target_name,
            "status": status,
            "best_formula": best_section,
            "pareto_front": pareto_front,
            "regime_info": regime_info,
            "validation": validation,
            "data_summary": data_summary,
            "data_source": data_source or {"type": "unknown"},
            "feature_selection": feature_selection,
            "actual_vs_predicted": actual_vs_predicted,
            "pipeline_config": r.config.to_dict() if r.config else {},
        }

        return artifact

    def save(
        self,
        artifact: Dict[str, Any],
        results_dir: str,
    ) -> Path:
        """Save artifact JSON and update index.json.

        Parameters
        ----------
        artifact : dict
            FormulaArtifact dictionary.
        results_dir : str
            Path to results directory.

        Returns
        -------
        Path
            Path to the saved JSON file.
        """
        rdir = Path(results_dir)
        rdir.mkdir(parents=True, exist_ok=True)

        artifact_id = artifact["id"]
        filepath = rdir / f"{artifact_id}.json"

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(artifact, f, indent=2, ensure_ascii=False, default=str)

        self._update_index(rdir, artifact)
        return filepath

    def publish(
        self,
        artifact: Dict[str, Any],
        api_url: str,
        api_key: str,
    ) -> bool:
        """Upload artifact to FUSOU-WEB production API.

        Parameters
        ----------
        artifact : dict
        api_url : str
        api_key : str

        Returns
        -------
        bool
        """
        import requests  # type: ignore[import-untyped]

        url = f"{api_url.rstrip('/')}/api/formulas/upload"
        resp = requests.post(
            url,
            json=artifact,
            headers={
                "Content-Type": "application/json",
                "X-API-KEY": api_key,
            },
            timeout=30,
        )
        resp.raise_for_status()
        return True

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_coefficients(expr: sympy.Expr) -> Dict[str, float]:
        """Extract numeric coefficients from a sympy expression."""
        coeffs: Dict[str, float] = {}
        try:
            for atom in expr.atoms(sympy.Number):
                val = float(atom)
                if val not in (0, 1, -1):
                    coeffs[str(atom)] = val
        except Exception:
            pass
        return coeffs

    @staticmethod
    def _update_index(results_dir: Path, artifact: Dict[str, Any]) -> None:
        """Update results/index.json with the artifact metadata.

        Index format matches FUSOU-WEB's ``FormulaIndexEntry`` interface.
        """
        index_path = results_dir / "index.json"

        entries: List[Dict[str, Any]] = []
        if index_path.exists():
            try:
                with open(index_path, "r", encoding="utf-8") as f:
                    entries = json.load(f)
            except (json.JSONDecodeError, ValueError):
                entries = []

        best = artifact.get("best_formula", {})
        validation = artifact.get("validation", {})
        metrics = validation.get("metrics", {})

        entry = {
            "id": artifact["id"],
            "target": artifact.get("target", ""),
            "status": artifact.get("status", "candidate"),
            "best_formula_latex": best.get("latex", ""),
            "complexity": best.get("complexity", 0),
            "interval_accuracy": metrics.get("interval_accuracy"),
            "created_at": artifact.get("created_at", ""),
        }

        entries = [e for e in entries if e.get("id") != artifact["id"]]
        entries.append(entry)
        entries.sort(key=lambda e: e.get("created_at", ""), reverse=True)

        with open(index_path, "w", encoding="utf-8") as f:
            json.dump(entries, f, indent=2, ensure_ascii=False)

    @staticmethod
    def compute_residuals(
        expr: sympy.Expr,
        df: Any,
        target_col: str,
        feature_cols: List[str],
        n_bins: int = 20,
    ) -> Dict[str, Any]:
        """Compute residual analysis data for external use.

        Returns ``{"histogram": ..., "by_input": [...]}``.
        """
        import pandas as pd

        y_true = df[target_col].values.astype(float)
        y_pred = SymbolicSearcher.evaluate_expr(expr, df, feature_cols)

        valid = np.isfinite(y_pred) & np.isfinite(y_true)
        residuals = (y_true - y_pred)[valid]

        counts, bin_edges = np.histogram(residuals, bins=n_bins)
        histogram = {
            "bins": [float(b) for b in bin_edges],
            "counts": [int(c) for c in counts],
        }

        x_vals = df[feature_cols[0]].values[valid] if feature_cols else []
        by_input = [
            {"x": float(x), "residual": float(r)}
            for x, r in zip(x_vals[:500], residuals[:500])
        ]

        return {"histogram": histogram, "by_input": by_input}

    @staticmethod
    def _compute_actual_vs_predicted(
        expr: sympy.Expr,
        df: Any,
        target_col: str,
        feature_cols: List[str],
        max_points: int = 500,
    ) -> List[Dict[str, Any]]:
        """Compute actual vs predicted data points for scatter plot.

        Returns a list of ``{"actual": ..., "predicted": ..., "features": {...}}``.
        """
        y_true = df[target_col].values.astype(float)
        y_pred = SymbolicSearcher.evaluate_expr(expr, df, feature_cols)

        valid = np.isfinite(y_pred) & np.isfinite(y_true)
        y_true_v = y_true[valid]
        y_pred_v = y_pred[valid]

        # Subsample if too many points
        n = len(y_true_v)
        if n > max_points:
            rng = np.random.default_rng(42)
            idx = rng.choice(n, size=max_points, replace=False)
            idx.sort()
        else:
            idx = np.arange(n)

        points: List[Dict[str, Any]] = []
        valid_indices = np.where(valid)[0]
        for i in idx:
            pt: Dict[str, Any] = {
                "actual": float(y_true_v[i]),
                "predicted": float(y_pred_v[i]),
            }
            # Include feature values for tooltip
            orig_idx = valid_indices[i]
            feat_vals: Dict[str, float] = {}
            for fc in feature_cols:
                feat_vals[fc] = float(df[fc].iloc[orig_idx])
            pt["features"] = feat_vals
            points.append(pt)

        return points
