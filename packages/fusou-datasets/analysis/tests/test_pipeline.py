"""Tests for pipeline module.

Pipeline tests mock PySR to avoid Julia dependency.  They test the
orchestration logic and per-region fitting.
"""

from __future__ import annotations

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
from fusou_formula.pipeline import (
    Pipeline,
    PipelineConfig,
    PipelineResult,
    RegionModel,
)


def _make_mock_symbolic_result(
    expr_str: str = "2*x + 1",
    feature_cols: list[str] | None = None,
    n_samples: int = 100,
) -> SymbolicResult:
    """Create a mock SymbolicResult for testing."""
    expr = sympy.sympify(expr_str)
    cand = ExpressionCandidate(
        sympy_expr=expr,
        complexity=int(sympy.count_ops(expr)),
        loss=0.01,
        score=0.9,
        bic=50.0,
    )
    return SymbolicResult(
        best=cand,
        pareto_front=[cand],
        feature_cols=feature_cols or [str(s) for s in expr.free_symbols],
        target_col="y",
        n_samples=n_samples,
    )


class TestPipelineConfig:
    def test_default_config(self) -> None:
        cfg = PipelineConfig()
        assert cfg.fs_n_estimators == 200
        assert cfg.sr_parsimony == 0.005
        assert cfg.val_n_folds == 5

    def test_to_dict(self) -> None:
        cfg = PipelineConfig()
        d = cfg.to_dict()
        assert isinstance(d, dict)
        assert "fs_n_estimators" in d
        assert "sr_binary_operators" in d
        assert d["val_n_folds"] == 5


class TestPipelineResult:
    def test_best_expr_none(self) -> None:
        result = PipelineResult()
        assert result.best_expr is None
        assert result.best_latex == ""

    def test_best_expr_from_region(self) -> None:
        from fusou_formula.phase4_validation import ValidationResult

        sr = _make_mock_symbolic_result("x + 1")
        vr = ValidationResult(overall_r2=0.95)
        rm = RegionModel(
            region_index=0,
            symbolic_result=sr,
            validation=vr,
        )
        result = PipelineResult(region_models=[rm])
        assert result.best_expr == sympy.sympify("x + 1")
        assert result.best_latex != ""

    def test_selected_features(self) -> None:
        from fusou_formula.phase1_feature_selection import FeatureSelectionResult

        fsr = FeatureSelectionResult(selected_features=["x1", "x2"])
        result = PipelineResult(phase1=fsr)
        assert result.selected_features == ["x1", "x2"]


class TestPipelineRun:
    """Test Pipeline.run with mocked Phase 3 (PySR)."""

    def _run_with_mock_phase3(
        self,
        df: pd.DataFrame,
        target_col: str = "y",
        feature_cols: list[str] | None = None,
        skip_phases: list[int] | None = None,
        expr_str: str = "2*x1 + 3*x2 + 5",
    ) -> PipelineResult:
        """Run the pipeline with Phase 3 mocked."""
        if feature_cols is None:
            feature_cols = [c for c in df.columns if c != target_col]

        config = PipelineConfig(
            fs_n_estimators=50,
            rs_max_depth=2,
            rs_use_pelt=False,
            sr_niterations=5,
            val_n_folds=3,
        )
        pipeline = Pipeline(config)

        mock_sr = _make_mock_symbolic_result(
            expr_str, feature_cols, len(df),
        )

        with mock.patch.object(
            pipeline, "_run_phase3", return_value=mock_sr,
        ):
            return pipeline.run(
                df, target_col, feature_cols,
                skip_phases=skip_phases,
            )

    def test_full_pipeline(self, linear_df: pd.DataFrame) -> None:
        result = self._run_with_mock_phase3(linear_df)

        assert isinstance(result, PipelineResult)
        assert result.phase1 is not None
        assert result.phase2 is not None
        assert len(result.region_models) >= 1
        assert result.elapsed_seconds > 0

    def test_skip_phase1(self, linear_df: pd.DataFrame) -> None:
        result = self._run_with_mock_phase3(
            linear_df, skip_phases=[1],
        )
        assert result.phase1 is None

    def test_skip_phase2(self, linear_df: pd.DataFrame) -> None:
        result = self._run_with_mock_phase3(
            linear_df, skip_phases=[2],
        )
        assert result.phase2 is None
        # Should still run with one region covering all data
        assert len(result.region_models) == 1

    def test_skip_phase4(self, linear_df: pd.DataFrame) -> None:
        result = self._run_with_mock_phase3(
            linear_df, skip_phases=[4],
        )
        for rm in result.region_models:
            assert rm.validation is None

    def test_skip_phase5(self, linear_df: pd.DataFrame) -> None:
        result = self._run_with_mock_phase3(
            linear_df, skip_phases=[5],
        )
        for rm in result.region_models:
            assert rm.noise is None

    def test_region_models_have_validation(
        self, linear_df: pd.DataFrame,
    ) -> None:
        result = self._run_with_mock_phase3(linear_df)
        for rm in result.region_models:
            if rm.symbolic_result is not None:
                assert rm.validation is not None

    def test_region_models_have_noise(
        self, linear_df: pd.DataFrame,
    ) -> None:
        result = self._run_with_mock_phase3(linear_df)
        for rm in result.region_models:
            if rm.symbolic_result is not None:
                assert rm.noise is not None


