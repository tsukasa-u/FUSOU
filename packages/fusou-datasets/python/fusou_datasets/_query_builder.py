"""
fusou_datasets._query_builder
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Fluent Query Builder (DatasetQuery) with zero-copy ecosystem interoperability
(Arrow PyCapsule, NumPy __array__, DataFrame Interchange Protocol).
"""

from typing import Optional, List, Dict, Any, Union, Callable
import pandas as pd
import numpy as np

from .schema import Column


class DatasetQuery:
    """
    Fluent Query Builder for datasets supporting filtering, projection, and
    seamless connection to pandas, Polars, DuckDB, scikit-learn, and Seaborn.
    """
    
    def __init__(self, df: pd.DataFrame):
        self._df = df
        self._filters: List[Callable[[pd.DataFrame], pd.Series]] = []
        self._columns: Optional[List[str]] = None
        self._limit_n: Optional[int] = None
        self._sort_cols: Optional[List[str]] = None
        self._sort_ascending: bool = True

    def filter(self, *predicates: Callable[[pd.DataFrame], pd.Series], **kwargs) -> "DatasetQuery":
        """
        Add filter predicates.
        
        Supports callable predicates (e.g. lambda df: df['lv'] > 50) and
        Django-style kwargs (e.g. lv__gte=50, stype__in=[2, 3]).
        """
        new_q = self._clone()
        for p in predicates:
            new_q._filters.append(p)
        
        import difflib
        for key, val in kwargs.items():
            col_name = key.split("__")[0]
            if col_name not in self._df.columns:
                matches = difflib.get_close_matches(col_name, list(self._df.columns), n=1)
                suggestion = f" Did you mean '{matches[0]}'?" if matches else ""
                raise ValueError(
                    f"Column '{col_name}' not found in dataset.{suggestion}\n"
                    f"Available columns: {list(self._df.columns)}"
                )
            predicate = self._parse_kwarg_predicate(key, val)
            new_q._filters.append(predicate)
            
        return new_q

    def select(self, *columns: Union[str, Column]) -> "DatasetQuery":
        """Project specific columns."""
        new_q = self._clone()
        import difflib
        cols = []
        for c in columns:
            col_str = str(c)
            if col_str not in self._df.columns:
                matches = difflib.get_close_matches(col_str, list(self._df.columns), n=1)
                suggestion = f" Did you mean '{matches[0]}'?" if matches else ""
                raise ValueError(
                    f"Column '{col_str}' not found in dataset.{suggestion}\n"
                    f"Available columns: {list(self._df.columns)}"
                )
            cols.append(col_str)
        new_q._columns = cols
        return new_q

    def sort_by(self, *columns: Union[str, Column], ascending: bool = True) -> "DatasetQuery":
        """Sort rows by columns."""
        new_q = self._clone()
        new_q._sort_cols = [str(c) for c in columns]
        new_q._sort_ascending = ascending
        return new_q

    def limit(self, n: int) -> "DatasetQuery":
        """Limit maximum returned rows."""
        new_q = self._clone()
        new_q._limit_n = n
        return new_q

    def execute(self) -> pd.DataFrame:
        """Execute query and return resulting pandas DataFrame."""
        result = self._df
        
        for f in self._filters:
            mask = f(result)
            result = result[mask]
        
        if self._sort_cols:
            existing_sort_cols = [c for c in self._sort_cols if c in result.columns]
            if existing_sort_cols:
                result = result.sort_values(by=existing_sort_cols, ascending=self._sort_ascending)
        
        if self._columns:
            existing_cols = [c for c in self._columns if c in result.columns]
            result = result[existing_cols]
            
        if self._limit_n is not None:
            result = result.head(self._limit_n)
            
        return result.reset_index(drop=True)

    def to_pandas(self) -> pd.DataFrame:
        """Alias for execute(). Returns a pandas DataFrame."""
        return self.execute()

    def to_dataframe(self) -> pd.DataFrame:
        """Alias for execute(). Returns a pandas DataFrame."""
        return self.execute()

    def to_arrow(self):
        """Convert result to PyArrow Table."""
        import pyarrow as pa
        return pa.Table.from_pandas(self.execute())

    # --- Ecosystem Interoperability Protocols ---

    def __arrow_c_stream__(self, requested_schema=None):
        """PyCapsule Arrow C Stream protocol for zero-copy connection to Polars & DuckDB."""
        arrow_table = self.to_arrow()
        if hasattr(arrow_table, "__arrow_c_stream__"):
            return arrow_table.__arrow_c_stream__(requested_schema)
        # Fallback via pyarrow RecordBatchReader
        reader = arrow_table.to_reader()
        return reader.__arrow_c_stream__(requested_schema)

    def __array__(self, dtype=None):
        """NumPy array interface for direct compatibility with scikit-learn."""
        df = self.execute()
        return np.asarray(df.values, dtype=dtype)

    def __dataframe__(self, nan_as_null: bool = False, allow_copy: bool = True):
        """DataFrame Interchange Protocol for compatibility with Seaborn & Plotly."""
        df = self.execute()
        if hasattr(df, "__dataframe__"):
            return df.__dataframe__(nan_as_null=nan_as_null, allow_copy=allow_copy)
        raise NotImplementedError("Underlying pandas version does not support __dataframe__")

    def _repr_html_(self) -> str:
        """Rich HTML display in Jupyter Notebooks and Google Colab."""
        df = self.execute()
        html = df.head(10)._repr_html_()
        return (
            f"<div style='border: 1px solid #4a5568; padding: 8px; border-radius: 4px;'>"
            f"<strong>DatasetQuery Result</strong> ({len(df)} rows)"
            f"{html}"
            f"</div>"
        )

    def _clone(self) -> "DatasetQuery":
        new_q = DatasetQuery(self._df)
        new_q._filters = list(self._filters)
        new_q._columns = list(self._columns) if self._columns else None
        new_q._limit_n = self._limit_n
        new_q._sort_cols = list(self._sort_cols) if self._sort_cols else None
        new_q._sort_ascending = self._sort_ascending
        return new_q

    @staticmethod
    def _parse_kwarg_predicate(key: str, val: Any) -> Callable[[pd.DataFrame], pd.Series]:
        parts = key.split("__")
        col = parts[0]
        op = parts[1] if len(parts) > 1 else "eq"
        
        if op == "eq":
            return lambda df: df[col] == val
        elif op == "ne":
            return lambda df: df[col] != val
        elif op == "gt":
            return lambda df: df[col] > val
        elif op == "gte":
            return lambda df: df[col] >= val
        elif op == "lt":
            return lambda df: df[col] < val
        elif op == "lte":
            return lambda df: df[col] <= val
        elif op == "in":
            return lambda df: df[col].isin(val)
        elif op == "notin":
            return lambda df: ~df[col].isin(val)
        elif op == "startswith":
            return lambda df: df[col].astype(str).str.startswith(str(val))
        elif op == "contains":
            return lambda df: df[col].astype(str).str.contains(str(val), na=False)
        else:
            raise ValueError(f"Unknown filter operator '{op}' in '{key}'")