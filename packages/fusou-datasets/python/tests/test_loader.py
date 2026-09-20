"""Tests for fusou_datasets._loader module."""

import uuid
import pytest
import pandas as pd

from fusou_datasets._loader import _normalize_dataframe


def test_normalize_dataframe_uuids():
    u1 = uuid.uuid4()
    u2 = uuid.uuid4()
    df = pd.DataFrame({
        "id": [u1, u2, None],
        "value": [10, 20, 30],
    })
    
    assert isinstance(df["id"].iloc[0], uuid.UUID)
    
    normalized = _normalize_dataframe(df)
    
    assert isinstance(normalized["id"].iloc[0], str)
    assert normalized["id"].iloc[0] == str(u1)
    assert normalized["id"].iloc[1] == str(u2)
    assert pd.isna(normalized["id"].iloc[2])

def test_load_invalid_split():
    from fusou_datasets._loader import load
    with pytest.raises(ValueError, match="split must be one of"):
        load("battle", split="invalid_split_name")