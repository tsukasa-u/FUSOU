"""Tests for phase3_symbolic module.

PySR requires Julia and is expensive to run.  These tests focus on
the non-PySR utilities (evaluate_expr, from_sympy, sympy_to_ast_tree,
BIC computation, etc.) and only test PySR integration via mocking.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest import mock

import numpy as np
import pandas as pd
import pytest
import sympy

from fusou_formula.phase3_symbolic import (
    ExpressionCandidate,
    SymbolicResult,
    SymbolicSearcher,
)


class TestExpressionCandidate:
    def test_auto_latex(self) -> None:
        expr = sympy.sympify("x + y")
        c = ExpressionCandidate(sympy_expr=expr, complexity=2, loss=0.1)
        assert c.latex  # should be auto-generated
        assert "x" in c.latex

    def test_explicit_latex(self) -> None:
        expr = sympy.sympify("x")
        c = ExpressionCandidate(
            sympy_expr=expr, complexity=1, loss=0.0, latex="custom",
        )
        assert c.latex == "custom"

    def test_bic_default(self) -> None:
        expr = sympy.sympify("x")
        c = ExpressionCandidate(sympy_expr=expr, complexity=1, loss=0.0)
        assert c.bic == float("inf")


class TestSymbolicResult:
    def test_get_best_bic(self) -> None:
        c1 = ExpressionCandidate(
            sympy_expr=sympy.sympify("x"), complexity=1, loss=1.0, bic=100,
        )
        c2 = ExpressionCandidate(
            sympy_expr=sympy.sympify("x + 1"), complexity=2, loss=0.5, bic=50,
        )
        result = SymbolicResult(best=c1, pareto_front=[c1, c2])
        best = result.get_best("bic")
        assert best.bic == 50

    def test_get_best_loss(self) -> None:
        c1 = ExpressionCandidate(
            sympy_expr=sympy.sympify("x"), complexity=1, loss=1.0, bic=100,
        )
        c2 = ExpressionCandidate(
            sympy_expr=sympy.sympify("x + 1"), complexity=2, loss=0.5, bic=200,
        )
        result = SymbolicResult(best=c1, pareto_front=[c1, c2])
        best = result.get_best("loss")
        assert best.loss == 0.5

    def test_get_best_score(self) -> None:
        c1 = ExpressionCandidate(
            sympy_expr=sympy.sympify("x"), complexity=1, loss=1.0,
            score=0.1, bic=100,
        )
        c2 = ExpressionCandidate(
            sympy_expr=sympy.sympify("x + 1"), complexity=2, loss=0.5,
            score=0.9, bic=200,
        )
        result = SymbolicResult(best=c1, pareto_front=[c1, c2])
        best = result.get_best("score")
        assert best.score == 0.9

    def test_get_best_invalid_metric(self) -> None:
        c = ExpressionCandidate(
            sympy_expr=sympy.sympify("x"), complexity=1, loss=0.0,
        )
        result = SymbolicResult(best=c, pareto_front=[c])
        with pytest.raises(ValueError, match="Unknown metric"):
            result.get_best("invalid")

    def test_get_best_empty_pareto(self) -> None:
        c = ExpressionCandidate(
            sympy_expr=sympy.sympify("x"), complexity=1, loss=0.0,
        )
        result = SymbolicResult(best=c, pareto_front=[])
        assert result.get_best() is c


class TestEvaluateExpr:
    """Tests for SymbolicSearcher.evaluate_expr."""

    def test_simple_expression(self) -> None:
        expr = sympy.sympify("2*x + 3")
        df = pd.DataFrame({"x": [0, 1, 2, 10]})
        result = SymbolicSearcher.evaluate_expr(expr, df, ["x"])
        expected = np.array([3.0, 5.0, 7.0, 23.0])
        np.testing.assert_allclose(result, expected)

    def test_multi_variable(self) -> None:
        expr = sympy.sympify("x + y*2")
        df = pd.DataFrame({"x": [1, 2], "y": [3, 4]})
        result = SymbolicSearcher.evaluate_expr(expr, df, ["x", "y"])
        expected = np.array([7.0, 10.0])
        np.testing.assert_allclose(result, expected)

    def test_with_params(self) -> None:
        a, x = sympy.symbols("a x")
        expr = a * x
        df = pd.DataFrame({"x": [1.0, 2.0, 3.0]})
        result = SymbolicSearcher.evaluate_expr(
            expr, df, ["x"], params={"a": 5.0},
        )
        expected = np.array([5.0, 10.0, 15.0])
        np.testing.assert_allclose(result, expected)

    def test_division_by_zero(self) -> None:
        expr = sympy.sympify("1/x")
        df = pd.DataFrame({"x": [0.0, 1.0, 2.0]})
        result = SymbolicSearcher.evaluate_expr(expr, df, ["x"])
        # x=0 should give inf or nan, other values should work
        assert np.isfinite(result[1])
        assert np.isfinite(result[2])

    def test_sqrt_of_negative(self) -> None:
        expr = sympy.sympify("sqrt(x)")
        df = pd.DataFrame({"x": [-1.0, 0.0, 4.0, 9.0]})
        result = SymbolicSearcher.evaluate_expr(expr, df, ["x"])
        assert np.isfinite(result[2])
        np.testing.assert_allclose(result[2], 2.0)
        np.testing.assert_allclose(result[3], 3.0)


class TestFromSympy:
    """Tests for SymbolicSearcher.from_sympy."""

    def test_from_string(self) -> None:
        result = SymbolicSearcher.from_sympy("x + y")
        assert isinstance(result, SymbolicResult)
        assert len(result.pareto_front) == 1
        assert set(result.feature_cols) == {"x", "y"}

    def test_from_sympy_expr(self) -> None:
        expr = sympy.sympify("x**2 + 1")
        result = SymbolicSearcher.from_sympy(expr)
        assert result.best.sympy_expr == expr

    def test_bic_computation(self) -> None:
        result = SymbolicSearcher.from_sympy(
            "x + y", loss=1.0, n_samples=100,
        )
        assert result.best.bic > 0
        assert np.isfinite(result.best.bic)

    def test_bic_zero_loss(self) -> None:
        result = SymbolicSearcher.from_sympy(
            "x + y", loss=0.0, n_samples=100,
        )
        # loss=0 → log(1e-300) very negative → BIC is large negative
        assert result.best.bic < 0
        assert np.isfinite(result.best.bic)


class TestSympyToAstTree:
    """Tests for ReactFlow AST tree conversion."""

    def test_simple_expr(self) -> None:
        expr = sympy.sympify("x + 1")
        tree = SymbolicSearcher.sympy_to_ast_tree(expr)
        assert "nodes" in tree
        assert "edges" in tree
        assert len(tree["nodes"]) >= 2
        # Check node structure
        for node in tree["nodes"]:
            assert "id" in node
            assert "type" in node
            assert "data" in node
            assert "position" in node

    def test_variable_node(self) -> None:
        expr = sympy.Symbol("x")
        tree = SymbolicSearcher.sympy_to_ast_tree(expr)
        assert tree["nodes"][0]["type"] == "variable"
        assert tree["nodes"][0]["data"]["label"] == "x"

    def test_constant_node(self) -> None:
        expr = sympy.Integer(42)
        tree = SymbolicSearcher.sympy_to_ast_tree(expr)
        assert tree["nodes"][0]["type"] == "constant"

    def test_complex_expr(self) -> None:
        expr = sympy.sympify("sqrt(x**2 + y**2)")
        tree = SymbolicSearcher.sympy_to_ast_tree(expr)
        assert len(tree["nodes"]) > 3
        # Should have edges connecting operator to children
        assert len(tree["edges"]) > 0

    def test_edges_consistency(self) -> None:
        expr = sympy.sympify("x + y")
        tree = SymbolicSearcher.sympy_to_ast_tree(expr)
        node_ids = {n["id"] for n in tree["nodes"]}
        for edge in tree["edges"]:
            assert edge["source"] in node_ids
            assert edge["target"] in node_ids


class TestPySRMocked:
    """Test the PySR fit path with a mock."""

    def test_fit_with_mock(self) -> None:
        searcher = SymbolicSearcher()

        mock_equations = pd.DataFrame({
            "sympy_format": [sympy.sympify("x + 1"), sympy.sympify("x*2")],
            "complexity": [2, 3],
            "loss": [1.0, 0.5],
            "score": [0.5, 0.8],
        })

        mock_model = mock.MagicMock()
        mock_model.equations_ = mock_equations
        mock_model.fit = mock.MagicMock()

        # Test _extract_pareto directly (avoids needing to mock the import)
        pareto = SymbolicSearcher._extract_pareto(mock_model, ["x"], 50)
        assert len(pareto) == 2
        # BIC should be computed for each
        for c in pareto:
            assert np.isfinite(c.bic)

    def test_extract_pareto_fallback(self) -> None:
        """Test fallback when equations_ is missing."""
        mock_model = mock.MagicMock()
        mock_model.equations_ = None
        mock_model.sympy.return_value = sympy.sympify("x + 1")

        pareto = SymbolicSearcher._extract_pareto(mock_model, ["x"], 50)
        assert len(pareto) >= 1

    def test_extract_pareto_complete_fallback(self) -> None:
        """Test when everything fails."""
        mock_model = mock.MagicMock()
        mock_model.equations_ = None
        mock_model.sympy.side_effect = Exception("fail")

        pareto = SymbolicSearcher._extract_pareto(mock_model, ["x"], 50)
        assert len(pareto) >= 1
