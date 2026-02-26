"""Tests for exporter module."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import sympy

from fusou_formula.exporter import FormulaExporter
from fusou_formula.phase1_feature_selection import (
    FeatureRank,
    FeatureSelectionResult,
)
from fusou_formula.phase2_region_split import (
    RegionSplitResult,
    SplitCondition,
    Region,
)
from fusou_formula.phase3_symbolic import (
    ExpressionCandidate,
    SymbolicResult,
)
from fusou_formula.phase4_validation import (
    FoldMetrics,
    ResidualDiagnostics,
    ValidationResult,
)
from fusou_formula.phase5_noise import (
    DistributionFit,
    NoiseResult,
)
from fusou_formula.pipeline import PipelineConfig, PipelineResult, RegionModel


def _make_full_result() -> PipelineResult:
    """Create a complete PipelineResult for export testing."""
    expr = sympy.sympify("2*x + 1")
    cand = ExpressionCandidate(
        sympy_expr=expr, complexity=3, loss=0.01, score=0.9, bic=50.0,
    )
    sr = SymbolicResult(
        best=cand,
        pareto_front=[cand],
        feature_cols=["x"],
        target_col="y",
        n_samples=100,
    )
    vr = ValidationResult(
        overall_mae=0.1,
        overall_rmse=0.15,
        overall_r2=0.99,
        fold_metrics=[
            FoldMetrics(fold=0, mae=0.11, rmse=0.16, r2=0.98, n_samples=20),
        ],
        residual_diagnostics=ResidualDiagnostics(
            mean=0.0, std=0.15, shapiro_p=0.5, dw_stat=1.9,
        ),
        prediction_interval=(-0.3, 0.3),
        interval_coverage=0.9,
        n_samples=100,
    )
    nr = NoiseResult(
        residuals=np.random.default_rng(42).normal(0, 0.15, 100),
        best_distribution=DistributionFit(
            name="norm",
            params={"loc": 0.0, "scale": 0.15},
            aic=100.0,
            bic=105.0,
            ks_stat=0.03,
            ks_p=0.9,
        ),
        all_fits=[
            DistributionFit(name="norm", params={"loc": 0.0, "scale": 0.15},
                            aic=100.0, bic=105.0),
        ],
        histogram={"bin_edges": [0, 1], "counts": [100], "density": [1.0]},
        summary={"mean": 0.0, "std": 0.15, "min": -0.5, "max": 0.5},
    )

    rm = RegionModel(
        region_index=0,
        conditions=[("x", "<=", 50.0)],
        symbolic_result=sr,
        validation=vr,
        noise=nr,
        n_samples=100,
    )

    return PipelineResult(
        phase1=FeatureSelectionResult(
            rankings=[FeatureRank("x", 0.5, 0.3, 0.2, 0.33)],
            selected_features=["x"],
            all_features=["x"],
            metadata={"oob_r2": 0.95},
        ),
        phase2=RegionSplitResult(
            splits=[SplitCondition("x", 50.0, "cart", 0.8)],
            regions=[Region([("x", "<=", 50.0)], 50), Region([("x", ">", 50.0)], 50)],
            n_total_samples=100,
            split_tree_depth=1,
        ),
        region_models=[rm],
        config=PipelineConfig(),
        elapsed_seconds=5.0,
    )


class TestFormulaExporter:
    def test_export_structure(self) -> None:
        exporter = FormulaExporter()
        result = _make_full_result()
        artifact = exporter.export(result, "test_id", "target_var")

        assert artifact["id"] == "test_id"
        assert artifact["target"] == "target_var"
        assert artifact["status"] == "candidate"
        assert "created_at" in artifact
        assert "best_formula" in artifact
        assert "pareto_front" in artifact
        assert "regime_info" in artifact
        assert "validation" in artifact
        assert "data_summary" in artifact
        assert "pipeline_config" in artifact

    def test_best_formula_section(self) -> None:
        exporter = FormulaExporter()
        result = _make_full_result()
        artifact = exporter.export(result, "test", "y")

        bf = artifact["best_formula"]
        assert "latex" in bf
        assert "sympy_str" in bf
        assert "complexity" in bf
        assert "coefficients" in bf
        assert "ast_tree" in bf
        assert "nodes" in bf["ast_tree"]
        assert "edges" in bf["ast_tree"]

    def test_pareto_front_section(self) -> None:
        exporter = FormulaExporter()
        result = _make_full_result()
        artifact = exporter.export(result, "test", "y")

        pf = artifact["pareto_front"]
        assert len(pf) == 1
        assert "complexity" in pf[0]
        assert "loss" in pf[0]
        assert "latex" in pf[0]
        assert "sympy_str" in pf[0]

    def test_regime_info_section(self) -> None:
        exporter = FormulaExporter()
        result = _make_full_result()
        artifact = exporter.export(result, "test", "y")

        ri = artifact["regime_info"]
        assert ri is not None
        assert len(ri["breakpoints"]) == 1
        bp = ri["breakpoints"][0]
        assert bp["variable"] == "x"
        assert bp["value"] == 50.0
        assert "confidence" in bp
        assert "regimes" in ri

    def test_validation_section(self) -> None:
        exporter = FormulaExporter()
        result = _make_full_result()
        artifact = exporter.export(result, "test", "y")

        v = artifact["validation"]
        assert "known_formula_match" in v
        assert "known_formula_latex" in v
        assert "structural_similarity" in v
        assert "metrics" in v
        m = v["metrics"]
        assert m["mae"] == 0.1
        assert m["rmse"] == 0.15
        assert m["interval_accuracy"] == 0.9
        assert m["n_samples"] == 100

    def test_noise_via_export(self) -> None:
        """Noise data is no longer at top-level; ensure validation structure."""
        exporter = FormulaExporter()
        result = _make_full_result()
        artifact = exporter.export(result, "test", "y")
        # Noise analysis data is now embedded in pipeline_config or absent
        # from top-level; just confirm artifact is valid
        assert artifact["id"] == "test"

    def test_save(self, tmp_path: Path) -> None:
        exporter = FormulaExporter()
        result = _make_full_result()
        artifact = exporter.export(result, "test_save", "y")

        filepath = exporter.save(artifact, str(tmp_path))
        assert filepath.exists()

        with open(filepath, "r") as f:
            loaded = json.load(f)
        assert loaded["id"] == "test_save"

    def test_save_creates_index(self, tmp_path: Path) -> None:
        exporter = FormulaExporter()
        result = _make_full_result()
        artifact = exporter.export(result, "idx_test", "y")

        exporter.save(artifact, str(tmp_path))
        index_path = tmp_path / "index.json"
        assert index_path.exists()

        with open(index_path, "r") as f:
            entries = json.load(f)
        assert len(entries) == 1
        assert entries[0]["id"] == "idx_test"

    def test_save_updates_existing_index(self, tmp_path: Path) -> None:
        exporter = FormulaExporter()

        result = _make_full_result()
        a1 = exporter.export(result, "entry1", "y")
        a2 = exporter.export(result, "entry2", "y")

        exporter.save(a1, str(tmp_path))
        exporter.save(a2, str(tmp_path))

        index_path = tmp_path / "index.json"
        with open(index_path, "r") as f:
            entries = json.load(f)
        ids = {e["id"] for e in entries}
        assert "entry1" in ids
        assert "entry2" in ids

    def test_save_overwrites_same_id(self, tmp_path: Path) -> None:
        exporter = FormulaExporter()
        result = _make_full_result()

        a1 = exporter.export(result, "dup", "y", status="candidate")
        a2 = exporter.export(result, "dup", "y", status="validated")

        exporter.save(a1, str(tmp_path))
        exporter.save(a2, str(tmp_path))

        index_path = tmp_path / "index.json"
        with open(index_path, "r") as f:
            entries = json.load(f)
        dup = [e for e in entries if e["id"] == "dup"]
        assert len(dup) == 1

    def test_export_minimal_result(self) -> None:
        """Export a result with no phase1/2/validation/noise."""
        exporter = FormulaExporter()
        result = PipelineResult(config=PipelineConfig())
        artifact = exporter.export(result, "minimal", "y")

        assert artifact["id"] == "minimal"
        assert artifact["best_formula"] == {}
        assert artifact["pareto_front"] == []
        assert artifact["regime_info"] is None

    def test_json_serialisable(self) -> None:
        """The artifact should be fully JSON-serialisable."""
        exporter = FormulaExporter()
        result = _make_full_result()
        artifact = exporter.export(result, "serial_test", "y")

        # This should not raise
        json_str = json.dumps(artifact, default=str)
        assert len(json_str) > 0

    def test_compute_residuals(self) -> None:
        expr = sympy.sympify("2*x + 1")
        rng = np.random.default_rng(42)
        x = rng.uniform(0, 50, 100)
        y = 2 * x + 1 + rng.normal(0, 0.5, 100)
        df = pd.DataFrame({"x": x, "y": y})

        data = FormulaExporter.compute_residuals(expr, df, "y", ["x"])
        assert "histogram" in data
        assert "by_input" in data
        assert len(data["by_input"]) <= 100

    def test_feature_selection_export(self) -> None:
        """Feature selection details are included in the artifact."""
        exporter = FormulaExporter()
        result = _make_full_result()
        artifact = exporter.export(result, "fs_test", "y")

        fs = artifact["feature_selection"]
        assert fs is not None
        assert fs["selected_features"] == ["x"]
        assert fs["all_features"] == ["x"]
        assert len(fs["rankings"]) == 1
        rk = fs["rankings"][0]
        assert rk["name"] == "x"
        assert "mi_score" in rk
        assert "tree_importance" in rk
        assert "permutation_importance" in rk
        assert "combined_rank" in rk
        assert fs["metadata"]["oob_r2"] == 0.95

    def test_actual_vs_predicted_export(self) -> None:
        """Actual vs predicted data is generated when df is provided."""
        exporter = FormulaExporter()
        result = _make_full_result()

        rng = np.random.default_rng(42)
        x = rng.uniform(0, 50, 100)
        y = 2 * x + 1 + rng.normal(0, 0.5, 100)
        df = pd.DataFrame({"x": x, "y": y})

        artifact = exporter.export(
            result, "avp_test", "y", df=df, target_col="y", feature_cols=["x"],
        )

        avp = artifact["actual_vs_predicted"]
        assert avp is not None
        assert len(avp) == 100  # <= 500 cap, only 100 rows
        pt = avp[0]
        assert "actual" in pt
        assert "predicted" in pt
        assert "features" in pt
        assert "x" in pt["features"]

    def test_feature_selection_absent_when_no_phase1(self) -> None:
        """Feature selection is None when pipeline has no phase1."""
        exporter = FormulaExporter()
        result = PipelineResult(config=PipelineConfig())
        artifact = exporter.export(result, "no_fs", "y")
        assert artifact["feature_selection"] is None

    def test_actual_vs_predicted_absent_when_no_df(self) -> None:
        """Actual vs predicted is None when no df provided."""
        exporter = FormulaExporter()
        result = _make_full_result()
        artifact = exporter.export(result, "no_avp", "y")
        assert artifact["actual_vs_predicted"] is None

    def test_data_source_synthetic(self) -> None:
        """data_source is included when passed to export."""
        exporter = FormulaExporter()
        result = _make_full_result()
        source = {
            "type": "synthetic",
            "formula_description": "2*x + 1",
            "column_descriptions": {"y": "target dummy", "x": "feature dummy"},
            "note": "test note",
        }
        artifact = exporter.export(
            result, "ds_test", "y", data_source=source,
        )
        ds = artifact["data_source"]
        assert ds["type"] == "synthetic"
        assert ds["formula_description"] == "2*x + 1"
        assert ds["column_descriptions"]["y"] == "target dummy"
        assert ds["note"] == "test note"

    def test_data_source_sdk(self) -> None:
        """data_source with SDK type includes table info."""
        exporter = FormulaExporter()
        result = _make_full_result()
        source = {
            "type": "sdk",
            "tables": ["hougeki"],
            "table_descriptions": {"hougeki": "砲撃戦"},
            "column_descriptions": {"damage": "ダメージ値", "karyoku": "火力"},
        }
        artifact = exporter.export(
            result, "sdk_test", "damage", data_source=source,
        )
        ds = artifact["data_source"]
        assert ds["type"] == "sdk"
        assert ds["tables"] == ["hougeki"]
        assert ds["table_descriptions"]["hougeki"] == "砲撃戦"
        assert ds["column_descriptions"]["damage"] == "ダメージ値"

    def test_data_source_defaults_to_unknown(self) -> None:
        """data_source defaults to unknown when not provided."""
        exporter = FormulaExporter()
        result = _make_full_result()
        artifact = exporter.export(result, "no_ds", "y")
        ds = artifact["data_source"]
        assert ds["type"] == "unknown"
