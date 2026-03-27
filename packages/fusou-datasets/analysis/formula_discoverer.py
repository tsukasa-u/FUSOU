"""
Module 3: FormulaDiscoverer -- Symbolic regression per segment.

============================================================
What this module does
============================================================
For each segment produced by the CapDetector, this module attempts to
find a closed-form mathematical expression that maps X -> Y exactly.

Supports **multiple input variables**:
    - Single-variable: x -> y
    - Multi-variable:  (x0, x1, ..., xn) -> y

Primary engine: PySR (symbolic regression via Julia).
Fallback engine: numpy polynomial fit (single-var) or linear regression (multi-var).
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from typing import Callable, List, Optional

import numpy as np


@dataclass
class FormulaResult:
    """Result of symbolic regression for one segment.

    Attributes:
        equation: Human-readable formula string.
        predict_fn: Callable mapping X array(s) -> predicted Y.
        mae: Mean Absolute Error on training data.
        max_error: Maximum absolute error.
        exact_match_rate: Fraction of points with error < 0.5.
        segment_index: Which segment this formula belongs to.
        method: Engine used.
        x_range: Tuple (x_min, x_max) for the primary variable.
        input_names: List of input variable names.
    """
    equation: str
    predict_fn: Callable
    mae: float
    max_error: float
    exact_match_rate: float
    segment_index: int
    method: str
    x_range: tuple
    input_names: List[str]


class FormulaDiscoverer:
    """Discover closed-form formulas from clean data.

    Supports both single-variable and multi-variable inputs.

    Example (single-variable):
        >>> discoverer = FormulaDiscoverer()
        >>> result = discoverer.discover(x, y, segment_index=0)

    Example (multi-variable):
        >>> X = np.column_stack([karyoku, soukou])
        >>> result = discoverer.discover(
        ...     X, y, segment_index=0,
        ...     input_names=["karyoku", "soukou"]
        ... )
    """

    def __init__(
        self,
        max_pysr_iterations: int = 40,
        pysr_populations: int = 20,
        polyfit_max_degree: int = 3,
        timeout_seconds: int = 120,
    ) -> None:
        """Initialise the formula discoverer.

        Args:
            max_pysr_iterations: Max iterations for PySR.
            pysr_populations: Number of populations for PySR.
            polyfit_max_degree: Max polynomial degree for fallback.
            timeout_seconds: PySR wall-clock timeout.
        """
        self.max_pysr_iterations = max_pysr_iterations
        self.pysr_populations = pysr_populations
        self.polyfit_max_degree = polyfit_max_degree
        self.timeout_seconds = timeout_seconds

    def discover(
        self,
        x: np.ndarray,
        y: np.ndarray,
        segment_index: int = 0,
        input_names: Optional[List[str]] = None,
    ) -> FormulaResult:
        """Run symbolic regression on a segment.

        Args:
            x: Input array.  Shape (n,) for single-variable or
               (n, p) for p input variables.
            y: Target array, shape (n,).
            segment_index: Index of the segment.
            input_names: Names for each input variable (for labelling).
                         If None, defaults to ["x"] or ["x0", "x1", ...].

        Returns:
            FormulaResult with the best formula found.
        """
        x = np.asarray(x, dtype=float)
        y = np.asarray(y, dtype=float).ravel()

        # Normalise to 2D
        if x.ndim == 1:
            x = x.reshape(-1, 1)
        n_vars = x.shape[1]

        if input_names is None:
            input_names = ["x"] if n_vars == 1 else [f"x{i}" for i in range(n_vars)]

        if len(x) < 3:
            return self._trivial_result(x, y, segment_index, input_names)

        # Try PySR first
        try:
            return self._discover_pysr(x, y, segment_index, input_names)
        except Exception as e:
            warnings.warn(
                f"PySR failed ({e}); falling back to regression.",
                RuntimeWarning, stacklevel=2,
            )

        # Fallback
        if n_vars == 1:
            return self._discover_polyfit(x[:, 0], y, segment_index, input_names)
        else:
            return self._discover_linear(x, y, segment_index, input_names)

    def _discover_pysr(
        self, x: np.ndarray, y: np.ndarray,
        segment_index: int, input_names: List[str],
    ) -> FormulaResult:
        """Symbolic regression via PySR (multi-variable capable)."""
        from pysr import PySRRegressor

        model = PySRRegressor(
            niterations=self.max_pysr_iterations,
            populations=self.pysr_populations,
            binary_operators=["+", "-", "*", "/"],
            unary_operators=["floor", "ceil", "sqrt"],
            loss="loss(prediction, target) = abs(prediction - target)",
            maxsize=25,
            timeout_in_seconds=self.timeout_seconds,
            temp_equation_file=True,
            verbosity=0,
        )
        model.fit(x, y, variable_names=input_names)

        best_eq = str(model.sympy())

        def predict_fn(x_new):
            x_new = np.asarray(x_new, dtype=float)
            if x_new.ndim == 1:
                x_new = x_new.reshape(-1, 1)
            return model.predict(x_new)

        preds = predict_fn(x)
        mae, max_err, exact_rate = self._compute_metrics(y, preds)

        return FormulaResult(
            equation=best_eq, predict_fn=predict_fn,
            mae=mae, max_error=max_err, exact_match_rate=exact_rate,
            segment_index=segment_index, method="pysr",
            x_range=(float(x[:, 0].min()), float(x[:, 0].max())),
            input_names=input_names,
        )

    def _discover_polyfit(
        self, x: np.ndarray, y: np.ndarray,
        segment_index: int, input_names: List[str],
    ) -> FormulaResult:
        """Single-variable polynomial regression fallback."""
        best_result = None
        best_mae = float("inf")

        for degree in range(1, self.polyfit_max_degree + 1):
            coeffs = np.polyfit(x, y, degree)
            poly = np.poly1d(coeffs)

            def make_fn(p):
                def _predict(x_new):
                    x_new = np.asarray(x_new, dtype=float)
                    if x_new.ndim == 2:
                        x_new = x_new[:, 0]
                    return np.floor(p(x_new))
                return _predict

            predict_fn = make_fn(poly)
            preds = predict_fn(x)
            mae, max_err, exact_rate = self._compute_metrics(y, preds)

            parts = []
            name = input_names[0]
            for i, c in enumerate(coeffs):
                power = degree - i
                cr = round(c, 6)
                if power == 0:
                    parts.append(f"{cr}")
                elif power == 1:
                    parts.append(f"{cr}*{name}")
                else:
                    parts.append(f"{cr}*{name}^{power}")
            equation = f"floor({' + '.join(parts)})"

            if mae < best_mae:
                best_mae = mae
                best_result = FormulaResult(
                    equation=equation, predict_fn=predict_fn,
                    mae=mae, max_error=max_err, exact_match_rate=exact_rate,
                    segment_index=segment_index,
                    method=f"polyfit(deg={degree})",
                    x_range=(float(x.min()), float(x.max())),
                    input_names=input_names,
                )

        assert best_result is not None
        return best_result

    def _discover_linear(
        self, x: np.ndarray, y: np.ndarray,
        segment_index: int, input_names: List[str],
    ) -> FormulaResult:
        """Multi-variable linear regression fallback.

        Fits: y = floor(b0 + b1*x0 + b2*x1 + ... + bn*xn)
        """
        # Add intercept column
        X_aug = np.column_stack([np.ones(len(x)), x])
        # Least-squares
        coeffs, _, _, _ = np.linalg.lstsq(X_aug, y, rcond=None)

        def make_fn(c):
            def _predict(x_new):
                x_new = np.asarray(x_new, dtype=float)
                if x_new.ndim == 1:
                    x_new = x_new.reshape(-1, 1)
                X_a = np.column_stack([np.ones(len(x_new)), x_new])
                return np.floor(X_a @ c)
            return _predict

        predict_fn = make_fn(coeffs)
        preds = predict_fn(x)
        mae, max_err, exact_rate = self._compute_metrics(y, preds)

        # Build equation string
        parts = [f"{round(coeffs[0], 4)}"]
        for i, name in enumerate(input_names):
            c = round(coeffs[i + 1], 4)
            sign = "+" if c >= 0 else "-"
            parts.append(f" {sign} {abs(c)}*{name}")
        equation = f"floor({''.join(parts)})"

        return FormulaResult(
            equation=equation, predict_fn=predict_fn,
            mae=mae, max_error=max_err, exact_match_rate=exact_rate,
            segment_index=segment_index, method="linear_regression",
            x_range=(float(x[:, 0].min()), float(x[:, 0].max())),
            input_names=input_names,
        )

    def _trivial_result(
        self, x: np.ndarray, y: np.ndarray,
        segment_index: int, input_names: List[str],
    ) -> FormulaResult:
        """Constant formula for tiny segments."""
        mean_y = float(np.mean(y)) if len(y) > 0 else 0.0
        return FormulaResult(
            equation=f"floor({mean_y:.2f})",
            predict_fn=lambda x_new: np.full(
                len(np.asarray(x_new).reshape(-1, 1)), np.floor(mean_y)
            ),
            mae=float(np.mean(np.abs(y - np.floor(mean_y)))) if len(y) > 0 else 0.0,
            max_error=float(np.max(np.abs(y - np.floor(mean_y)))) if len(y) > 0 else 0.0,
            exact_match_rate=float(np.mean(np.abs(y - np.floor(mean_y)) < 0.5)) if len(y) > 0 else 1.0,
            segment_index=segment_index, method="constant",
            x_range=(0, 0),
            input_names=input_names,
        )

    @staticmethod
    def _compute_metrics(y_true, y_pred):
        errors = np.abs(y_true - y_pred)
        return float(np.mean(errors)), float(np.max(errors)), float(np.mean(errors < 0.5))

    @staticmethod
    def plot(results, segments=None, ax=None, title=None):
        """Plot discovered formulas vs actual data."""
        import matplotlib.pyplot as plt

        if ax is None:
            _, ax = plt.subplots(figsize=(12, 6))

        colours = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6"]

        for res in results:
            c = colours[res.segment_index % len(colours)]
            if segments and res.segment_index < len(segments):
                seg = segments[res.segment_index]
                ax.scatter(seg.x, seg.y, color=c, alpha=0.5, s=15,
                           label=f"Seg {res.segment_index} data")

            if len(res.input_names) == 1:
                x_range = np.linspace(res.x_range[0], res.x_range[1], 200)
                y_pred = res.predict_fn(x_range)
                eq_short = res.equation[:55] + "..." if len(res.equation) > 55 else res.equation
                ax.plot(x_range, y_pred, color=c, linewidth=2.5, linestyle="--",
                        label=f"Seg {res.segment_index}: {eq_short}\n"
                        f"  MAE={res.mae:.2f}, exact={res.exact_match_rate:.0%}")
            else:
                eq_short = res.equation[:52] + "..." if len(res.equation) > 52 else res.equation
                ax.plot([], [], color=c, linewidth=2.5, linestyle="--",
                        label=f"Seg {res.segment_index} (multi-var):\n  {eq_short}\n"
                        f"  MAE={res.mae:.2f}, exact={res.exact_match_rate:.0%}")

        ax.set_xlabel("X (primary variable)", fontsize=12)
        ax.set_ylabel("Y (predicted)", fontsize=12)
        ax.set_title(title or "Formula Discovery: Predicted vs Actual", fontsize=14)
        ax.legend(fontsize=8, loc="upper left")
        ax.grid(True, alpha=0.3)
        return ax
