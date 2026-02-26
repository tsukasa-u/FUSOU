"""Pipeline: orchestrates all five phases end-to-end.

Phase 1 — Feature selection (MI + tree + permutation importance)
Phase 2 — Region splitting (CART + PELT change-point detection)
Phase 3 — Symbolic regression (PySR, MDL/BIC model selection)
Phase 4 — Model validation (K-fold CV, residual diagnostics)
Phase 5 — Noise analysis (histogram, KDE, parametric fitting)
"""

from __future__ import annotations

import pickle
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import sympy

from fusou_formula.phase1_feature_selection import (
    FeatureSelectionResult,
    FeatureSelector,
)
from fusou_formula.phase2_region_split import (
    RegionSplitResult,
    RegionSplitter,
    SplitCondition,
)
from fusou_formula.phase3_symbolic import (
    ExpressionCandidate,
    SymbolicResult,
    SymbolicSearcher,
)
from fusou_formula.phase4_validation import (
    ModelValidator,
    ValidationResult,
)
from fusou_formula.phase5_noise import (
    NoiseAnalyzer,
    NoiseResult,
)


@dataclass
class PipelineConfig:
    """Configuration for the full pipeline.

    Every parameter has a sensible default; no domain-specific
    knowledge is assumed.
    """

    # Phase 1: Feature selection
    fs_n_estimators: int = 200
    fs_mi_neighbors: int = 5
    fs_n_permutations: int = 10
    fs_selection_threshold: float = 0.05
    fs_max_features: Optional[int] = None

    # Phase 2: Region splitting
    rs_max_depth: int = 4
    rs_min_samples_leaf: int = 30
    rs_pelt_penalty: str = "bic"
    rs_pelt_min_size: int = 30
    rs_use_pelt: bool = True

    # Phase 3: Symbolic regression
    sr_binary_operators: List[str] = field(
        default_factory=lambda: ["+", "-", "*", "/"],
    )
    sr_unary_operators: List[str] = field(
        default_factory=lambda: ["sqrt", "abs", "log", "exp", "sin", "square", "cube"],
    )
    sr_parsimony: float = 0.005
    sr_max_complexity: int = 30
    sr_populations: int = 40
    sr_niterations: int = 150

    # Phase 4: Validation
    val_n_folds: int = 5
    val_interval_coverage: float = 0.9

    # Phase 5: Noise analysis
    noise_n_bins: int = 30
    noise_kde_points: int = 200

    # General
    random_state: int = 42

    def to_dict(self) -> Dict[str, Any]:
        """Serialise to a plain dictionary."""
        return {
            "fs_n_estimators": self.fs_n_estimators,
            "fs_mi_neighbors": self.fs_mi_neighbors,
            "fs_n_permutations": self.fs_n_permutations,
            "fs_selection_threshold": self.fs_selection_threshold,
            "fs_max_features": self.fs_max_features,
            "rs_max_depth": self.rs_max_depth,
            "rs_min_samples_leaf": self.rs_min_samples_leaf,
            "rs_pelt_penalty": self.rs_pelt_penalty,
            "rs_pelt_min_size": self.rs_pelt_min_size,
            "rs_use_pelt": self.rs_use_pelt,
            "sr_binary_operators": self.sr_binary_operators,
            "sr_unary_operators": self.sr_unary_operators,
            "sr_parsimony": self.sr_parsimony,
            "sr_max_complexity": self.sr_max_complexity,
            "sr_populations": self.sr_populations,
            "sr_niterations": self.sr_niterations,
            "val_n_folds": self.val_n_folds,
            "val_interval_coverage": self.val_interval_coverage,
            "noise_n_bins": self.noise_n_bins,
            "noise_kde_points": self.noise_kde_points,
            "random_state": self.random_state,
        }


@dataclass
class RegionModel:
    """Symbolic model fitted to a single data region.

    Attributes
    ----------
    region_index : int
        Index of the region in the RegionSplitResult.
    conditions : list of tuple
        Conditions defining this region (e.g. ``[("x", "<=", 50)]``).
    symbolic_result : SymbolicResult
        Symbolic regression result for this region.
    validation : ValidationResult or None
        Cross-validation result for this region.
    noise : NoiseResult or None
        Noise analysis for this region.
    n_samples : int
        Number of samples in this region.
    """

    region_index: int = 0
    conditions: List[Any] = field(default_factory=list)
    symbolic_result: Optional[SymbolicResult] = None
    validation: Optional[ValidationResult] = None
    noise: Optional[NoiseResult] = None
    n_samples: int = 0


