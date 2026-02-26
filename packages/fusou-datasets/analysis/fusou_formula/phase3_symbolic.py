"""Phase 3: Symbolic regression using PySR.

Searches for closed-form expressions that fit the data.  The operator
set is deliberately broad (no game-specific assumptions such as
``floor`` / ``ceil``) and model complexity is controlled via the
Minimum Description Length (MDL) principle / BIC.

Key design decisions (truly black-box):
- **Broad operator set** — lets PySR discover floor, sqrt, abs, etc.
  as part of its search if they help.
- **MDL / BIC model selection** — prefers simpler models that explain
  the data well, without human judgement.
- **Per-region fitting** — if Phase 2 discovers structural splits, each
  region is fitted independently.

References
----------
- Cranmer (2023) — PySR: Interpretable Machine Learning for Science.
- Rissanen (1978) — Minimum Description Length.
- Schwarz (1978) — BIC.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import sympy


@dataclass
class ExpressionCandidate:
    """A single expression discovered by symbolic regression.

    Attributes
    ----------
    sympy_expr : sympy.Expr
        The symbolic expression.
    complexity : int
        Number of operations (PySR definition).
    loss : float
        Training loss (MSE).
    score : float
        Information-theoretic score (higher = better trade-off).
    latex : str
        LaTeX representation.
    bic : float
        Bayesian Information Criterion value for this model.
    """

    sympy_expr: sympy.Expr
    complexity: int
    loss: float
    score: float = 0.0
    latex: str = ""
    bic: float = float("inf")

    def __post_init__(self) -> None:
        if not self.latex:
            self.latex = sympy.latex(self.sympy_expr)


@dataclass
class SymbolicResult:
    """Result of symbolic regression on a single (sub-)dataset.

    Attributes
    ----------
    best : ExpressionCandidate
        Best expression selected by MDL / BIC.
    pareto_front : list of ExpressionCandidate
        Full complexity-vs-loss Pareto front.
    feature_cols : list of str
        Features used.
    target_col : str
    n_samples : int
    metadata : dict
    """

    best: ExpressionCandidate
    pareto_front: List[ExpressionCandidate] = field(default_factory=list)
    feature_cols: List[str] = field(default_factory=list)
    target_col: str = ""
    n_samples: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def get_best(self, metric: str = "bic") -> ExpressionCandidate:
        """Return the best expression by the given metric.

        Parameters
        ----------
        metric : ``"bic"`` | ``"loss"`` | ``"score"``
        """
        if not self.pareto_front:
            return self.best
        if metric == "bic":
            return min(self.pareto_front, key=lambda c: c.bic)
        elif metric == "loss":
            return min(self.pareto_front, key=lambda c: c.loss)
        elif metric == "score":
            return max(self.pareto_front, key=lambda c: c.score)
        else:
            raise ValueError(f"Unknown metric: {metric}")


class SymbolicSearcher:
    """Symbolic regression wrapper around PySR.

    Parameters
    ----------
    binary_operators : list of str
        Binary operators for the search.
    unary_operators : list of str
        Unary operators for the search.
    parsimony : float
        Parsimony coefficient (Occam's razor pressure).
    max_complexity : int
        Maximum expression complexity.
    populations : int
        Number of populations in evolutionary search.
    niterations : int
        Number of evolutionary iterations.
    random_state : int or None
        Deterministic seed.
    extra_pysr_kwargs : dict
        Additional kwargs passed to ``PySRRegressor``.
    """

    # Default operator sets: broad, no domain assumptions
    DEFAULT_BINARY = ["+", "-", "*", "/"]
    DEFAULT_UNARY = ["sqrt", "abs", "log", "exp", "sin", "square", "cube"]

    def __init__(
        self,
        binary_operators: Optional[List[str]] = None,
        unary_operators: Optional[List[str]] = None,
        parsimony: float = 0.005,
        max_complexity: int = 30,
        populations: int = 40,
        niterations: int = 150,
        random_state: Optional[int] = 42,
        extra_pysr_kwargs: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.binary_operators = binary_operators or self.DEFAULT_BINARY
        self.unary_operators = unary_operators or self.DEFAULT_UNARY
        self.parsimony = parsimony
        self.max_complexity = max_complexity
        self.populations = populations
        self.niterations = niterations
        self.random_state = random_state
        self.extra_pysr_kwargs = extra_pysr_kwargs or {}
        self._model: Any = None
        self._result: Optional[SymbolicResult] = None

    def fit(
        self,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> SymbolicResult:
        """Run symbolic regression (PySR → OLS/polynomial fallback).

        Parameters
        ----------
        df : DataFrame
            Input data (clean, numeric).
        target_col : str
            Target column name.
        feature_cols : list of str
            Feature column names.

        Returns
        -------
        SymbolicResult
        """
        try:
            from pysr import PySRRegressor  # type: ignore[import-untyped]
            return self._fit_pysr(df, target_col, feature_cols)
        except ImportError:
            return self._fit_ols_fallback(df, target_col, feature_cols)

    def _fit_pysr(
        self,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> SymbolicResult:
        """Run PySR symbolic regression."""
        from pysr import PySRRegressor  # type: ignore[import-untyped]

        work = df[feature_cols + [target_col]].dropna().reset_index(drop=True)
        X = work[feature_cols].values.astype(np.float64)
        y = work[target_col].values.astype(np.float64)
        n = len(y)

        model = PySRRegressor(
            binary_operators=self.binary_operators,
            unary_operators=self.unary_operators,
            parsimony=self.parsimony,
            maxsize=self.max_complexity,
            populations=self.populations,
            niterations=self.niterations,
            random_state=self.random_state,
            progress=True,
            verbosity=1,
            **self.extra_pysr_kwargs,
        )

        model.fit(X, y, variable_names=feature_cols)
        self._model = model

        # Extract Pareto front and compute BIC for each
        pareto = self._extract_pareto(model, feature_cols, n)

        # Select best by BIC
        if pareto:
            best = min(pareto, key=lambda c: c.bic)
        else:
            # Should not happen, but safety fallback
            best = ExpressionCandidate(
                sympy_expr=sympy.Integer(0),
                complexity=1,
                loss=float("inf"),
            )

        self._result = SymbolicResult(
            best=best,
            pareto_front=pareto,
            feature_cols=feature_cols,
            target_col=target_col,
            n_samples=n,
            metadata={
                "niterations": self.niterations,
                "parsimony": self.parsimony,
                "n_pareto": len(pareto),
            },
        )
        return self._result

    def fit_from_arrays(
        self,
        X: np.ndarray,
        y: np.ndarray,
        feature_names: Optional[List[str]] = None,
    ) -> SymbolicResult:
        """Fit directly from numpy arrays."""
        if feature_names is None:
            feature_names = [f"x{i}" for i in range(X.shape[1])]
        df = pd.DataFrame(X, columns=feature_names)
        df["__target__"] = y
        return self.fit(df, "__target__", feature_names)

    def predict(
        self,
        df: pd.DataFrame,
        feature_cols: List[str],
        expr: Optional[sympy.Expr] = None,
    ) -> np.ndarray:
        """Evaluate an expression on data.

        Parameters
        ----------
        df : DataFrame
        feature_cols : list of str
        expr : sympy.Expr or None
            If *None*, uses the best expression from the last fit.

        Returns
        -------
        np.ndarray
        """
        if expr is None:
            if self._result is None:
                raise RuntimeError("Call fit() first or supply expr")
            expr = self._result.best.sympy_expr

        return self.evaluate_expr(expr, df, feature_cols)

    @staticmethod
    def evaluate_expr(
        expr: sympy.Expr,
        df: pd.DataFrame,
        feature_cols: List[str],
        params: Optional[Dict[str, float]] = None,
    ) -> np.ndarray:
        """Numerically evaluate a sympy expression on data.

        Parameters
        ----------
        expr : sympy.Expr
        df : DataFrame
        feature_cols : list of str
        params : dict or None
            Substitute these symbol-value pairs before evaluation.

        Returns
        -------
        np.ndarray
        """
        if params:
            subs = {sympy.Symbol(k): v for k, v in params.items()}
            expr = expr.subs(subs)

        syms = [sympy.Symbol(c) for c in feature_cols]
        fn = sympy.lambdify(syms, expr, modules=["numpy"])

        X = df[feature_cols].values.astype(np.float64)
        n_rows = X.shape[0]
        try:
            result = fn(*[X[:, i] for i in range(X.shape[1])])
            out = np.asarray(result, dtype=np.float64).ravel()
            # Broadcast scalar (constant expression) to match input length
            if out.shape[0] != n_rows:
                out = np.full(n_rows, float(out.flat[0]) if out.size > 0 else np.nan)
            return out
        except Exception:
            out = np.empty(len(df))
            for i in range(len(df)):
                try:
                    out[i] = float(fn(*X[i]))
                except Exception:
                    out[i] = np.nan
            return out

    @property
    def model(self) -> Any:
        """Access the underlying PySRRegressor model."""
        return self._model

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_pareto(
        model: Any,
        feature_cols: List[str],
        n_samples: int,
    ) -> List[ExpressionCandidate]:
        """Extract Pareto-front candidates and compute BIC for each."""
        candidates: List[ExpressionCandidate] = []

        try:
            equations = model.equations_
            if equations is None or len(equations) == 0:
                raise ValueError("No equations found")

            for _, row in equations.iterrows():
                try:
                    expr = row.get("sympy_format", None)
                    if expr is None:
                        expr = sympy.sympify(str(row.get("equation", "0")))
                    elif isinstance(expr, str):
                        expr = sympy.sympify(expr)

                    complexity = int(row.get("complexity", 0))
                    loss = float(row.get("loss", float("inf")))
                    score = float(row.get("score", 0.0))

                    # BIC = n * log(MSE) + k * log(n)
                    if n_samples > 0:
                        safe_loss = max(loss, 1e-300)
                        bic = n_samples * np.log(safe_loss) + complexity * np.log(n_samples)
                    else:
                        bic = float("inf")

                    candidates.append(ExpressionCandidate(
                        sympy_expr=expr,
                        complexity=complexity,
                        loss=loss,
                        score=score,
                        bic=float(bic),
                    ))
                except (TypeError, ValueError, sympy.SympifyError):
                    continue

        except Exception:
            try:
                best_expr = model.sympy()
                candidates.append(ExpressionCandidate(
                    sympy_expr=best_expr,
                    complexity=10,
                    loss=0.0,
                    score=1.0,
                ))
            except Exception:
                candidates.append(ExpressionCandidate(
                    sympy_expr=sympy.Symbol("x0"),
                    complexity=1,
                    loss=float("inf"),
                    score=0.0,
                ))

        return candidates

    def _fit_ols_fallback(
        self,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> SymbolicResult:
        """OLS + polynomial regression fallback when PySR is unavailable.

        Tries linear regression and polynomial features (degree 2, 3) to
        build a small pareto front of complexity vs loss.
        """
        from sklearn.linear_model import LinearRegression  # type: ignore[import-untyped]
        from sklearn.preprocessing import PolynomialFeatures  # type: ignore[import-untyped]

        work = df[feature_cols + [target_col]].dropna().reset_index(drop=True)
        X = work[feature_cols].values.astype(np.float64)
        y = work[target_col].values.astype(np.float64)
        n = len(y)
        syms = [sympy.Symbol(c) for c in feature_cols]

        pareto: List[ExpressionCandidate] = []

        # --- Mean baseline (complexity=1) ---
        mean_y = float(np.mean(y))
        mse_mean = float(np.mean((y - mean_y) ** 2))
        pareto.append(ExpressionCandidate(
            sympy_expr=sympy.Float(round(mean_y, 4)),
            complexity=1,
            loss=mse_mean,
            score=0.0,
            bic=float(n * np.log(max(mse_mean, 1e-300)) + 1 * np.log(n)),
        ))

        # --- Linear regression ---
        lr = LinearRegression().fit(X, y)
        y_pred_lr = lr.predict(X)
        mse_lr = float(np.mean((y - y_pred_lr) ** 2))

        expr_lr = sympy.Float(round(float(lr.intercept_), 6))
        for coef, sym in zip(lr.coef_, syms):
            if abs(coef) > 1e-10:
                expr_lr = expr_lr + sympy.Float(round(float(coef), 6)) * sym
        expr_lr = sympy.nsimplify(expr_lr, rational=False)
        complexity_lr = int(sympy.count_ops(expr_lr)) or 2

        pareto.append(ExpressionCandidate(
            sympy_expr=expr_lr,
            complexity=complexity_lr,
            loss=mse_lr,
            score=float(np.log(max(mse_mean, 1e-300)) - np.log(max(mse_lr, 1e-300))) / max(complexity_lr, 1),
            bic=float(n * np.log(max(mse_lr, 1e-300)) + complexity_lr * np.log(n)),
        ))

        # --- Polynomial degree 2 & 3 ---
        for degree in [2, 3]:
            try:
                poly = PolynomialFeatures(degree=degree, include_bias=False)
                X_poly = poly.fit_transform(X)
                lr_poly = LinearRegression().fit(X_poly, y)
                y_pred_poly = lr_poly.predict(X_poly)
                mse_poly = float(np.mean((y - y_pred_poly) ** 2))

                # Build symbolic expression
                feature_names = poly.get_feature_names_out(feature_cols)
                expr_poly = sympy.Float(round(float(lr_poly.intercept_), 6))
                for coef, fname in zip(lr_poly.coef_, feature_names):
                    if abs(coef) > 1e-10:
                        term = sympy.Float(round(float(coef), 6))
                        # Parse feature name like "x z" or "x^2"
                        for part in fname.split(" "):
                            if "^" in part:
                                base, exp_str = part.split("^")
                                term = term * sympy.Symbol(base) ** int(exp_str)
                            else:
                                term = term * sympy.Symbol(part)
                        expr_poly = expr_poly + term

                expr_poly = sympy.nsimplify(expr_poly, rational=False)
                complexity_poly = int(sympy.count_ops(expr_poly)) or degree + 1

                pareto.append(ExpressionCandidate(
                    sympy_expr=expr_poly,
                    complexity=complexity_poly,
                    loss=mse_poly,
                    score=float(np.log(max(mse_lr, 1e-300)) - np.log(max(mse_poly, 1e-300))) / max(complexity_poly, 1),
                    bic=float(n * np.log(max(mse_poly, 1e-300)) + complexity_poly * np.log(n)),
                ))
            except Exception:
                continue

        # Select best by BIC
        best = min(pareto, key=lambda c: c.bic)

        self._result = SymbolicResult(
            best=best,
            pareto_front=sorted(pareto, key=lambda c: c.complexity),
            feature_cols=feature_cols,
            target_col=target_col,
            n_samples=n,
            metadata={
                "method": "ols_polynomial_fallback",
                "n_pareto": len(pareto),
            },
        )
        return self._result

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------

    @staticmethod
    def from_sympy(
        expr_str: Any,
        loss: float = 0.0,
        score: float = 0.0,
        n_samples: int = 100,
    ) -> SymbolicResult:
        """Create a SymbolicResult from a sympy expression or string.

        Useful for testing or manual exploration.
        """
        expr = sympy.sympify(expr_str)
        complexity = int(sympy.count_ops(expr))
        if n_samples > 0:
            safe_loss = max(loss, 1e-300)
            bic = n_samples * np.log(safe_loss) + complexity * np.log(n_samples)
        else:
            bic = 0.0
        cand = ExpressionCandidate(
            sympy_expr=expr,
            complexity=complexity,
            loss=loss,
            score=score,
            bic=float(bic),
        )
        feature_cols = [str(s) for s in expr.free_symbols]
        return SymbolicResult(
            best=cand,
            pareto_front=[cand],
            feature_cols=feature_cols,
            n_samples=n_samples,
        )

    @staticmethod
    def sympy_to_ast_tree(
        expr: sympy.Expr,
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Convert a sympy expression to a ReactFlow-compatible AST tree.

        Returns ``{"nodes": [...], "edges": [...]}``.
        """
        nodes: List[Dict[str, Any]] = []
        edges: List[Dict[str, Any]] = []
        counter = [0]

        def _build(e: sympy.Basic, parent_id: Optional[str] = None) -> str:
            node_id = f"n{counter[0]}"
            counter[0] += 1

            if isinstance(e, sympy.Symbol):
                node_type = "variable"
                label = str(e)
            elif isinstance(e, (sympy.Integer, sympy.Float, sympy.Rational)):
                node_type = "constant"
                label = str(e)
            else:
                node_type = "operator"
                label = type(e).__name__

            nodes.append({
                "id": node_id,
                "type": node_type,
                "data": {
                    "label": label,
                    "type": node_type,
                    "latex": sympy.latex(e),
                },
                "position": {"x": 0, "y": 0},
            })

            if parent_id is not None:
                edges.append({
                    "id": f"e{parent_id}-{node_id}",
                    "source": parent_id,
                    "target": node_id,
                })

            for arg in e.args:
                if isinstance(arg, sympy.Basic):
                    _build(arg, node_id)

            return node_id

        _build(expr)
        return {"nodes": nodes, "edges": edges}
