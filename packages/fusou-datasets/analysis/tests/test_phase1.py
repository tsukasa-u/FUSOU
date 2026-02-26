"""Tests for phase1_feature_selection module."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from fusou_formula.phase1_feature_selection import (
    FeatureRank,
    FeatureSelectionResult,
    FeatureSelector,
)


class TestFeatureRank:
    def test_creation(self) -> None:
        r = FeatureRank(name="x1", mi_score=0.5, tree_importance=0.3)
        assert r.name == "x1"
        assert r.mi_score == 0.5
        assert r.combined_rank == 0.0


class TestFeatureSelector:
    """Tests for the FeatureSelector class."""

    def test_fit_basic(self, linear_df: pd.DataFrame) -> None:
        selector = FeatureSelector(n_estimators=50, random_state=42)
        result = selector.fit(linear_df, "y", ["x1", "x2"])

        assert isinstance(result, FeatureSelectionResult)
        assert result.target_col == "y"
        assert len(result.rankings) == 2
        assert len(result.selected_features) >= 1
        # Both features should be selected (both are relevant)
        assert "x1" in result.selected_features
        assert "x2" in result.selected_features

    def test_fit_selects_relevant_features(
        self, multifeature_df: pd.DataFrame,
    ) -> None:
        selector = FeatureSelector(
            n_estimators=100, random_state=42,
            selection_threshold=0.1,
        )
        result = selector.fit(
            multifeature_df, "y",
            ["x1", "x2", "x3", "noise1", "noise2"],
        )

        # Relevant features should rank higher than noise
        rank_names = [r.name for r in result.rankings]
        relevant_indices = [
            rank_names.index(n) for n in ["x1", "x2", "x3"]
            if n in rank_names
        ]
        noise_indices = [
            rank_names.index(n) for n in ["noise1", "noise2"]
            if n in rank_names
        ]

        # At least x1 (strongest signal) should rank above noise
        if relevant_indices and noise_indices:
            assert min(relevant_indices) < max(noise_indices)

    def test_fit_missing_target(self) -> None:
        df = pd.DataFrame({"x": [1, 2, 3], "y": [4, 5, 6]})
        selector = FeatureSelector()
        with pytest.raises(ValueError, match="Target column"):
            selector.fit(df, "nonexistent", ["x"])

    def test_fit_no_valid_features(self) -> None:
        df = pd.DataFrame({"x": [1, 2, 3], "y": [4, 5, 6]})
        selector = FeatureSelector()
        with pytest.raises(ValueError, match="No valid candidate"):
            selector.fit(df, "y", ["missing_col"])

    def test_fit_insufficient_data(self) -> None:
        df = pd.DataFrame({"x": [1, 2], "y": [3, 4]})
        selector = FeatureSelector()
        with pytest.raises(ValueError, match="Not enough"):
            selector.fit(df, "y", ["x"])

    def test_max_features(self, multifeature_df: pd.DataFrame) -> None:
        selector = FeatureSelector(
            n_estimators=50, max_features=2, random_state=42,
        )
        result = selector.fit(
            multifeature_df, "y",
            ["x1", "x2", "x3", "noise1", "noise2"],
        )
        assert len(result.selected_features) <= 2

    def test_always_keeps_at_least_one(self) -> None:
        """Even with very high threshold, should keep at least 1 feature."""
        rng = np.random.default_rng(42)
        n = 100
        df = pd.DataFrame({
            "x": rng.uniform(0, 10, n),
            "y": rng.uniform(0, 10, n),  # pure noise
        })
        selector = FeatureSelector(
            n_estimators=50, selection_threshold=0.99, random_state=42,
        )
        result = selector.fit(df, "y", ["x"])
        assert len(result.selected_features) >= 1

    def test_metadata(self, linear_df: pd.DataFrame) -> None:
        selector = FeatureSelector(n_estimators=50, random_state=42)
        result = selector.fit(linear_df, "y", ["x1", "x2"])

        assert "n_samples" in result.metadata
        assert "oob_r2" in result.metadata
        assert isinstance(result.metadata["oob_r2"], float)

    def test_handles_nan(self) -> None:
        rng = np.random.default_rng(42)
        n = 200
        x = rng.uniform(0, 100, n)
        y = 2 * x + rng.normal(0, 1, n)
        df = pd.DataFrame({"x": x, "y": y})
        # Insert some NaN
        df.loc[5, "x"] = np.nan
        df.loc[10, "y"] = np.nan

        selector = FeatureSelector(n_estimators=50, random_state=42)
        result = selector.fit(df, "y", ["x"])
        assert result.metadata["n_samples"] < n

    def test_aggregate_rankings_normalisation(self) -> None:
        selector = FeatureSelector()
        rankings = selector._aggregate_rankings(
            features=["a", "b"],
            mi_scores=np.array([10.0, 5.0]),
            tree_importances=np.array([0.4, 0.6]),
            perm_importances=np.array([0.2, 0.1]),
        )
        # All combined ranks should be in [0, 1]
        for r in rankings:
            assert 0.0 <= r.combined_rank <= 1.0

    def test_aggregate_rankings_zeros(self) -> None:
        selector = FeatureSelector()
        rankings = selector._aggregate_rankings(
            features=["a"],
            mi_scores=np.array([0.0]),
            tree_importances=np.array([0.0]),
            perm_importances=np.array([0.0]),
        )
        assert rankings[0].combined_rank == 0.0

    def test_columns_filter(self) -> None:
        """Features not in DataFrame should be silently filtered."""
        rng = np.random.default_rng(42)
        n = 100
        df = pd.DataFrame({
            "x": rng.uniform(0, 10, n),
            "y": rng.uniform(0, 10, n),
        })
        selector = FeatureSelector(n_estimators=50, random_state=42)
        result = selector.fit(df, "y", ["x", "missing"])
        assert result.all_features == ["x"]
