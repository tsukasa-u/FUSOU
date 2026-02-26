"""Tests for data_loader module."""

from __future__ import annotations

import math
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from fusou_formula.data_loader import DataLoader, LoadedDataset


class TestLoadedDataset:
    """Tests for the LoadedDataset dataclass."""

    def test_basic_creation(self) -> None:
        df = pd.DataFrame({"x": [1, 2, 3], "y": [4, 5, 6]})
        ds = LoadedDataset(
            df=df, target_col="y", feature_cols=["x"],
        )
        assert ds.target_col == "y"
        assert ds.feature_cols == ["x"]
        assert ds.category_cols == []
        assert ds.metadata == {}

    def test_metadata(self) -> None:
        df = pd.DataFrame({"x": [1], "y": [2]})
        ds = LoadedDataset(df=df, target_col="y", metadata={"source": "test"})
        assert ds.metadata["source"] == "test"


class TestDataLoaderCSV:
    """Tests for CSV loading."""

    def test_load_csv(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "test.csv"
        df = pd.DataFrame({"a": [1, 2, 3, 4], "b": [5, 6, 7, 8], "target": [9, 10, 11, 12]})
        df.to_csv(csv_path, index=False)

        loader = DataLoader()
        ds = loader.load_from_csv(str(csv_path), "target")
        assert ds.target_col == "target"
        assert "a" in ds.feature_cols
        assert "b" in ds.feature_cols
        assert len(ds.df) == 4

    def test_load_csv_with_feature_cols(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "test.csv"
        df = pd.DataFrame({"a": [1, 2], "b": [3, 4], "c": [5, 6], "y": [7, 8]})
        df.to_csv(csv_path, index=False)

        loader = DataLoader()
        ds = loader.load_from_csv(str(csv_path), "y", feature_cols=["a", "b"])
        assert ds.feature_cols == ["a", "b"]

    def test_load_csv_missing_target(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "test.csv"
        pd.DataFrame({"a": [1]}).to_csv(csv_path, index=False)

        loader = DataLoader()
        with pytest.raises(ValueError, match="Target column.*not found"):
            loader.load_from_csv(str(csv_path), "nonexistent")

    def test_load_csv_drops_na_target(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "test.csv"
        df = pd.DataFrame({"x": [1, 2, 3], "y": [10, np.nan, 30]})
        df.to_csv(csv_path, index=False)

        loader = DataLoader()
        ds = loader.load_from_csv(str(csv_path), "y")
        assert len(ds.df) == 2

    def test_load_csv_no_drop_na(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "test.csv"
        df = pd.DataFrame({"x": [1, 2, 3], "y": [10, np.nan, 30]})
        df.to_csv(csv_path, index=False)

        loader = DataLoader()
        ds = loader.load_from_csv(str(csv_path), "y", drop_na_target=False)
        assert len(ds.df) == 3


class TestDataLoaderDataFrame:
    """Tests for DataFrame wrapping."""

    def test_load_from_dataframe(self) -> None:
        df = pd.DataFrame({"x": [1, 2, 3], "y": [10, 20, 30]})
        ds = DataLoader.load_from_dataframe(df, "y")
        assert ds.target_col == "y"
        assert "x" in ds.feature_cols
        assert ds.metadata["source"] == "dataframe"

    def test_load_from_dataframe_missing_target(self) -> None:
        df = pd.DataFrame({"x": [1]})
        with pytest.raises(ValueError, match="Target column"):
            DataLoader.load_from_dataframe(df, "missing")

    def test_does_not_modify_original(self) -> None:
        df = pd.DataFrame({"x": [1, 2, 3], "y": [10, np.nan, 30]})
        original_len = len(df)
        DataLoader.load_from_dataframe(df, "y")
        assert len(df) == original_len  # original unchanged


class TestDataLoaderSynthetic:
    """Tests for synthetic data generation."""

    def test_basic_synthetic(self) -> None:
        ds = DataLoader.create_synthetic(
            formula_fn=lambda x: x * 2,
            n_samples=100,
        )
        assert len(ds.df) == 100
        assert ds.target_col == "y"
        assert "x" in ds.feature_cols

    def test_synthetic_with_multiple_features(self) -> None:
        ds = DataLoader.create_synthetic(
            formula_fn=lambda a, b: a + b,
            n_samples=50,
            feature_ranges={"a": (0, 10), "b": (0, 10)},
        )
        assert len(ds.df) == 50
        assert set(ds.feature_cols) == {"a", "b"}

    def test_synthetic_with_noise(self) -> None:
        ds_no_noise = DataLoader.create_synthetic(
            formula_fn=lambda x: x * 2,
            n_samples=200,
            seed=42,
        )
        ds_noise = DataLoader.create_synthetic(
            formula_fn=lambda x: x * 2,
            n_samples=200,
            noise_fn=lambda rng: rng.normal(0, 5),
            seed=42,
        )
        # Noise should make the data different
        assert not np.allclose(ds_no_noise.df["y"], ds_noise.df["y"])

    def test_synthetic_with_categories(self) -> None:
        ds = DataLoader.create_synthetic(
            formula_fn=lambda x: x * 2,
            n_samples=100,
            category_spec={"cat": ["A", "B", "C"]},
        )
        assert "cat" in ds.category_cols
        assert set(ds.df["cat"].unique()) <= {"A", "B", "C"}

    def test_synthetic_custom_target_col(self) -> None:
        ds = DataLoader.create_synthetic(
            formula_fn=lambda x: x,
            n_samples=10,
            target_col="output",
        )
        assert ds.target_col == "output"
        assert "output" in ds.df.columns

    def test_synthetic_reproducibility(self) -> None:
        ds1 = DataLoader.create_synthetic(
            formula_fn=lambda x: x ** 2,
            n_samples=50,
            seed=123,
        )
        ds2 = DataLoader.create_synthetic(
            formula_fn=lambda x: x ** 2,
            n_samples=50,
            seed=123,
        )
        pd.testing.assert_frame_equal(ds1.df, ds2.df)

    def test_synthetic_formula_exception(self) -> None:
        def bad_fn(x: float) -> float:
            if x > 50:
                raise RuntimeError("boom")
            return x

        ds = DataLoader.create_synthetic(
            formula_fn=bad_fn,
            n_samples=100,
        )
        # Should have NaN for rows where exception occurred
        assert ds.df["y"].isna().sum() > 0


class TestAutoDetect:
    """Tests for auto-detection helpers."""

    def test_detect_numeric_cols(self) -> None:
        df = pd.DataFrame({
            "int_col": [1, 2, 3],
            "float_col": [1.0, 2.0, 3.0],
            "str_col": ["a", "b", "c"],
            "target": [10, 20, 30],
        })
        cols = DataLoader._auto_detect_numeric_cols(df, exclude=["target"])
        assert "int_col" in cols
        assert "float_col" in cols
        assert "str_col" not in cols
        assert "target" not in cols

    def test_detect_category_cols(self) -> None:
        df = pd.DataFrame({
            "str_col": ["a"] * 100,
            "bool_col": [True] * 100,
            "low_card_int": [1] * 50 + [2] * 50,
            "high_card_int": list(range(100)),
            "float_col": np.linspace(0, 1, 100),
        })
        cats = DataLoader._auto_detect_category_cols(df)
        assert "str_col" in cats
        assert "bool_col" in cats
        assert "low_card_int" in cats
        # high_card_int has 100 unique values > 30, should NOT be detected
        assert "high_card_int" not in cats
        assert "float_col" not in cats


class TestDiscoverTargets:
    """Tests for auto-target discovery."""

    def test_basic_discovery(self) -> None:
        rng = np.random.default_rng(42)
        df = pd.DataFrame({
            "x": rng.uniform(0, 100, 200),
            "y": rng.uniform(0, 100, 200),
            "damage": rng.uniform(10, 500, 200),
            "flag": rng.choice([0, 1], 200),
            "uuid": [f"id_{i}" for i in range(200)],
            "index": list(range(200)),
        })
        targets = DataLoader.discover_targets(df)
        assert "damage" in targets
        assert "x" in targets
        assert "y" in targets
        # Should exclude uuid (string), index (pattern), flag (low cardinality)
        assert "uuid" not in targets
        assert "index" not in targets
        assert "flag" not in targets

    def test_empty_df(self) -> None:
        df = pd.DataFrame()
        targets = DataLoader.discover_targets(df)
        assert targets == []

    def test_all_strings(self) -> None:
        df = pd.DataFrame({
            "a": ["foo"] * 50,
            "b": ["bar"] * 50,
        })
        targets = DataLoader.discover_targets(df)
        assert targets == []

    def test_min_unique_filter(self) -> None:
        df = pd.DataFrame({
            "low_card": [1, 2, 3] * 20,  # 3 unique
            "high_card": list(range(60)),  # 60 unique
        })
        targets = DataLoader.discover_targets(df, min_unique=10)
        assert "low_card" not in targets
        assert "high_card" in targets

    def test_custom_exclude(self) -> None:
        rng = np.random.default_rng(42)
        df = pd.DataFrame({
            "x": rng.uniform(0, 100, 100),
            "special_col": rng.uniform(0, 100, 100),
        })
        targets = DataLoader.discover_targets(
            df, exclude_patterns=["special"],
        )
        assert "x" in targets
        assert "special_col" not in targets

    def test_all_nan_excluded(self) -> None:
        df = pd.DataFrame({
            "x": np.linspace(0, 1, 100),
            "all_nan": [np.nan] * 100,
        })
        targets = DataLoader.discover_targets(df)
        assert "x" in targets
        assert "all_nan" not in targets


class TestListTablesFromSchema:
    """Tests for schema-based table listing."""

    def test_returns_list(self) -> None:
        tables = DataLoader._list_tables_from_schema()
        assert isinstance(tables, list)
        # Should have tables from fusou_datasets.schema
        assert len(tables) > 0
        assert "battle" in tables
        assert "hougeki" in tables

    def test_sorted(self) -> None:
        tables = DataLoader._list_tables_from_schema()
        assert tables == sorted(tables)