class TestPipelineReport:
    def test_report_empty(self) -> None:
        pipeline = Pipeline()
        report = pipeline.report()
        assert "No results" in report

    def test_report_with_results(self, linear_df: pd.DataFrame) -> None:
        config = PipelineConfig(
            fs_n_estimators=50,
            rs_use_pelt=False,
            val_n_folds=3,
        )
        pipeline = Pipeline(config)

        # Manually set _result
        from fusou_formula.phase1_feature_selection import (
            FeatureRank, FeatureSelectionResult,
        )
        from fusou_formula.phase4_validation import (
            ResidualDiagnostics, ValidationResult,
        )
        from fusou_formula.phase5_noise import (
            DistributionFit, NoiseResult,
        )

        sr = _make_mock_symbolic_result("x1 + x2")
        vr = ValidationResult(
            overall_mae=0.1, overall_rmse=0.15, overall_r2=0.99,
            prediction_interval=(-1.0, 1.0),
            residual_diagnostics=ResidualDiagnostics(shapiro_p=0.5),
        )
        nr = NoiseResult(
            best_distribution=DistributionFit(name="norm", aic=100),
            summary={"min": -2.0, "max": 2.0},
        )

        pipeline._result = PipelineResult(
            phase1=FeatureSelectionResult(
                rankings=[
                    FeatureRank("x1", 0.5, 0.3, 0.2, 0.33),
                    FeatureRank("x2", 0.3, 0.2, 0.1, 0.2),
                ],
                selected_features=["x1", "x2"],
                all_features=["x1", "x2"],
                metadata={"oob_r2": 0.95},
            ),
            region_models=[
                RegionModel(
                    region_index=0,
                    symbolic_result=sr,
                    validation=vr,
                    noise=nr,
                    n_samples=500,
                ),
            ],
            config=config,
            elapsed_seconds=5.0,
        )

        report = pipeline.report()
        assert "Pipeline Report" in report
        assert "Feature Selection" in report
        assert "x1" in report
        assert "MAE" in report
        assert "RMSE" in report
        assert "R²" in report
        assert "norm" in report


class TestPipelineRunPhase:
    def test_run_phase_invalid(self) -> None:
        pipeline = Pipeline()
        with pytest.raises(ValueError, match="Invalid phase"):
            pipeline.run_phase(99, pd.DataFrame(), "", [])

    def test_run_phase4_requires_expr(self) -> None:
        pipeline = Pipeline()
        with pytest.raises(ValueError, match="expr required"):
            pipeline.run_phase(
                4, pd.DataFrame({"x": [1], "y": [2]}), "y", ["x"],
            )

    def test_run_phase5_requires_expr(self) -> None:
        pipeline = Pipeline()
        with pytest.raises(ValueError, match="expr required"):
            pipeline.run_phase(
                5, pd.DataFrame({"x": [1], "y": [2]}), "y", ["x"],
            )


class TestPipelinePersistence:
    def test_save_load(self, tmp_path, linear_df) -> None:
        config = PipelineConfig(
            fs_n_estimators=50,
            rs_use_pelt=False,
            val_n_folds=3,
        )
        pipeline = Pipeline(config)

        sr = _make_mock_symbolic_result("x1 + x2")
        pipeline._result = PipelineResult(
            region_models=[
                RegionModel(region_index=0, symbolic_result=sr, n_samples=100),
            ],
            config=config,
        )

        save_path = str(tmp_path / "result.pkl")
        pipeline.save_results(save_path)

        pipeline2 = Pipeline()
        loaded = pipeline2.load_results(save_path)
        assert isinstance(loaded, PipelineResult)
        assert len(loaded.region_models) == 1

    def test_save_without_results(self, tmp_path) -> None:
        pipeline = Pipeline()
        with pytest.raises(RuntimeError, match="No results"):
            pipeline.save_results(str(tmp_path / "result.pkl"))
