"""Tests for fusou_datasets.schema type resolution and validation."""

import pytest
import pandas as pd
import fusou_datasets as fd
from fusou_datasets import Tables, resolve_table_name, validate_schema, TableMeta, Column


def test_table_resolution():
    assert resolve_table_name(Tables.Battle) == "battle"
    assert resolve_table_name(Tables.Cells) == "cells"
    assert resolve_table_name("cells") == "cells"
    assert resolve_table_name("CELLS") == "cells"


def test_table_typo_suggestion():
    with pytest.raises(ValueError) as exc:
        resolve_table_name("celss")
    assert "Did you mean 'cells'?" in str(exc.value)


def test_table_meta_columns():
    assert len(Tables.Battle.COLUMNS) > 30
    assert "timestamp" in Tables.Battle.COLUMN_NAMES
    assert Tables.Battle.get_column("timestamp") == Tables.Battle.TIMESTAMP


def test_column_cast_and_dtype():
    col = Tables.Cells.MAPAREA_ID
    assert col.dtype in ("Int64", "int64")
    series = pd.Series(["1", "2", None])
    cast_s = col.cast(series)
    assert cast_s.dtype.name == "Int64"
    assert cast_s.iloc[0] == 1


def test_table_validation():
    # DataFrame missing required columns
    bad_df = pd.DataFrame({"dummy": [1, 2]})
    issues = Tables.Cells.validate_dataframe(bad_df)
    assert len(issues) > 0
    assert any("Missing non-nullable column 'uuid'" in s for s in issues)


def test_query_filter_typo():
    df = pd.DataFrame({"ship_id": [1], "lv": [50]})
    q = fd.DatasetQuery(df)
    with pytest.raises(ValueError) as exc:
        q.filter(ship_ids=1)
    assert "Did you mean 'ship_id'?" in str(exc.value)


def test_query_select_typo():
    df = pd.DataFrame({"ship_id": [1], "lv": [50]})
    q = fd.DatasetQuery(df)
    with pytest.raises(ValueError) as exc:
        q.select("lvl")
    assert "Did you mean 'lv'?" in str(exc.value)
