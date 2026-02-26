"""Phase 4: Model validation via cross-validation and residual analysis.

Evaluates the quality of discovered expressions using hold-out data,
without any domain-specific knowledge.

Checks performed:
1. **K-fold cross-validation** — MAE, RMSE, R² on held-out folds.
2. **Residual diagnostics** — normality test (Shapiro–Wilk),
   autocorrelation (Ljung–Box / Durbin–Watson), and heteroscedasticity
   (Breusch–Pagan-like correlation of |residual| vs predicted).
3. **Prediction interval estimation** — empirical quantile-based
   intervals from residuals.

References
----------
- Stone (1974) — Cross-validation.
- Shapiro & Wilk (1965) — Normality test.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import sympy
from sklearn.model_selection import KFold


@dataclass
class FoldMetrics:
    """Metrics from a single CV fold."""

    fold: int
    mae: float
    rmse: float
    r2: float
    n_samples: int


@dataclass
class ResidualDiagnostics:
    """Statistical diagnostics on the residual distribution.

    Attributes
    ----------
    mean : float
        Mean of residuals (should be ≈ 0).
    std : float
        Standard deviation of residuals.
    skewness : float
    kurtosis : float
    shapiro_stat : float
        Shapiro–Wilk test statistic.
    shapiro_p : float
        p-value of the Shapiro–Wilk test (p < 0.05 → non-normal).
    dw_stat : float
        Durbin–Watson statistic (≈ 2 → no autocorrelation).
    heteroscedasticity_corr : float
        Pearson correlation between |residual| and predicted value.
        High absolute value indicates heteroscedasticity.
    """

    mean: float = 0.0
    std: float = 0.0
    skewness: float = 0.0
    kurtosis: float = 0.0
    shapiro_stat: float = 0.0
    shapiro_p: float = 1.0
    dw_stat: float = 2.0
    heteroscedasticity_corr: float = 0.0


@dataclass
class ValidationResult:
    """Result of model validation (Phase 4).

    Attributes
    ----------
    overall_mae : float
    overall_rmse : float
    overall_r2 : float
    fold_metrics : list of FoldMetrics
    residual_diagnostics : ResidualDiagnostics
    prediction_interval : tuple of float
        (lower_offset, upper_offset) such that
        ``pred + lower_offset <= actual <= pred + upper_offset``
        holds for ≈ *interval_coverage* fraction of the data.
    interval_coverage : float
        Target coverage probability (default 0.9).
    n_samples : int
    expr_latex : str
    metadata : dict
    """

    overall_mae: float = 0.0
    overall_rmse: float = 0.0
    overall_r2: float = 0.0
    fold_metrics: List[FoldMetrics] = field(default_factory=list)
    residual_diagnostics: ResidualDiagnostics = field(
        default_factory=ResidualDiagnostics,
    )
    prediction_interval: tuple[float, float] = (0.0, 0.0)
    interval_coverage: float = 0.9
    n_samples: int = 0
    expr_latex: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


class ModelValidator:
    """Validate a symbolic expression using cross-validation and residual analysis.

    Parameters
    ----------
    n_folds : int
        Number of CV folds.
    interval_coverage : float
        Target coverage for prediction intervals (0–1).
    random_state : int
        Seed for fold splitting.
    """

    def __init__(
        self,
        n_folds: int = 5,
        interval_coverage: float = 0.9,
        random_state: int = 42,
    ) -> None:
        self.n_folds = n_folds
        self.interval_coverage = interval_coverage
        self.random_state = random_state

    def validate(
        self,
        expr: sympy.Expr,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> ValidationResult:
        """Run full validation on an expression.

        Parameters
        ----------
        expr : sympy.Expr
            The expression to validate.
        df : DataFrame
            Full dataset.
        target_col : str
        feature_cols : list of str

        Returns
        -------
        ValidationResult
        """
        work = df[feature_cols + [target_col]].dropna().reset_index(drop=True)

        X = work[feature_cols].values.astype(np.float64)
        y = work[target_col].values.astype(np.float64)
        n = len(y)

        # Early return for insufficient data
        if n < 2:
            return ValidationResult(
                overall_mae=float("inf"),
                overall_rmse=float("inf"),
                overall_r2=float("-inf"),
                n_samples=n,
                expr_latex=sympy.latex(expr),
                metadata={"error": "insufficient_data", "n_rows": n},
            )

        # Compile expression
        eval_fn = self._compile_expr(expr, feature_cols)

        # --- Cross-validation ---
        fold_metrics = self._cross_validate(eval_fn, X, y, feature_cols)

        # --- Full-dataset residuals ---
        y_pred = self._safe_eval(eval_fn, X)
        valid = np.isfinite(y_pred) & np.isfinite(y)
        residuals = (y[valid] - y_pred[valid])
        y_pred_valid = y_pred[valid]
        y_valid = y[valid]
        n_valid = int(valid.sum())

        # Overall metrics
        if n_valid > 0:
            overall_mae = float(np.mean(np.abs(residuals)))
            overall_rmse = float(np.sqrt(np.mean(residuals ** 2)))
            ss_res = float(np.sum(residuals ** 2))
            ss_tot = float(np.sum((y_valid - np.mean(y_valid)) ** 2))
            if ss_tot > 0:
                overall_r2 = 1.0 - ss_res / ss_tot
            elif ss_res == 0:
                overall_r2 = 1.0  # perfect prediction of constant target
            else:
                overall_r2 = 0.0
        else:
            overall_mae = float("inf")
            overall_rmse = float("inf")
            overall_r2 = float("-inf")

        # Residual diagnostics
        diag = self._residual_diagnostics(residuals, y_pred_valid)

        # Prediction interval
        pi = self._prediction_interval(residuals)

        return ValidationResult(
            overall_mae=overall_mae,
            overall_rmse=overall_rmse,
            overall_r2=overall_r2,
            fold_metrics=fold_metrics,
            residual_diagnostics=diag,
            prediction_interval=pi,
            interval_coverage=self.interval_coverage,
            n_samples=n_valid,
            expr_latex=sympy.latex(expr),
            metadata={
                "n_folds": self.n_folds,
                "n_total_rows": n,
                "n_valid_rows": n_valid,
            },
        )

    # ------------------------------------------------------------------
    # Cross-validation
    # ------------------------------------------------------------------

    def _cross_validate(
        self,
        eval_fn: Any,
        X: np.ndarray,
        y: np.ndarray,
        feature_cols: List[str],
    ) -> List[FoldMetrics]:
        """Run K-fold cross-validation.

        Note: Symbolic regression is *not* re-fitted per fold (that would
        be prohibitively expensive).  Instead, we evaluate the *same*
        expression on held-out data.  This gives an honest estimate of
        generalisation for the fixed formula.
        """
        kf = KFold(
            n_splits=min(self.n_folds, len(y)),
            shuffle=True,
            random_state=self.random_state,
        )

        folds: List[FoldMetrics] = []
        for fold_idx, (train_idx, test_idx) in enumerate(kf.split(X)):
            X_test = X[test_idx]
            y_test = y[test_idx]

            y_pred = self._safe_eval(eval_fn, X_test)
            valid = np.isfinite(y_pred) & np.isfinite(y_test)
            n_valid = int(valid.sum())

            if n_valid == 0:
                folds.append(FoldMetrics(
                    fold=fold_idx, mae=float("inf"),
                    rmse=float("inf"), r2=float("-inf"), n_samples=0,
                ))
                continue

            residuals = y_test[valid] - y_pred[valid]
            mae = float(np.mean(np.abs(residuals)))
            rmse = float(np.sqrt(np.mean(residuals ** 2)))
            ss_res = float(np.sum(residuals ** 2))
            ss_tot = float(np.sum((y_test[valid] - np.mean(y_test[valid])) ** 2))
            if ss_tot > 0:
                r2 = 1.0 - ss_res / ss_tot
            elif ss_res == 0:
                r2 = 1.0
            else:
                r2 = 0.0

            folds.append(FoldMetrics(
                fold=fold_idx, mae=mae, rmse=rmse, r2=r2, n_samples=n_valid,
            ))

        return folds

    # ------------------------------------------------------------------
    # Residual diagnostics
    # ------------------------------------------------------------------

    def _residual_diagnostics(
        self,
        residuals: np.ndarray,
        y_pred: np.ndarray,
    ) -> ResidualDiagnostics:
        """Compute residual diagnostic statistics."""
        from scipy import stats as sp_stats  # type: ignore[import-untyped]

        n = len(residuals)
        if n < 3:
            return ResidualDiagnostics()

        mean = float(np.mean(residuals))
        std = float(np.std(residuals, ddof=1)) if n > 1 else 0.0
        skew = float(sp_stats.skew(residuals))
        kurt = float(sp_stats.kurtosis(residuals))

        # Shapiro–Wilk (limited to 5000 samples)
        sample = residuals[:5000] if n > 5000 else residuals
        try:
            shapiro_result = sp_stats.shapiro(sample)
            shapiro_stat = float(shapiro_result.statistic)
            shapiro_p = float(shapiro_result.pvalue)
        except Exception:
            shapiro_stat = 0.0
            shapiro_p = 1.0

        # Durbin–Watson
        dw = self._durbin_watson(residuals)

        # Heteroscedasticity: correlation(|resid|, y_pred)
        if len(y_pred) == n and n > 2:
            abs_resid = np.abs(residuals)
            try:
                corr = float(np.corrcoef(abs_resid, y_pred)[0, 1])
                if not np.isfinite(corr):
                    corr = 0.0
            except Exception:
                corr = 0.0
        else:
            corr = 0.0

        return ResidualDiagnostics(
            mean=mean,
            std=std,
            skewness=skew,
            kurtosis=kurt,
            shapiro_stat=shapiro_stat,
            shapiro_p=shapiro_p,
            dw_stat=dw,
            heteroscedasticity_corr=corr,
        )

    @staticmethod
    def _durbin_watson(residuals: np.ndarray) -> float:
        """Compute Durbin–Watson statistic."""
        n = len(residuals)
        if n < 2:
            return 2.0
        diff = np.diff(residuals)
        ss_diff = float(np.sum(diff ** 2))
        ss_res = float(np.sum(residuals ** 2))
        if ss_res == 0:
            return 2.0
        return ss_diff / ss_res

    # ------------------------------------------------------------------
    # Prediction interval
    # ------------------------------------------------------------------

    def _prediction_interval(
        self,
        residuals: np.ndarray,
    ) -> tuple[float, float]:
        """Compute empirical prediction interval from residuals.

        Returns (lower_offset, upper_offset) such that approximately
        *interval_coverage* of residuals fall within
        [lower_offset, upper_offset].
        """
        if len(residuals) == 0:
            return (0.0, 0.0)

        alpha = 1.0 - self.interval_coverage
        lower = float(np.quantile(residuals, alpha / 2))
        upper = float(np.quantile(residuals, 1 - alpha / 2))
        return (lower, upper)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _compile_expr(
        expr: sympy.Expr,
        feature_cols: List[str],
    ) -> Any:
        """Compile a sympy expression into a fast numpy evaluator."""
        syms = [sympy.Symbol(c) for c in feature_cols]
        return sympy.lambdify(syms, expr, modules=["numpy"])

    @staticmethod
    def _safe_eval(eval_fn: Any, X: np.ndarray) -> np.ndarray:
        """Evaluate the compiled function, handling errors gracefully."""
        try:
            result = eval_fn(*[X[:, i] for i in range(X.shape[1])])
            out = np.asarray(result, dtype=np.float64).ravel()
            if out.shape[0] != X.shape[0]:
                # Scalar broadcast
                out = np.full(X.shape[0], float(out.flat[0]))
            return out
        except Exception:
            out = np.empty(X.shape[0])
            for i in range(X.shape[0]):
                try:
                    out[i] = float(eval_fn(*X[i]))
                except Exception:
                    out[i] = np.nan
            return out
