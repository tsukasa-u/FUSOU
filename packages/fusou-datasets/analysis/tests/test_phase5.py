"""Tests for phase5_noise module."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import sympy

from fusou_formula.phase5_noise import (
    DistributionFit,
    NoiseAnalyzer,
    NoiseResult,
)


class TestDistributionFit:
    def test_creation(self) -> None:
        d = DistributionFit(name="norm", params={"loc": 0, "scale": 1})
        assert d.name == "norm"
        assert d.aic == float("inf")


class TestNoiseAnalyzer:
    """Tests for the NoiseAnalyzer class."""

    def test_analyse_from_residuals_normal(self) -> None:
        """Normal residuals should fit 'norm' best (or close to it)."""
        rng = np.random.default_rng(42)
        residuals = rng.normal(0, 2.0, 1000)

        analyser = NoiseAnalyzer(n_bins=20)
        result = analyser.analyse_from_residuals(residuals)

        assert isinstance(result, NoiseResult)
        assert len(result.all_fits) > 0
        # Best distribution should exist
        assert result.best_distribution.name in [
            "norm", "logistic", "laplace", "t",
        ]

    def test_analyse_from_residuals_uniform(self) -> None:
        """Uniform residuals should fit 'uniform' reasonably well."""
        rng = np.random.default_rng(42)
        residuals = rng.uniform(-5, 5, 1000)

        analyser = NoiseAnalyzer()
        result = analyser.analyse_from_residuals(residuals)

        # uniform should be among the fits
        fit_names = [f.name for f in result.all_fits]
        assert "uniform" in fit_names

    def test_histogram_output(self) -> None:
        rng = np.random.default_rng(42)
        residuals = rng.normal(0, 1, 500)

        analyser = NoiseAnalyzer(n_bins=15)
        result = analyser.analyse_from_residuals(residuals)

        assert "bin_edges" in result.histogram
        assert "counts" in result.histogram
        assert "density" in result.histogram
        assert len(result.histogram["counts"]) == 15
        assert len(result.histogram["bin_edges"]) == 16

    def test_kde_output(self) -> None:
        rng = np.random.default_rng(42)
        residuals = rng.normal(0, 1, 500)

        analyser = NoiseAnalyzer(kde_points=100)
        result = analyser.analyse_from_residuals(residuals)

        assert len(result.kde_x) == 100
        assert len(result.kde_y) == 100
        assert np.all(result.kde_y >= 0)

    def test_summary_stats(self) -> None:
        rng = np.random.default_rng(42)
        residuals = rng.normal(5, 2, 1000)

        analyser = NoiseAnalyzer()
        result = analyser.analyse_from_residuals(residuals)

        assert "mean" in result.summary
        assert "std" in result.summary
        assert "median" in result.summary
        assert "min" in result.summary
        assert "max" in result.summary
        assert "skewness" in result.summary
        assert "kurtosis" in result.summary
        # Mean should be near 5
        assert abs(result.summary["mean"] - 5) < 0.5

    def test_distribution_fit_aic_bic(self) -> None:
        rng = np.random.default_rng(42)
        residuals = rng.normal(0, 1, 500)

        analyser = NoiseAnalyzer()
        result = analyser.analyse_from_residuals(residuals)

        for fit in result.all_fits:
            assert np.isfinite(fit.aic)
            assert np.isfinite(fit.bic)
            assert fit.ks_stat >= 0
            assert 0 <= fit.ks_p <= 1

    def test_analyse_with_expression(self) -> None:
        """Test the full analyse() path (expression + data)."""
        expr = sympy.sympify("2*x + 1")
        rng = np.random.default_rng(42)
        n = 300
        x = rng.uniform(0, 50, n)
        noise = rng.normal(0, 1, n)
        y = 2 * x + 1 + noise
        df = pd.DataFrame({"x": x, "y": y})

        analyser = NoiseAnalyzer(n_bins=20)
        result = analyser.analyse(expr, df, "y", ["x"])

        assert len(result.residuals) == n
        # Residuals should be roughly the added noise
        assert abs(np.mean(result.residuals)) < 0.5
        assert abs(np.std(result.residuals) - 1) < 0.5

    def test_empty_residuals(self) -> None:
        analyser = NoiseAnalyzer()
        result = analyser.analyse_from_residuals(np.array([]))
        assert "error" in result.metadata

    def test_all_nan_residuals(self) -> None:
        analyser = NoiseAnalyzer()
        result = analyser.analyse_from_residuals(
            np.array([np.nan, np.nan, np.nan]),
        )
        assert "error" in result.metadata

    def test_constant_residuals(self) -> None:
        """All identical residuals — edge case for KDE."""
        analyser = NoiseAnalyzer()
        result = analyser.analyse_from_residuals(np.full(100, 5.0))
        # KDE should handle this gracefully
        assert len(result.kde_x) >= 1

    def test_too_few_residuals(self) -> None:
        analyser = NoiseAnalyzer()
        result = analyser.analyse_from_residuals(np.array([1.0, 2.0]))
        # Should get histogram and KDE but no fits (n < 5)
        assert len(result.all_fits) == 0

    def test_param_names(self) -> None:
        """Check that _get_param_names returns proper keys."""
        from scipy import stats

        analyser = NoiseAnalyzer()
        rng = np.random.default_rng(42)
        residuals = rng.normal(0, 1, 100)
        fits = analyser._fit_distributions(residuals)

        for f in fits:
            assert "loc" in f.params
            assert "scale" in f.params

    def test_custom_distributions(self) -> None:
        rng = np.random.default_rng(42)
        residuals = rng.normal(0, 1, 200)

        analyser = NoiseAnalyzer(candidate_distributions=["norm", "laplace"])
        result = analyser.analyse_from_residuals(residuals)
        fit_names = {f.name for f in result.all_fits}
        assert fit_names <= {"norm", "laplace"}
