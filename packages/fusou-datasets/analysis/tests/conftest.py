"""Shared fixtures for fusou-formula tests."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
import pytest

from fusou_formula.data_loader import DataLoader, LoadedDataset


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(42)


@pytest.fixture
def linear_df(rng: np.random.Generator) -> pd.DataFrame:
    """y = 2*x1 + 3*x2 + 5 + small noise."""
    n = 500
    x1 = rng.uniform(0, 100, n)
    x2 = rng.uniform(0, 50, n)
    noise = rng.normal(0, 0.5, n)
    y = 2 * x1 + 3 * x2 + 5 + noise
    return pd.DataFrame({"x1": x1, "x2": x2, "y": y})


@pytest.fixture
def piecewise_df(rng: np.random.Generator) -> pd.DataFrame:
    """Piecewise linear: y = x if x <= 50, y = 2*x - 50 if x > 50."""
    n = 1000
    x = rng.uniform(0, 100, n)
    noise = rng.normal(0, 0.3, n)
    y = np.where(x <= 50, x, 2 * x - 50) + noise
    return pd.DataFrame({"x": x, "y": y})


@pytest.fixture
def multifeature_df(rng: np.random.Generator) -> pd.DataFrame:
    """3 relevant + 2 irrelevant features."""
    n = 500
    x1 = rng.uniform(10, 200, n)
    x2 = rng.uniform(0, 100, n)
    x3 = rng.uniform(-10, 10, n)
    noise_col1 = rng.standard_normal(n)
    noise_col2 = rng.standard_normal(n)
    y = x1 * 1.5 + x2 * 0.3 - x3 ** 2 * 0.01 + rng.normal(0, 1, n)
    return pd.DataFrame({
        "x1": x1,
        "x2": x2,
        "x3": x3,
        "noise1": noise_col1,
        "noise2": noise_col2,
        "y": y,
    })


@pytest.fixture
def synthetic_dataset() -> LoadedDataset:
    """Synthetic dataset from DataLoader."""
    return DataLoader.create_synthetic(
        formula_fn=lambda x, z: x * 2.0 + z * 0.5 + 10.0,
        n_samples=300,
        feature_ranges={"x": (0.0, 100.0), "z": (0.0, 50.0)},
        noise_fn=lambda rng: rng.normal(0, 0.1),
        seed=42,
    )
