"""fusou-formula: Black-box mathematical model extraction pipeline.

No domain-specific assumptions are embedded.  The pipeline uses
data-driven methods (MI, CART, PELT, PySR, CV, KDE) to discover
closed-form expressions from tabular data.
"""

from fusou_formula.data_loader import DataLoader, LoadedDataset
from fusou_formula.exporter import FormulaExporter
from fusou_formula.phase1_feature_selection import (
    FeatureRank,
    FeatureSelectionResult,
    FeatureSelector,
)
from fusou_formula.phase2_region_split import (
    Region,
    RegionSplitResult,
    RegionSplitter,
    SplitCondition,
)
from fusou_formula.phase3_symbolic import (
    ExpressionCandidate,
    SymbolicResult,
    SymbolicSearcher,
)
from fusou_formula.phase4_validation import (
    FoldMetrics,
    ModelValidator,
    ResidualDiagnostics,
    ValidationResult,
)
from fusou_formula.phase5_noise import (
    DistributionFit,
    NoiseAnalyzer,
    NoiseResult,
)
from fusou_formula.pipeline import (
    Pipeline,
    PipelineConfig,
    PipelineResult,
    RegionModel,
)
from fusou_formula.validators import (
    ComparisonMetrics,
    ComparisonResult,
    FormulaValidator,
)

__all__ = [
    # Pipeline
    "Pipeline",
    "PipelineConfig",
    "PipelineResult",
    "RegionModel",
    # Data
    "DataLoader",
    "LoadedDataset",
    # Phase 1
    "FeatureSelector",
    "FeatureSelectionResult",
    "FeatureRank",
    # Phase 2
    "RegionSplitter",
    "RegionSplitResult",
    "SplitCondition",
    "Region",
    # Phase 3
    "SymbolicSearcher",
    "SymbolicResult",
    "ExpressionCandidate",
    # Phase 4
    "ModelValidator",
    "ValidationResult",
    "FoldMetrics",
    "ResidualDiagnostics",
    # Phase 5
    "NoiseAnalyzer",
    "NoiseResult",
    "DistributionFit",
    # Validators
    "FormulaValidator",
    "ComparisonResult",
    "ComparisonMetrics",
    # Export
    "FormulaExporter",
]


def main() -> None:
    """CLI entry point — delegates to the run script."""
    from fusou_formula.pipeline import Pipeline, PipelineConfig

    import argparse
    import sys

    p = argparse.ArgumentParser(
        description="fusou-formula: Black-box model extraction pipeline",
    )
    p.add_argument("--csv", required=True, help="Path to CSV data file")
    p.add_argument("--target-col", required=True, help="Target column name")
    p.add_argument(
        "--feature-cols",
        help="Comma-separated feature column names (auto-detected if omitted)",
    )
    p.add_argument("--output", default="results", help="Output directory")
    p.add_argument(
        "--skip-phases",
        help="Comma-separated phase numbers to skip (e.g. '2,5')",
    )

    args = p.parse_args()

    import pandas as pd

    df = pd.read_csv(args.csv)
    target_col = args.target_col

    if args.feature_cols:
        feature_cols = [c.strip() for c in args.feature_cols.split(",")]
    else:
        feature_cols = DataLoader._auto_detect_numeric_cols(
            df, exclude=[target_col],
        )

    skip_phases = None
    if args.skip_phases:
        skip_phases = [int(x.strip()) for x in args.skip_phases.split(",")]

    pipeline = Pipeline(PipelineConfig())
    result = pipeline.run(
        df, target_col, feature_cols, skip_phases=skip_phases,
    )

    print("\n" + pipeline.report())

    exporter = FormulaExporter()
    artifact = exporter.export(result, artifact_id="cli_run", target_name=target_col)
    filepath = exporter.save(artifact, args.output)
    print(f"\nArtifact saved: {filepath}")
