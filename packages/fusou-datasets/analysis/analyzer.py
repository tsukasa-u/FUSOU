"""
GameMechanicsAnalyzer -- Facade class for the full 3-stage pipeline.

============================================================
Pipeline Overview
============================================================

    Raw Battle Data
    X = [karyoku, soukou, ...]   Y = damage
         |
         v
    Stage 1: NoiseFilter
      Group by X (single or multi), compute percentile boundaries
      -> Clean 1D curve for cap detection (primary variable)
         |
         v
    Stage 2: CapDetector
      Detect slope changes in Y_max(primary_X)
      -> Thresholds splitting primary_X into segments
         |
         v
    Stage 3: FormulaDiscoverer
      For each segment: symbolic regression (all X vars) -> Y
      -> Closed-form formulas per segment

Variables
---------
    x_cols (List[str]): One or more predictor columns.
        - First column is the "primary" variable for 1D analysis.
        - Additional columns are used in multi-variable formula discovery.
    y_col (str):        Target column to predict (e.g. "damage").
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd

from .feature_selector import FeatureSelector, FeatureSelectionResult
from .noise_filter import NoiseFilter, FilterResult
from .cap_detector import CapDetector, CapResult
from .formula_discoverer import FormulaDiscoverer, FormulaResult


@dataclass
class AnalysisResult:
    """Full pipeline result.

    Attributes:
        filter_result: Output of Stage 1.
        cap_result_upper: Output of Stage 2 on upper boundary.
        cap_result_lower: Output of Stage 2 on lower boundary (optional).
        formula_results: Output of Stage 3 (one per segment).
        x_cols: List of X variable names used.
        y_col: Name of the Y variable.
        summary_text: Human-readable summary.
    """
    filter_result: FilterResult
    cap_result_upper: CapResult
    cap_result_lower: Optional[CapResult]
    formula_results: List[FormulaResult]
    feature_selection_result: Optional[FeatureSelectionResult]
    x_cols: List[str]
    y_col: str
    summary_text: str = ""


class GameMechanicsAnalyzer:
    """Facade orchestrating NoiseFilter -> CapDetector -> FormulaDiscoverer.

    Supports both single-variable and multi-variable analysis.

    Example (single-variable):
        >>> analyzer = GameMechanicsAnalyzer()
        >>> result = analyzer.fit_and_discover(
        ...     df, x_cols="attacker_karyoku", y_col="damage"
        ... )

    Example (multi-variable):
        >>> result = analyzer.fit_and_discover(
        ...     df,
        ...     x_cols=["attacker_karyoku", "defender_soukou"],
        ...     y_col="damage"
        ... )
    """

    def __init__(
        self,
        upper_quantile: float = 0.99,
        lower_quantile: float = 0.01,
        min_samples: int = 5,
        max_caps: int = 5,
        min_segment_length: int = 10,
        cap_penalty_scale: float = 5.0,
        pysr_iterations: int = 40,
        polyfit_max_degree: int = 3,
    ) -> None:
        """Initialise the full pipeline."""
        self.noise_filter = NoiseFilter(
            upper_quantile=upper_quantile,
            lower_quantile=lower_quantile,
            min_samples=min_samples,
        )
        self.cap_detector = CapDetector(
            min_segment_length=min_segment_length,
            penalty_scale=cap_penalty_scale,
        )
        self.formula_discoverer = FormulaDiscoverer(
            max_pysr_iterations=pysr_iterations,
            polyfit_max_degree=polyfit_max_degree,
        )
        self._result: Optional[AnalysisResult] = None

    def fit_and_discover(
        self,
        df: pd.DataFrame,
        x_cols: Union[str, List[str]],
        y_col: str,
        analyse_lower: bool = False,
        max_caps: int = 5,
        auto_select_features: bool = False,
        num_features: int = 3,
        force_keep_cols: Optional[List[str]] = None,
    ) -> AnalysisResult:
        """Run the full hybrid pipeline.

        Args:
            df: DataFrame with predictor and target columns.
            x_cols: Predictor column name(s) or candidate pool.
                    - str: single-variable mode.
                    - list: multi-variable mode/candidate pool.
            y_col: Target column name (e.g. "damage").
            analyse_lower: Also run cap detection on lower boundary.
            max_caps: Maximum caps to detect.
            auto_select_features: Run Stage 0 (FeatureSelector) first.
            num_features: Number of features to keep if auto-selecting.
            force_keep_cols: Columns to definitively keep in feature selection.

        Returns:
            AnalysisResult with all stages' outputs.
        """
        # Normalise to list
        if isinstance(x_cols, str):
            x_cols = [x_cols]

        feature_selection_result = None

        if auto_select_features and len(x_cols) > 1:
            print(f"=== Stage 0: Feature Selector ===")
            print(f"  Selecting top {num_features} features from {len(x_cols)} candidates ...")
            selector = FeatureSelector(top_k=num_features, method="random_forest")
            feature_selection_result = selector.select(
                df, candidate_x_cols=x_cols, y_col=y_col, force_keep_cols=force_keep_cols
            )
            df = feature_selection_result.clean_df
            x_cols = feature_selection_result.selected_cols
            print(f"  -> Selected features: {x_cols}")
            print()

        # Handle any categorical columns in x_cols before formula discovery
        import pandas.api.types as ptypes
        cat_cols = [
            c for c in x_cols 
            if ptypes.is_object_dtype(df[c]) or ptypes.is_string_dtype(df[c]) or ptypes.is_categorical_dtype(df[c]) or ptypes.is_bool_dtype(df[c])
        ]
        
        if cat_cols:
            print(f"  One-hot encoding categorical variables: {cat_cols}")
            df = pd.get_dummies(df, columns=cat_cols, drop_first=True, dtype=float)
            # Update x_cols with the newly created dummy columns
            new_x_cols = []
            for col in x_cols:
                if col in cat_cols:
                    new_x_cols.extend([c for c in df.columns if c.startswith(f"{col}_")])
                else:
                    new_x_cols.append(col)
            x_cols = new_x_cols
            print(f"  -> Updated predictors: {x_cols}\n")

        primary_x = x_cols[0]
        multi_mode = len(x_cols) > 1

        print(f"=== Stage 1: NoiseFilter ===")
        print(f"  Predictor(s) (X): {x_cols}")
        print(f"    Primary variable for cap detection: {primary_x}")
        if multi_mode:
            print(f"    Additional variables for formula: {x_cols[1:]}")
        print(f"  Target (Y): {y_col}")
        print(f"  Extracting {self.noise_filter.upper_quantile:.0%} / "
              f"{self.noise_filter.lower_quantile:.0%} percentiles ...")

        # Stage 1 uses ONLY the primary variable for 1D filtering
        filter_result = self.noise_filter.filter(df, x_cols=primary_x, y_col=y_col)
        clean = filter_result.clean_df
        print(f"  -> {len(clean)} unique X-groups after filtering.\n")

        # Stage 2: cap detection on the primary variable's upper boundary
        print(f"=== Stage 2: CapDetector ===")
        print(f"  Detecting slope changes in Y_max({primary_x}) ...")

        x_arr = clean["x"].values
        y_max = clean["y_max"].values
        cap_result_upper = self.cap_detector.detect(x_arr, y_max, max_caps=max_caps)

        print(f"  Method: {cap_result_upper.method}")
        if cap_result_upper.thresholds:
            caps_str = ", ".join(str(t) for t in cap_result_upper.thresholds)
            print(f"  -> Caps detected at {primary_x} = [{caps_str}]")
        else:
            print(f"  -> No caps detected (single formula region).")
        print(f"  -> {len(cap_result_upper.segments)} segment(s).\n")

        cap_result_lower = None
        if analyse_lower:
            y_min = clean["y_min"].values
            cap_result_lower = self.cap_detector.detect(x_arr, y_min, max_caps=max_caps)

        # Stage 3: formula discovery per segment
        print(f"=== Stage 3: FormulaDiscoverer ===")
        if multi_mode:
            print(f"  Using {len(x_cols)} input variables: {x_cols}")
        formula_results: List[FormulaResult] = []

        for seg in cap_result_upper.segments:
            print(
                f"  Segment {seg.segment_index}: "
                f"{primary_x} in [{seg.start_x:.0f}, {seg.end_x:.0f}] "
                f"({len(seg.x)} points)"
            )

            # Build the input matrix for this segment
            seg_mask = (
                (df[primary_x] >= seg.start_x) &
                (df[primary_x] <= seg.end_x)
            )
            seg_df = df[seg_mask].dropna(subset=x_cols + [y_col])

            if multi_mode and len(seg_df) >= 3:
                # Multi-variable: pass all X columns
                X_seg = seg_df[x_cols].values
                y_seg = seg_df[y_col].values
                result = self.formula_discoverer.discover(
                    X_seg, y_seg,
                    segment_index=seg.segment_index,
                    input_names=x_cols,
                )
            else:
                # Single-variable: use the clean percentile data
                result = self.formula_discoverer.discover(
                    seg.x, seg.y,
                    segment_index=seg.segment_index,
                    input_names=[primary_x],
                )

            formula_results.append(result)
            print(f"    Formula: {result.equation}")
            print(f"    MAE={result.mae:.3f}, "
                  f"MaxErr={result.max_error:.3f}, "
                  f"Exact={result.exact_match_rate:.1%}")
            print(f"    Method: {result.method}\n")

        # Build summary
        summary = self._build_summary(
            x_cols, y_col, filter_result, cap_result_upper, formula_results, feature_selection_result
        )

        self._result = AnalysisResult(
            filter_result=filter_result,
            cap_result_upper=cap_result_upper,
            cap_result_lower=cap_result_lower,
            formula_results=formula_results,
            feature_selection_result=feature_selection_result,
            x_cols=x_cols,
            y_col=y_col,
            summary_text=summary,
        )
        return self._result

    def plot_results(
        self,
        figsize: Tuple[int, int] = (16, 14),
        save_path: Optional[str] = None,
    ) -> None:
        """Plot all 3 stages in a multi-panel figure."""
        import matplotlib.pyplot as plt

        if self._result is None:
            raise RuntimeError("Call fit_and_discover() first.")

        res = self._result
        primary_x = res.x_cols[0]

        fig, axes = plt.subplots(2, 2, figsize=figsize)
        fig.suptitle(
            f"Game Mechanics Analysis: {res.x_cols} -> {res.y_col}",
            fontsize=16, fontweight="bold", y=0.98,
        )

        # Panel 1: Noise Filtering
        ax1 = axes[0, 0]
        NoiseFilter.plot(
            res.filter_result, ax=ax1,
            title=f"Stage 1: Noise Filtering\n"
            f"X = {primary_x} (primary) -> Y = {res.y_col}",
        )

        # Panel 2: Cap Detection
        ax2 = axes[0, 1]
        CapDetector.plot(
            res.cap_result_upper, ax=ax2,
            title=f"Stage 2: Cap Detection on Y_max({primary_x})\n"
            f"Caps: {res.cap_result_upper.thresholds or 'None'}",
        )

        # Panel 3: Formula Discovery
        ax3 = axes[1, 0]
        FormulaDiscoverer.plot(
            res.formula_results,
            segments=res.cap_result_upper.segments,
            ax=ax3, title="Stage 3: Discovered Formulas vs Data",
        )

        # Panel 4: Residuals
        ax4 = axes[1, 1]
        self._plot_residuals(ax4, res)

        plt.tight_layout(rect=[0, 0, 1, 0.96])
        if save_path:
            fig.savefig(save_path, dpi=150, bbox_inches="tight")
            print(f"Figure saved to {save_path}")
        plt.show()

    def _plot_residuals(self, ax, res):
        colours = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6"]
        df = res.filter_result.raw_df
        multi_mode = len(res.x_cols) > 1
        primary_x = res.x_cols[0]

        for fr in res.formula_results:
            if fr.segment_index < len(res.cap_result_upper.segments):
                seg = res.cap_result_upper.segments[fr.segment_index]
                
                if multi_mode:
                    seg_mask = (df[primary_x] >= seg.start_x) & (df[primary_x] <= seg.end_x)
                    seg_df = df[seg_mask].dropna(subset=res.x_cols + [res.y_col])
                    if len(seg_df) >= 3:
                        X_seg = seg_df[res.x_cols].values
                        y_actual = seg_df[res.y_col].values
                        primary_x_arr = seg_df[primary_x].values
                    else:
                        X_seg = seg.x
                        y_actual = seg.y
                        primary_x_arr = seg.x
                else:
                    X_seg = seg.x
                    y_actual = seg.y
                    primary_x_arr = seg.x

                predicted = fr.predict_fn(X_seg)
                residuals = y_actual - predicted
                c = colours[fr.segment_index % len(colours)]
                ax.scatter(primary_x_arr, residuals, color=c, alpha=0.6, s=10,
                           label=f"Seg {fr.segment_index} (MAE={fr.mae:.2f})")
        ax.axhline(0, color="black", linewidth=0.8)
        ax.axhline(0.5, color="grey", linewidth=0.5, linestyle="--", alpha=0.5)
        ax.axhline(-0.5, color="grey", linewidth=0.5, linestyle="--", alpha=0.5)
        ax.set_xlabel(res.x_cols[0], fontsize=12)
        ax.set_ylabel("Residual (actual - predicted)", fontsize=12)
        ax.set_title("Stage 3: Residuals", fontsize=14)
        ax.legend(fontsize=9)
        ax.grid(True, alpha=0.3)

    def summary(self) -> str:
        if self._result is None:
            return "No analysis run yet."
        return self._result.summary_text

    @staticmethod
    def _build_summary(x_cols, y_col, filter_result, cap_result, formula_results, feature_selection_result=None):
        primary = x_cols[0]
        lines = [
            "+==================================================+",
            "|       Game Mechanics Analysis Summary             |",
            "+==================================================+",
            "",
        ]
        
        if feature_selection_result:
            lines.extend([
                "---- Stage 0: Feature Selection ----------------------------",
                f"  Method:      {feature_selection_result.method}",
                f"  Selected:    {feature_selection_result.selected_cols}",
                "  Scores:",
            ])
            for col in feature_selection_result.selected_cols:
                lines.append(f"    - {col}: {feature_selection_result.importance_scores.get(col, 0):.4f}")
            lines.append("")

        lines.extend([
            f"  Predictor(s) (X): {x_cols}",
            f"    Primary var:    {primary}",
            f"  Target       (Y): {y_col}",
            f"  X Range ({primary}): "
            f"[{filter_result.clean_df['x'].min():.0f}, "
            f"{filter_result.clean_df['x'].max():.0f}]",
            f"  Unique X groups:  {len(filter_result.clean_df)}",
            "",
            "---- Cap Detection -----------------------------------------",
            f"  Method:     {cap_result.method}",
            f"  Caps found: {len(cap_result.thresholds)}",
        ])
        if cap_result.thresholds:
            lines.append(f"  Thresholds: {cap_result.thresholds}")
        lines.append(f"  Segments:   {len(cap_result.segments)}")
        lines.append("")
        lines.append("---- Discovered Formulas -----------------------------------")

        for fr in formula_results:
            lines.extend([
                f"  Segment {fr.segment_index}: "
                f"{primary} in [{fr.x_range[0]:.0f}, {fr.x_range[1]:.0f}]",
                f"    Inputs:     {fr.input_names}",
                f"    Formula:    {fr.equation}",
                f"    MAE:        {fr.mae:.4f}",
                f"    Max Error:  {fr.max_error:.4f}",
                f"    Exact Rate: {fr.exact_match_rate:.1%}",
                f"    Method:     {fr.method}",
                "",
            ])
        return "\n".join(lines)

    @classmethod
    def from_fusou_data(
        cls,
        x_cols: Union[str, List[str]] = "attacker_karyoku",
        y_col: str = "damage",
        period_tag: str = "latest",
        table_version: str = "0.5",
        side: str = "friend",
        hit_types: Optional[list] = None,
        cache_dir: Optional[str] = None,
        **kwargs,
    ) -> Tuple["GameMechanicsAnalyzer", AnalysisResult]:
        """Load FUSOU data and run the full analysis.

        Args:
            x_cols: Predictor column(s).
            y_col: Target column.
            period_tag: Data period.
            table_version: DB schema version.
            side: 'friend', 'enemy', or 'both'.
            hit_types: Filter by hit type.
            cache_dir: Cache directory.
            **kwargs: Extra args for __init__.

        Returns:
            Tuple of (analyzer, result).
        """
        from .data_loader import load_shelling_data

        df = load_shelling_data(
            period_tag=period_tag, table_version=table_version,
            side=side, hit_types=hit_types, cache_dir=cache_dir,
        )
        analyzer = cls(**kwargs)
        result = analyzer.fit_and_discover(df, x_cols=x_cols, y_col=y_col)
        return analyzer, result
