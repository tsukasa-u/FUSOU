"""
FUSOU Datasets Analysis Pipeline.

A 4-stage hybrid data science pipeline for automated game mechanics analysis:
    Stage 0: Feature Selector     -- Identify relevant predictors automatically.
    Stage 1: Noise Filter         -- Calculate quantile boundaries.
    Stage 2: Cap Detector         -- Detect changepoints (formula caps).
    Stage 3: Formula Discoverer   -- Symbolic regression per segment.
"""

from .feature_selector import FeatureSelector, FeatureSelectionResult
from .noise_filter import NoiseFilter, FilterResult
from .cap_detector import CapDetector, CapResult
from .formula_discoverer import FormulaDiscoverer, FormulaResult
from .analyzer import GameMechanicsAnalyzer, AnalysisResult

__all__ = [
    "FeatureSelector",
    "FeatureSelectionResult",
    "NoiseFilter",
    "FilterResult",
    "CapDetector",
    "CapResult",
    "FormulaDiscoverer",
    "FormulaResult",
    "GameMechanicsAnalyzer",
    "AnalysisResult",
]
