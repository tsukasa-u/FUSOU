"""
Module 1: NoiseFilter -- Quantile-based noise extraction.

============================================================
What this module does
============================================================
Game damage values contain inherent randomness (RNG).  For a given set
of input stats, the observed damage Y is drawn from a range:

    Y in [f(X1, X2, ...) * rand_min,  f(X1, X2, ...) * rand_max]

This module supports two modes:

1. **Single-variable mode**: Group by one X column and compute
   percentile boundaries.  Best for visual exploration.

2. **Multi-variable mode**: Group by multiple X columns (binned)
   to isolate noise in higher-dimensional space.  Sparser but
   controls for confounders.

Variables
---------
    Input X (x_cols): One or more predictor columns (e.g. karyoku, soukou).
    Input Y (y_col):  Observed damage.
    Output:           DataFrame with group keys, y_max, y_min, y_median, count.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Union

import numpy as np
import pandas as pd


@dataclass
class FilterResult:
    """Result of the NoiseFilter stage.

    Attributes:
        clean_df: DataFrame with group columns + y_max, y_min, y_median, count.
        raw_df: Original raw DataFrame (for plotting).
        x_cols: List of X column names used for grouping.
        y_col: Name of the Y column.
        upper_quantile: Upper percentile used.
        lower_quantile: Lower percentile used.
    """
    clean_df: pd.DataFrame
    raw_df: pd.DataFrame
    x_cols: List[str]
    y_col: str
    upper_quantile: float = 0.99
    lower_quantile: float = 0.01


class NoiseFilter:
    """Quantile-based noise filter for game combat data.

    Supports both single-variable and multi-variable grouping.

    Example (single-variable):
        >>> nf = NoiseFilter()
        >>> result = nf.filter(df, x_cols="attacker_karyoku", y_col="damage")

    Example (multi-variable, controls for armor):
        >>> result = nf.filter(df, x_cols=["attacker_karyoku", "defender_soukou"],
        ...                    y_col="damage", bin_size={"defender_soukou": 10})
    """

    def __init__(
        self,
        upper_quantile: float = 0.99,
        lower_quantile: float = 0.01,
        min_samples: int = 5,
    ) -> None:
        """Initialise the noise filter.

        Args:
            upper_quantile: Percentile for the upper boundary (0-1).
            lower_quantile: Percentile for the lower boundary (0-1).
            min_samples: Minimum observations per group.
        """
        if not (0 < lower_quantile < upper_quantile < 1):
            raise ValueError(
                f"Quantiles must satisfy 0 < lower < upper < 1, "
                f"got lower={lower_quantile}, upper={upper_quantile}"
            )
        self.upper_quantile = upper_quantile
        self.lower_quantile = lower_quantile
        self.min_samples = min_samples

    def filter(
        self,
        df: pd.DataFrame,
        x_cols: Union[str, List[str]],
        y_col: str,
        bin_size: Optional[dict] = None,
    ) -> FilterResult:
        """Apply quantile-based noise filtering.

        Args:
            df: Raw battle-log DataFrame.
            x_cols: Column name(s) for predictor(s).  Can be a single
                    string or a list of strings for multi-variable mode.
            y_col: Column name for the target variable.
            bin_size: Optional dict of {col_name: bin_width} for binning
                      continuous variables before grouping.  Only needed
                      for multi-variable mode when exact grouping is too
                      sparse.

        Returns:
            FilterResult containing the cleaned percentile curves.
        """
        # Normalise x_cols to list
        if isinstance(x_cols, str):
            x_cols = [x_cols]

        for col in list(x_cols) + [y_col]:
            if col not in df.columns:
                raise ValueError(
                    f"Column '{col}' not found. Available: {list(df.columns)}"
                )

        work = df[list(x_cols) + [y_col]].dropna().copy()

        # Binning for multi-variable mode
        group_cols = list(x_cols)
        if bin_size:
            for col, bw in bin_size.items():
                if col in group_cols:
                    bin_col = f"_bin_{col}"
                    work[bin_col] = (work[col] // bw) * bw
                    group_cols = [bin_col if c == col else c for c in group_cols]

        # Group and compute percentiles
        grouped = work.groupby(group_cols, observed=True)[y_col]
        agg = grouped.agg(
            y_max=lambda s: np.percentile(s, self.upper_quantile * 100),
            y_min=lambda s: np.percentile(s, self.lower_quantile * 100),
            y_median="median",
            count="count",
        )

        agg = agg[agg["count"] >= self.min_samples]
        agg = agg.reset_index()

        # If binned, rename back for clarity
        for col_name in list(agg.columns):
            if col_name.startswith("_bin_"):
                orig = col_name[5:]
                agg = agg.rename(columns={col_name: orig})

        # For single-variable, rename the X column to "x" for consistency
        if len(x_cols) == 1:
            agg = agg.rename(columns={x_cols[0]: "x"})
            agg = agg.sort_values("x").reset_index(drop=True)

        return FilterResult(
            clean_df=agg,
            raw_df=df,
            x_cols=x_cols,
            y_col=y_col,
            upper_quantile=self.upper_quantile,
            lower_quantile=self.lower_quantile,
        )

    @staticmethod
    def plot(
        result: FilterResult,
        ax=None,
        show_raw: bool = True,
        title: Optional[str] = None,
        primary_x: Optional[str] = None,
    ):
        """Plot the quantile-filtered result.

        For single-variable results, shows scatter + percentile lines.
        For multi-variable, plots along the first X column (or ``primary_x``).

        Args:
            result: A FilterResult from filter().
            ax: Matplotlib Axes (created if None).
            show_raw: Whether to show raw scatter.
            title: Custom plot title.
            primary_x: Which X column to use as the horizontal axis
                        (for multi-variable results).

        Returns:
            The matplotlib Axes object.
        """
        import matplotlib.pyplot as plt

        if ax is None:
            _, ax = plt.subplots(figsize=(10, 6))

        clean = result.clean_df

        # Determine X axis column
        if len(result.x_cols) == 1:
            x_key = "x"
            x_label = result.x_cols[0]
        else:
            x_key = primary_x or result.x_cols[0]
            x_label = x_key

        if show_raw and len(result.x_cols) == 1:
            ax.scatter(
                result.raw_df[result.x_cols[0]],
                result.raw_df[result.y_col],
                alpha=0.08, s=4, color="grey",
                label="Raw data", rasterized=True,
            )

        ax.plot(clean[x_key], clean["y_max"], color="#e74c3c",
                linewidth=2, label=f"Upper ({result.upper_quantile:.0%})")
        ax.plot(clean[x_key], clean["y_min"], color="#3498db",
                linewidth=2, label=f"Lower ({result.lower_quantile:.0%})")
        ax.plot(clean[x_key], clean["y_median"], color="#2ecc71",
                linewidth=1.5, linestyle="--", label="Median (50%)")

        ax.set_xlabel(x_label, fontsize=12)
        ax.set_ylabel(result.y_col, fontsize=12)
        ax.set_title(
            title or f"Noise Filtering: {x_label} -> {result.y_col}",
            fontsize=14,
        )
        ax.legend(fontsize=10)
        ax.grid(True, alpha=0.3)
        return ax
