"""Phase 5: Noise (residual) distribution analysis.

Characterises the stochastic component of the data — the part that
the deterministic formula cannot explain.  This is done purely from
the residuals, with no assumptions about the noise shape.

Methods:
1. **Histogram / KDE** — non-parametric density estimate of residuals.
2. **Parametric fitting** — fits several candidate distributions
   (normal, uniform, Laplace, …) and selects the best by AIC.
3. **Summary statistics** — mean, std, skewness, kurtosis, quantiles.

References
----------
- Silverman (1986) — Kernel Density Estimation.
- Burnham & Anderson (2002) — AIC model selection.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import sympy


@dataclass
class DistributionFit:
    """Result of fitting a single parametric distribution.

    Attributes
    ----------
    name : str
        Distribution name (e.g. ``"norm"``, ``"uniform"``).
    params : dict
        Fitted parameters (e.g. ``{"loc": 0.0, "scale": 1.0}``).
    aic : float
        Akaike Information Criterion (lower is better).
    bic : float
        Bayesian Information Criterion.
    ks_stat : float
        Kolmogorov–Smirnov test statistic.
    ks_p : float
        KS test p-value (p > 0.05 → cannot reject the distribution).
    """

    name: str
    params: Dict[str, float] = field(default_factory=dict)
    aic: float = float("inf")
    bic: float = float("inf")
    ks_stat: float = 0.0
    ks_p: float = 0.0


@dataclass
class NoiseResult:
    """Result of noise analysis (Phase 5).

    Attributes
    ----------
    residuals : np.ndarray
        Raw residual array (y_true − y_pred).
    best_distribution : DistributionFit
        Best-fitting parametric distribution (by AIC).
    all_fits : list of DistributionFit
        All candidate distribution fits, sorted by AIC.
    histogram : dict
        ``{"bin_edges": [...], "counts": [...], "density": [...]}``.
    kde_x : np.ndarray
        X values for the KDE curve.
    kde_y : np.ndarray
        Y values (density) for the KDE curve.
    summary : dict
        Summary statistics of the residuals.
    metadata : dict
    """

    residuals: np.ndarray = field(default_factory=lambda: np.array([]))
    best_distribution: DistributionFit = field(
        default_factory=lambda: DistributionFit(name="unknown"),
    )
    all_fits: List[DistributionFit] = field(default_factory=list)
    histogram: Dict[str, Any] = field(default_factory=dict)
    kde_x: np.ndarray = field(default_factory=lambda: np.array([]))
    kde_y: np.ndarray = field(default_factory=lambda: np.array([]))
    summary: Dict[str, float] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)


class NoiseAnalyzer:
    """Analyse the noise (residual) distribution.

    Parameters
    ----------
    n_bins : int
        Number of histogram bins.
    kde_points : int
        Number of points for the KDE curve.
    candidate_distributions : list of str or None
        scipy.stats distribution names to try.  If *None*, uses a
        sensible default set.
    """

    DEFAULT_DISTRIBUTIONS = [
        "norm",       # Gaussian
        "uniform",    # Uniform
        "laplace",    # Laplace (double-exponential)
        "logistic",   # Logistic
        "t",          # Student-t (heavy tails)
        "cauchy",     # Cauchy (very heavy tails)
        "expon",      # Exponential (one-sided)
    ]

    def __init__(
        self,
        n_bins: int = 30,
        kde_points: int = 200,
        candidate_distributions: Optional[List[str]] = None,
    ) -> None:
        self.n_bins = n_bins
        self.kde_points = kde_points
        self.candidate_distributions = (
            candidate_distributions or self.DEFAULT_DISTRIBUTIONS
        )

    def analyse(
        self,
        expr: sympy.Expr,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> NoiseResult:
        """Compute residuals and analyse their distribution.

        Parameters
        ----------
        expr : sympy.Expr
            The fitted deterministic formula.
        df : DataFrame
        target_col : str
        feature_cols : list of str

        Returns
        -------
        NoiseResult
        """
        from fusou_formula.phase3_symbolic import SymbolicSearcher

        y_pred = SymbolicSearcher.evaluate_expr(expr, df, feature_cols)
        y_true = df[target_col].values.astype(np.float64)

        valid = np.isfinite(y_pred) & np.isfinite(y_true)
        residuals = y_true[valid] - y_pred[valid]

        if len(residuals) == 0:
            return NoiseResult(metadata={"error": "no valid residuals"})

        # Histogram
        histogram = self._compute_histogram(residuals)

        # KDE
        kde_x, kde_y = self._compute_kde(residuals)

        # Parametric fits
        all_fits = self._fit_distributions(residuals)

        # Best by AIC
        best = min(all_fits, key=lambda f: f.aic) if all_fits else DistributionFit(
            name="unknown",
        )

        # Summary statistics
        summary = self._summary_stats(residuals)

        return NoiseResult(
            residuals=residuals,
            best_distribution=best,
            all_fits=all_fits,
            histogram=histogram,
            kde_x=kde_x,
            kde_y=kde_y,
            summary=summary,
            metadata={
                "n_residuals": len(residuals),
                "n_bins": self.n_bins,
            },
        )

    def analyse_from_residuals(
        self,
        residuals: np.ndarray,
    ) -> NoiseResult:
        """Analyse pre-computed residuals.

        Parameters
        ----------
        residuals : np.ndarray

        Returns
        -------
        NoiseResult
        """
        residuals = residuals[np.isfinite(residuals)]
        if len(residuals) == 0:
            return NoiseResult(metadata={"error": "no valid residuals"})

        histogram = self._compute_histogram(residuals)
        kde_x, kde_y = self._compute_kde(residuals)
        all_fits = self._fit_distributions(residuals)
        best = min(all_fits, key=lambda f: f.aic) if all_fits else DistributionFit(
            name="unknown",
        )
        summary = self._summary_stats(residuals)

        return NoiseResult(
            residuals=residuals,
            best_distribution=best,
            all_fits=all_fits,
            histogram=histogram,
            kde_x=kde_x,
            kde_y=kde_y,
            summary=summary,
            metadata={"n_residuals": len(residuals), "n_bins": self.n_bins},
        )

    # ------------------------------------------------------------------
    # Histogram
    # ------------------------------------------------------------------

    def _compute_histogram(
        self,
        residuals: np.ndarray,
    ) -> Dict[str, Any]:
        """Compute histogram of residuals."""
        counts, bin_edges = np.histogram(residuals, bins=self.n_bins, density=False)
        density, _ = np.histogram(residuals, bins=self.n_bins, density=True)
        return {
            "bin_edges": [float(b) for b in bin_edges],
            "counts": [int(c) for c in counts],
            "density": [float(d) for d in density],
        }

    # ------------------------------------------------------------------
    # KDE
    # ------------------------------------------------------------------

    def _compute_kde(
        self,
        residuals: np.ndarray,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Compute Gaussian KDE of residuals."""
        from scipy.stats import gaussian_kde  # type: ignore[import-untyped]

        if len(residuals) < 2:
            return np.array([0.0]), np.array([0.0])

        # Handle case where all residuals are identical
        if np.std(residuals) < 1e-15:
            x = np.array([residuals[0]])
            y = np.array([1.0])
            return x, y

        try:
            kde = gaussian_kde(residuals)
            lo = float(np.min(residuals))
            hi = float(np.max(residuals))
            margin = (hi - lo) * 0.1 + 1e-8
            x = np.linspace(lo - margin, hi + margin, self.kde_points)
            y = kde(x)
            return x, y
        except Exception:
            return np.array([0.0]), np.array([0.0])

    # ------------------------------------------------------------------
    # Parametric distribution fitting
    # ------------------------------------------------------------------

    def _fit_distributions(
        self,
        residuals: np.ndarray,
    ) -> List[DistributionFit]:
        """Fit candidate distributions and compute AIC / BIC / KS."""
        from scipy import stats as sp_stats  # type: ignore[import-untyped]

        n = len(residuals)
        if n < 5:
            return []

        fits: List[DistributionFit] = []

        for dist_name in self.candidate_distributions:
            try:
                dist = getattr(sp_stats, dist_name)
            except AttributeError:
                continue

            try:
                # Fit parameters via MLE
                params = dist.fit(residuals)

                # Log-likelihood
                ll = float(np.sum(dist.logpdf(residuals, *params)))
                k = len(params)  # number of fitted parameters
                aic = 2 * k - 2 * ll
                bic = k * np.log(n) - 2 * ll

                # KS test
                ks_result = sp_stats.kstest(residuals, dist_name, args=params)
                ks_stat = float(ks_result.statistic)
                ks_p = float(ks_result.pvalue)

                # Build params dict
                # scipy naming convention: last two are usually loc, scale
                param_names = self._get_param_names(dist, params)

                fits.append(DistributionFit(
                    name=dist_name,
                    params=param_names,
                    aic=float(aic),
                    bic=float(bic),
                    ks_stat=ks_stat,
                    ks_p=ks_p,
                ))
            except Exception:
                continue

        fits.sort(key=lambda f: f.aic)
        return fits

    @staticmethod
    def _get_param_names(
        dist: Any,
        params: Tuple[float, ...],
    ) -> Dict[str, float]:
        """Map fitted parameters to named dict."""
        # scipy convention: shape params first, then loc, scale
        names: List[str] = []
        if hasattr(dist, "shapes") and dist.shapes:
            names.extend(dist.shapes.split(", "))
        names.extend(["loc", "scale"])

        result: Dict[str, float] = {}
        for name, val in zip(names, params):
            result[name] = float(val)
        return result

    # ------------------------------------------------------------------
    # Summary statistics
    # ------------------------------------------------------------------

    @staticmethod
    def _summary_stats(residuals: np.ndarray) -> Dict[str, float]:
        """Compute summary statistics of residuals."""
        from scipy import stats as sp_stats  # type: ignore[import-untyped]

        n = len(residuals)
        if n == 0:
            return {}

        return {
            "mean": float(np.mean(residuals)),
            "std": float(np.std(residuals, ddof=1)) if n > 1 else 0.0,
            "median": float(np.median(residuals)),
            "min": float(np.min(residuals)),
            "max": float(np.max(residuals)),
            "q25": float(np.quantile(residuals, 0.25)),
            "q75": float(np.quantile(residuals, 0.75)),
            "skewness": float(sp_stats.skew(residuals)),
            "kurtosis": float(sp_stats.kurtosis(residuals)),
            "n": n,
        }
