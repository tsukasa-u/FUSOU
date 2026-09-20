"""Tests for fusou_datasets._query_builder module."""

import pytest
import pandas as pd
import numpy as np

from fusou_datasets._query_builder import DatasetQuery


@pytest.fixture
def sample_df():
    return pd.DataFrame({
        "id": [1, 2, 3, 4, 5],
        "name": ["Fubuki", "Shirayuki", "Hatsuyuki", "Miyuki", "Murakumo"],
        "stype": [2, 2, 2, 2, 2],
        "lv": [10, 50, 75, 90, 99],
    })


def test_query_filter_django_syntax(sample_df):
    q = DatasetQuery(sample_df).filter(lv__gte=75)
    res = q.to_pandas()
    assert len(res) == 3
    assert list(res["name"]) == ["Hatsuyuki", "Miyuki", "Murakumo"]


def test_query_filter_in(sample_df):
    q = DatasetQuery(sample_df).filter(id__in=[1, 4])
    res = q.to_pandas()
    assert len(res) == 2
    assert list(res["name"]) == ["Fubuki", "Miyuki"]


def test_query_select_and_limit(sample_df):
    q = DatasetQuery(sample_df).select("id", "name").sort_by("lv", ascending=False).limit(2)
    res = q.to_pandas()
    assert len(res) == 2
    assert list(res.columns) == ["id", "name"]
    assert res.iloc[0]["name"] == "Murakumo"
    assert res.iloc[1]["name"] == "Miyuki"


def test_query_numpy_array_protocol(sample_df):
    q = DatasetQuery(sample_df).select("id", "lv")
    arr = np.asarray(q)
    assert isinstance(arr, np.ndarray)
    assert arr.shape == (5, 2)


def test_query_repr_html(sample_df):
    q = DatasetQuery(sample_df).limit(3)
    html = q._repr_html_()
    assert "DatasetQuery Result" in html
    assert "Fubuki" in html
def test_query_to_dataframe(sample_df):
    q = DatasetQuery(sample_df).filter(lv__gte=90)
    df = q.to_dataframe()
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 2
