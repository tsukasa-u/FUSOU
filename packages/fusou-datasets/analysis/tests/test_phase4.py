"""Tests for phase4_validation module."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import sympy

from fusou_formula.phase4_validation import (
    FoldMetrics,
    ModelValidator,
    ResidualDiagnostics,
    ValidationResult,
)


class TestModelValidator:
    """Tests for the ModelValidator class."""

    def test_perfect_model(self) -> None:
        """An exact formula should give near-zero error."""
        expr = sympy.sympify("2*x + 3")
        rng = np.random.default_rng(42)
        n = 200
        x = rng.uniform(0, 100, n)
        y = 2 * x + 3
        df = pd.DataFrame({"x": x, "y": y})

        validator = ModelValidator(n_folds=5, random_state=42)
        result = validator.validate(expr, df, "y", ["x"])

        assert isinstance(result, ValidationResult)
        assert result.overall_mae < 1e-10
        assert result.overall_rmse < 1e-10
        assert result.overall_r2 > 0.999

    def test_noisy_model(self) -> None:
        """A formula with noise should still show decent R²."""
        expr = sympy.sympify("2*x + 3")
        rng = np.random.default_rng(42)
        n = 500
        x = rng.uniform(0, 100, n)
        noise = rng.normal(0, 2, n)
        y = 2 * x + 3 + noise
        df = pd.DataFrame({"x": x, "y": y})

        validator = ModelValidator(n_folds=5, random_state=42)
        result = validator.validate(expr, df, "y", ["x"])

        assert result.overall_r2 > 0.9
        assert result.overall_mae > 0
        assert len(result.fold_metrics) == 5

    def test_fold_metrics(self) -> None:
        expr = sympy.sympify("x")
        rng = np.random.default_rng(42)
        df = pd.DataFrame({
            "x": rng.uniform(0, 10, 100),
            "y": rng.uniform(0, 10, 100) + rng.uniform(0, 10, 100),
        })

        validator = ModelValidator(n_folds=3, random_state=42)
        result = validator.validate(expr, df, "y", ["x"])

        assert len(result.fold_metrics) == 3
        for fm in result.fold_metrics:
            assert isinstance(fm, FoldMetrics)
            assert fm.n_samples > 0
            assert fm.mae >= 0

    def test_residual_diagnostics(self) -> None:
        """Check that residual diagnostics are computed."""
        expr = sympy.sympify("2*x")
        rng = np.random.default_rng(42)
        n = 300
        x = rng.uniform(0, 100, n)
        y = 2 * x + rng.normal(0, 1, n)
        df = pd.DataFrame({"x": x, "y": y})

        validator = ModelValidator(random_state=42)
        result = validator.validate(expr, df, "y", ["x"])

        diag = result.residual_diagnostics
        assert isinstance(diag, ResidualDiagnostics)
        assert abs(diag.mean) < 1  # Should be near 0
        assert diag.std > 0
        # Shapiro p-value should be high for normal residuals
        assert diag.shapiro_p > 0.01
        # Durbin-Watson should be near 2 for uncorrelated residuals
        assert 1.0 < diag.dw_stat < 3.0

    def test_prediction_interval(self) -> None:
        """Prediction interval should bracket most residuals."""
        expr = sympy.sympify("x")
        rng = np.random.default_rng(42)
        n = 300
        x = rng.uniform(0, 100, n)
        y = x + rng.normal(0, 5, n)
        df = pd.DataFrame({"x": x, "y": y})

        validator = ModelValidator(interval_coverage=0.9, random_state=42)
        result = validator.validate(expr, df, "y", ["x"])

        lo, hi = result.prediction_interval
        assert lo < 0  # Lower offset should be negative
        assert hi > 0  # Upper offset should be positive

    def test_multi_variable_expr(self) -> None:
        expr = sympy.sympify("x + 2*y")
        rng = np.random.default_rng(42)
        n = 200
        x = rng.uniform(0, 50, n)
        y_feat = rng.uniform(0, 50, n)
        target = x + 2 * y_feat + rng.normal(0, 0.1, n)
        df = pd.DataFrame({"x": x, "y": y_feat, "target": target})

        validator = ModelValidator(n_folds=3, random_state=42)
        result = validator.validate(expr, df, "target", ["x", "y"])

        assert result.overall_r2 > 0.99

    def test_empty_valid_data(self) -> None:
        """All-NaN target should give inf errors."""
        expr = sympy.sympify("x")
        df = pd.DataFrame({"x": [1, 2, 3], "y": [np.nan, np.nan, np.nan]})

        validator = ModelValidator(n_folds=2, random_state=42)
        result = validator.validate(expr, df, "y", ["x"])

        assert result.overall_mae == float("inf") or result.n_samples == 0

    def test_expr_latex(self) -> None:
        expr = sympy.sympify("x**2 + 1")
        rng = np.random.default_rng(42)
        df = pd.DataFrame({
            "x": rng.uniform(0, 10, 50),
            "y": rng.uniform(0, 100, 50),
        })
        validator = ModelValidator(n_folds=2, random_state=42)
        result = validator.validate(expr, df, "y", ["x"])
        assert result.expr_latex  # should have LaTeX


class TestDurbinWatson:
    def test_no_autocorrelation(self) -> None:
        rng = np.random.default_rng(42)
        resid = rng.normal(0, 1, 1000)
        dw = ModelValidator._durbin_watson(resid)
        # Should be near 2
        assert 1.5 < dw < 2.5

    def test_perfect_positive_autocorrelation(self) -> None:
        # Monotonically increasing residuals
        resid = np.cumsum(np.ones(100))
        dw = ModelValidator._durbin_watson(resid)
        # Should be near 0 for positive autocorrelation
        assert dw < 0.5

    def test_single_element(self) -> None:
        assert ModelValidator._durbin_watson(np.array([1.0])) == 2.0

    def test_zero_residuals(self) -> None:
        assert ModelValidator._durbin_watson(np.zeros(10)) == 2.0


class TestSafeEval:
    def test_normal_evaluation(self) -> None:
        fn = lambda x: x * 2  # noqa: E731
        X = np.array([[1], [2], [3]])
        result = ModelValidator._safe_eval(fn, X)
        np.testing.assert_allclose(result, [2, 4, 6])

    def test_error_handling(self) -> None:
        def bad_fn(x: np.ndarray) -> np.ndarray:
            raise RuntimeError("boom")

        X = np.array([[1.0], [2.0]])
        # The fallback row-by-row evaluation should also fail → NaN
        result = ModelValidator._safe_eval(bad_fn, X)
        assert len(result) == 2
