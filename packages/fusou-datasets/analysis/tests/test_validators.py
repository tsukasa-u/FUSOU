"""Tests for validators module."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import sympy

from fusou_formula.validators import (
    ComparisonMetrics,
    ComparisonResult,
    FormulaValidator,
)


class TestFormulaValidator:
    def test_evaluate_accuracy_perfect(self) -> None:
        expr = sympy.sympify("2*x + 1")
        rng = np.random.default_rng(42)
        x = rng.uniform(0, 10, 100)
        y = 2 * x + 1
        df = pd.DataFrame({"x": x, "y": y})

        validator = FormulaValidator()
        metrics = validator.evaluate_accuracy(expr, df, "y", ["x"])

        assert metrics.mae < 1e-10
        assert metrics.rmse < 1e-10
        assert metrics.r2 > 0.999
        assert metrics.n_samples == 100

    def test_evaluate_accuracy_with_noise(self) -> None:
        expr = sympy.sympify("x")
        rng = np.random.default_rng(42)
        x = rng.uniform(0, 100, 200)
        y = x + rng.normal(0, 5, 200)
        df = pd.DataFrame({"x": x, "y": y})

        validator = FormulaValidator()
        metrics = validator.evaluate_accuracy(expr, df, "y", ["x"])

        assert metrics.mae > 0
        assert metrics.r2 > 0.5  # Still decent

    def test_evaluate_accuracy_empty(self) -> None:
        expr = sympy.sympify("x")
        df = pd.DataFrame({"x": [np.nan], "y": [np.nan]})

        validator = FormulaValidator()
        metrics = validator.evaluate_accuracy(expr, df, "y", ["x"])
        assert metrics.n_samples == 0

    def test_compare_identical_formulas(self) -> None:
        validator = FormulaValidator()
        expr = sympy.sympify("2*x + 1")

        result = validator.compare_with_known(expr, expr)
        assert result.structural_match is True
        assert result.structural_similarity == 1.0

    def test_compare_equivalent_formulas(self) -> None:
        validator = FormulaValidator()
        e1 = sympy.sympify("(x + 1)**2")
        e2 = sympy.sympify("x**2 + 2*x + 1")

        result = validator.compare_with_known(e1, e2)
        assert result.structural_match is True
        assert result.structural_similarity == 1.0

    def test_compare_different_formulas(self) -> None:
        validator = FormulaValidator()
        e1 = sympy.sympify("x**2")
        e2 = sympy.sympify("x**3")

        result = validator.compare_with_known(e1, e2)
        assert result.structural_match is False
        assert 0 <= result.structural_similarity <= 1

    def test_compare_with_data(self) -> None:
        validator = FormulaValidator()
        discovered = sympy.sympify("2*x + 1.1")
        known = sympy.sympify("2*x + 1")

        rng = np.random.default_rng(42)
        x = rng.uniform(0, 10, 100)
        y = 2 * x + 1  # actual data matches known
        df = pd.DataFrame({"x": x, "y": y})

        result = validator.compare_with_known(
            discovered, known,
            test_df=df, target_col="y", feature_cols=["x"],
        )

        assert result.numerical_metrics.n_samples == 100
        # Small error from 0.1 offset
        assert 0 < result.numerical_metrics.mae < 0.2

    def test_generate_report(self) -> None:
        validator = FormulaValidator()
        result = ComparisonResult(
            structural_match=True,
            structural_similarity=0.95,
            numerical_metrics=ComparisonMetrics(
                mae=0.1, rmse=0.15, max_error=0.5, r2=0.99, n_samples=100,
            ),
            discovered_latex="2 x + 1",
            known_latex="2 x + 1",
            diff_summary="identical operation sets",
        )

        report = validator.generate_report([result])
        assert "# Validation Report" in report
        assert "Formula 1" in report
        assert "MAE" in report
        assert "R²" in report

    def test_diff_summary(self) -> None:
        e1 = sympy.sympify("x**2")
        e2 = sympy.sympify("log(x)")
        summary = FormulaValidator._diff_summary(e1, e2)
        # Should mention different operations
        assert len(summary) > 0

    def test_diff_summary_identical(self) -> None:
        expr = sympy.sympify("x + 1")
        summary = FormulaValidator._diff_summary(expr, expr)
        assert "identical" in summary