@dataclass
class PipelineResult:
    """Full result of the pipeline."""

    phase1: Optional[FeatureSelectionResult] = None
    phase2: Optional[RegionSplitResult] = None
    region_models: List[RegionModel] = field(default_factory=list)
    config: Optional[PipelineConfig] = None
    elapsed_seconds: float = 0.0

    @property
    def best_expr(self) -> Optional[sympy.Expr]:
        """Return the best expression (from the largest / only region)."""
        if not self.region_models:
            return None
        # Pick the region with highest R² or most samples
        best_rm = max(
            self.region_models,
            key=lambda rm: (
                rm.validation.overall_r2 if rm.validation else float("-inf")
            ),
        )
        if best_rm.symbolic_result:
            return best_rm.symbolic_result.best.sympy_expr
        return None

    @property
    def best_latex(self) -> str:
        expr = self.best_expr
        return sympy.latex(expr) if expr is not None else ""

    @property
    def selected_features(self) -> List[str]:
        if self.phase1:
            return self.phase1.selected_features
        return []


class Pipeline:
    """Orchestrates the five-phase formula extraction pipeline.

    Parameters
    ----------
    config : PipelineConfig or None
        Pipeline configuration.  Uses defaults if *None*.
    """

    def __init__(self, config: Optional[PipelineConfig] = None) -> None:
        self.config = config or PipelineConfig()
        self._result: Optional[PipelineResult] = None

    def run(
        self,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
        *,
        skip_phases: Optional[List[int]] = None,
    ) -> PipelineResult:
        """Execute the full pipeline.

        Parameters
        ----------
        df : DataFrame
            Input data.
        target_col : str
            Target variable column.
        feature_cols : list of str
            Candidate feature columns (Phase 1 will select from these).
        skip_phases : list of int or None
            Phase numbers to skip (1–5).

        Returns
        -------
        PipelineResult
        """
        start_time = time.time()
        skip = set(skip_phases or [])
        cfg = self.config
        result = PipelineResult(config=cfg)

        # --- Phase 1: Feature selection ---
        if 1 not in skip:
            print("[Pipeline] Phase 1: Feature selection …")
            result.phase1 = self._run_phase1(df, target_col, feature_cols)
            selected = result.phase1.selected_features
            print(
                f"  → {len(selected)}/{len(feature_cols)} features selected: "
                f"{selected}"
            )
        else:
            selected = feature_cols

        # --- Phase 2: Region splitting ---
        if 2 not in skip:
            print("[Pipeline] Phase 2: Region splitting …")
            result.phase2 = self._run_phase2(df, target_col, selected)
            n_splits = len(result.phase2.splits)
            n_regions = len(result.phase2.regions)
            print(f"  → {n_splits} splits → {n_regions} regions")
        else:
            result.phase2 = None

        # --- Phase 3–5 per region ---
        region_masks = self._get_region_masks(df, result.phase2, selected)

        for region_idx, mask in enumerate(region_masks):
            sub_df = df.loc[mask].reset_index(drop=True)
            n_sub = len(sub_df)
            conditions = (
                result.phase2.regions[region_idx].conditions
                if result.phase2 and region_idx < len(result.phase2.regions)
                else []
            )

            rm = RegionModel(
                region_index=region_idx,
                conditions=conditions,
                n_samples=n_sub,
            )

            region_label = (
                f"[Region {region_idx}] "
                if len(region_masks) > 1
                else ""
            )

            # Phase 3: Symbolic regression
            if 3 not in skip:
                print(
                    f"[Pipeline] {region_label}Phase 3: "
                    f"Symbolic regression ({n_sub} samples) …"
                )
                rm.symbolic_result = self._run_phase3(sub_df, target_col, selected)
                best = rm.symbolic_result.best
                print(f"  → Best: {best.latex}  (loss={best.loss:.4f}, BIC={best.bic:.1f})")

            # Phase 4: Validation
            if 4 not in skip and rm.symbolic_result is not None:
                print(f"[Pipeline] {region_label}Phase 4: Validation …")
                expr = rm.symbolic_result.best.sympy_expr
                rm.validation = self._run_phase4(expr, sub_df, target_col, selected)
                v = rm.validation
                print(
                    f"  → MAE={v.overall_mae:.4f}  RMSE={v.overall_rmse:.4f}  "
                    f"R²={v.overall_r2:.4f}"
                )

            # Phase 5: Noise analysis
            if 5 not in skip and rm.symbolic_result is not None:
                print(f"[Pipeline] {region_label}Phase 5: Noise analysis …")
                expr = rm.symbolic_result.best.sympy_expr
                rm.noise = self._run_phase5(expr, sub_df, target_col, selected)
                bd = rm.noise.best_distribution
                print(f"  → Best noise model: {bd.name}  (AIC={bd.aic:.1f})")

            result.region_models.append(rm)

        elapsed = time.time() - start_time
        result.elapsed_seconds = elapsed
        self._result = result

        print(f"[Pipeline] Complete in {elapsed:.1f}s")
        return result

    # ------------------------------------------------------------------
    # Single-phase runners
    # ------------------------------------------------------------------

    def run_phase(
        self,
        phase_num: int,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
        **kwargs: Any,
    ) -> Any:
        """Run a single phase for interactive exploration."""
        if phase_num == 1:
            return self._run_phase1(df, target_col, feature_cols)
        elif phase_num == 2:
            return self._run_phase2(df, target_col, feature_cols)
        elif phase_num == 3:
            return self._run_phase3(df, target_col, feature_cols)
        elif phase_num == 4:
            expr = kwargs.get("expr")
            if expr is None:
                raise ValueError("expr required for Phase 4")
            if isinstance(expr, str):
                expr = sympy.sympify(expr)
            return self._run_phase4(expr, df, target_col, feature_cols)
        elif phase_num == 5:
            expr = kwargs.get("expr")
            if expr is None:
                raise ValueError("expr required for Phase 5")
            if isinstance(expr, str):
                expr = sympy.sympify(expr)
            return self._run_phase5(expr, df, target_col, feature_cols)
        else:
            raise ValueError(f"Invalid phase number: {phase_num}")

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save_results(self, path: str) -> None:
        """Save pipeline results to disk."""
        if self._result is None:
            raise RuntimeError("No results to save (run pipeline first)")
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "wb") as f:
            pickle.dump(self._result, f)

    def load_results(self, path: str) -> PipelineResult:
        """Load pipeline results from disk."""
        with open(path, "rb") as f:
            self._result = pickle.load(f)
        return self._result

    # ------------------------------------------------------------------
    # Report
    # ------------------------------------------------------------------

    def report(self) -> str:
        """Generate a Markdown summary report."""
        if self._result is None:
            return "No results available."

        r = self._result
        lines = ["# Pipeline Report", ""]

        if r.phase1:
            lines.append("## Phase 1: Feature Selection")
            lines.append(f"- Candidates evaluated: {len(r.phase1.all_features)}")
            lines.append(f"- Selected: {r.phase1.selected_features}")
            if r.phase1.metadata.get("oob_r2") is not None:
                lines.append(f"- RF OOB R²: {r.phase1.metadata['oob_r2']:.4f}")
            lines.append("")
            lines.append("| Feature | MI | Tree | Perm | Combined |")
            lines.append("|---------|------|------|------|----------|")
            for rk in r.phase1.rankings:
                lines.append(
                    f"| {rk.name} | {rk.mi_score:.4f} | "
                    f"{rk.tree_importance:.4f} | "
                    f"{rk.permutation_importance:.4f} | "
                    f"{rk.combined_rank:.4f} |"
                )
            lines.append("")

        if r.phase2:
            lines.append("## Phase 2: Region Splitting")
            lines.append(f"- Splits discovered: {len(r.phase2.splits)}")
            lines.append(f"- Regions: {len(r.phase2.regions)}")
            for sp in r.phase2.splits:
                lines.append(
                    f"  - {sp.feature} ≤ {sp.threshold:.4f} "
                    f"({sp.method}, score={sp.score:.4f})"
                )
            lines.append("")

        for rm in r.region_models:
            label = f"Region {rm.region_index}"
            if rm.conditions:
                cond_str = " ∧ ".join(
                    f"{f} {op} {v:.2f}" for f, op, v in rm.conditions
                )
                label += f" ({cond_str})"
            lines.append(f"## {label}")
            lines.append(f"- Samples: {rm.n_samples}")

            if rm.symbolic_result:
                sr = rm.symbolic_result
                lines.append(f"- **Best expression:** ${sr.best.latex}$")
                lines.append(
                    f"- Complexity: {sr.best.complexity}, "
                    f"Loss: {sr.best.loss:.6f}, BIC: {sr.best.bic:.1f}"
                )
                lines.append(f"- Pareto front size: {len(sr.pareto_front)}")

            if rm.validation:
                v = rm.validation
                lines.append(f"- MAE: {v.overall_mae:.4f}")
                lines.append(f"- RMSE: {v.overall_rmse:.4f}")
                lines.append(f"- R²: {v.overall_r2:.4f}")
                pi = v.prediction_interval
                lines.append(
                    f"- {v.interval_coverage:.0%} prediction interval: "
                    f"[{pi[0]:.4f}, {pi[1]:.4f}]"
                )
                d = v.residual_diagnostics
                lines.append(
                    f"- Residual normality (Shapiro p): {d.shapiro_p:.4f}"
                )

            if rm.noise:
                bd = rm.noise.best_distribution
                lines.append(
                    f"- Best noise distribution: {bd.name} (AIC={bd.aic:.1f})"
                )
                s = rm.noise.summary
                if s:
                    lines.append(
                        f"- Noise range: [{s.get('min', 0):.4f}, "
                        f"{s.get('max', 0):.4f}]"
                    )

            lines.append("")

        lines.append(f"**Total time:** {r.elapsed_seconds:.1f}s")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Phase implementations
    # ------------------------------------------------------------------

    def _run_phase1(
        self,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> FeatureSelectionResult:
        cfg = self.config
        selector = FeatureSelector(
            n_estimators=cfg.fs_n_estimators,
            mi_neighbors=cfg.fs_mi_neighbors,
            n_permutations=cfg.fs_n_permutations,
            selection_threshold=cfg.fs_selection_threshold,
            max_features=cfg.fs_max_features,
            random_state=cfg.random_state,
        )
        return selector.fit(df, target_col, feature_cols)

    def _run_phase2(
        self,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> RegionSplitResult:
        cfg = self.config
        splitter = RegionSplitter(
            max_depth=cfg.rs_max_depth,
            min_samples_leaf=cfg.rs_min_samples_leaf,
            pelt_penalty=cfg.rs_pelt_penalty,
            pelt_min_size=cfg.rs_pelt_min_size,
            use_pelt=cfg.rs_use_pelt,
            random_state=cfg.random_state,
        )
        return splitter.fit(df, target_col, feature_cols)

    def _run_phase3(
        self,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> SymbolicResult:
        cfg = self.config
        searcher = SymbolicSearcher(
            binary_operators=cfg.sr_binary_operators,
            unary_operators=cfg.sr_unary_operators,
            parsimony=cfg.sr_parsimony,
            max_complexity=cfg.sr_max_complexity,
            populations=cfg.sr_populations,
            niterations=cfg.sr_niterations,
            random_state=cfg.random_state,
        )
        return searcher.fit(df, target_col, feature_cols)

    def _run_phase4(
        self,
        expr: sympy.Expr,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> ValidationResult:
        cfg = self.config
        validator = ModelValidator(
            n_folds=cfg.val_n_folds,
            interval_coverage=cfg.val_interval_coverage,
            random_state=cfg.random_state,
        )
        return validator.validate(expr, df, target_col, feature_cols)

    def _run_phase5(
        self,
        expr: sympy.Expr,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> NoiseResult:
        cfg = self.config
        analyser = NoiseAnalyzer(
            n_bins=cfg.noise_n_bins,
            kde_points=cfg.noise_kde_points,
        )
        return analyser.analyse(expr, df, target_col, feature_cols)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _get_region_masks(
        df: pd.DataFrame,
        phase2_result: Optional[RegionSplitResult],
        feature_cols: List[str],
    ) -> List[np.ndarray]:
        """Return boolean masks for each region.

        NaN-containing rows in the split features are excluded from all
        masks so that the masks are consistent with the dropna'd data
        that ``RegionSplitter.fit()`` used internally.
        """
        if phase2_result is None or not phase2_result.splits:
            return [np.ones(len(df), dtype=bool)]

        splitter = RegionSplitter()
        masks = splitter.get_region_masks(df, phase2_result.splits, feature_cols)

        # Exclude rows where any split feature is NaN
        split_features = list({s.feature for s in phase2_result.splits})
        existing = [f for f in split_features if f in df.columns]
        if existing:
            finite = df[existing].notna().all(axis=1).values
            masks = [m & finite for m in masks]

        return masks
