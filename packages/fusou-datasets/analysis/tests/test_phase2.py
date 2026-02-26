"""Tests for phase2_region_split module."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from fusou_formula.phase2_region_split import (
    Region,
    RegionSplitResult,
    RegionSplitter,
    SplitCondition,
)


class TestSplitCondition:
    def test_creation(self) -> None:
        sc = SplitCondition(feature="x", threshold=50.0, method="cart", score=0.8)
        assert sc.feature == "x"
        assert sc.threshold == 50.0
        assert sc.method == "cart"


class TestRegion:
    def test_creation(self) -> None:
        r = Region(
            conditions=[("x", "<=", 50.0)],
            n_samples=100,
            y_mean=25.0,
            y_std=5.0,
        )
        assert r.n_samples == 100
        assert r.y_mean == 25.0


class TestRegionSplitter:
    """Tests for RegionSplitter."""

    def test_piecewise_finds_split(self, piecewise_df: pd.DataFrame) -> None:
        """Piecewise data should find a split near x=50."""
        splitter = RegionSplitter(
            max_depth=2,
            min_samples_leaf=30,
            use_pelt=False,  # CART only first
            random_state=42,
        )
        result = splitter.fit(piecewise_df, "y", ["x"])

        assert isinstance(result, RegionSplitResult)
        assert len(result.splits) >= 1
        # At least one split should be in the neighbourhood of 50
        # (CART may find additional splits, and the exact split point
        # depends on sample distribution, so we use a wide range)
        thresholds = [s.threshold for s in result.splits]
        near_50 = any(25 <= t <= 75 for t in thresholds)
        assert near_50, f"Expected split near 50, got {thresholds}"

    def test_linear_no_split(self, linear_df: pd.DataFrame) -> None:
        """Linear data may not require splits (one region sufficient)."""
        splitter = RegionSplitter(
            max_depth=2,
            min_samples_leaf=50,
            use_pelt=False,
            random_state=42,
        )
        result = splitter.fit(linear_df, "y", ["x1", "x2"])
        # May find a split or not, but should return valid result
        assert result.n_total_samples > 0
        assert len(result.regions) >= 1

    def test_insufficient_data(self) -> None:
        """Too few samples should return a single region."""
        df = pd.DataFrame({"x": [1, 2, 3], "y": [4, 5, 6]})
        splitter = RegionSplitter(min_samples_leaf=30)
        result = splitter.fit(df, "y", ["x"])
        assert len(result.splits) == 0
        assert len(result.regions) == 1

    def test_get_region_masks_empty_splits(self) -> None:
        df = pd.DataFrame({"x": [1, 2, 3]})
        splitter = RegionSplitter()
        masks = splitter.get_region_masks(df, [], ["x"])
        assert len(masks) == 1
        assert masks[0].all()

    def test_get_region_masks_with_splits(self) -> None:
        df = pd.DataFrame({"x": [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]})
        splits = [SplitCondition(feature="x", threshold=50.0)]
        splitter = RegionSplitter()
        masks = splitter.get_region_masks(df, splits, ["x"])
        assert len(masks) == 2
        # Left: x <= 50
        left_sum = masks[0].sum()
        right_sum = masks[1].sum()
        assert left_sum == 5
        assert right_sum == 5

    def test_get_region_masks_two_splits(self) -> None:
        n = 100
        rng = np.random.default_rng(42)
        df = pd.DataFrame({"x": rng.uniform(0, 100, n)})
        splits = [
            SplitCondition(feature="x", threshold=30.0),
            SplitCondition(feature="x", threshold=70.0),
        ]
        splitter = RegionSplitter()
        masks = splitter.get_region_masks(df, splits, ["x"])
        # Should get 3 or 4 regions (Cartesian product of 2 binary splits)
        assert len(masks) >= 2
        # All data should be covered
        combined = np.any(masks, axis=0)
        assert combined.all()

    def test_regions_cover_all_data(self, piecewise_df: pd.DataFrame) -> None:
        splitter = RegionSplitter(
            max_depth=2,
            min_samples_leaf=30,
            use_pelt=False,
            random_state=42,
        )
        result = splitter.fit(piecewise_df, "y", ["x"])
        total = sum(r.n_samples for r in result.regions)
        assert total == result.n_total_samples

    def test_metadata(self, piecewise_df: pd.DataFrame) -> None:
        splitter = RegionSplitter(
            max_depth=2, use_pelt=False, random_state=42,
        )
        result = splitter.fit(piecewise_df, "y", ["x"])
        assert "ccp_alpha" in result.metadata
        assert "n_cart_splits" in result.metadata

    def test_pelt_splits(self, piecewise_df: pd.DataFrame) -> None:
        """Test PELT-based splits."""
        splitter = RegionSplitter(
            max_depth=1,
            min_samples_leaf=30,
            use_pelt=True,
            pelt_penalty="bic",
            random_state=42,
        )
        result = splitter.fit(piecewise_df, "y", ["x"])
        # Should find at least one split (from CART or PELT)
        assert len(result.splits) >= 1

    def test_merge_deduplication(self) -> None:
        cart = [SplitCondition("x", 50.0, "cart", 0.8)]
        pelt = [SplitCondition("x", 51.0, "pelt", 0.9)]  # very close
        merged = RegionSplitter._merge_splits(cart, pelt)
        assert len(merged) == 1
        assert merged[0].score == 0.9  # Pelt had higher score

    def test_merge_no_dedup_for_different_features(self) -> None:
        cart = [SplitCondition("x", 50.0, "cart", 0.8)]
        pelt = [SplitCondition("z", 50.0, "pelt", 0.5)]
        merged = RegionSplitter._merge_splits(cart, pelt)
        assert len(merged) == 2

    def test_single_region_creation(self) -> None:
        df = pd.DataFrame({
            "x": [1.0, 2.0, 3.0],
            "y": [10.0, 20.0, 30.0],
        })
        region = RegionSplitter._make_single_region(df, "y")
        assert region.n_samples == 3
        assert abs(region.y_mean - 20.0) < 1e-10
