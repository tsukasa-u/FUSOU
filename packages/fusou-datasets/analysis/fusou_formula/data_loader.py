"""Data loader: generic data loading with no domain-specific assumptions.

Provides helpers to load data from the fusou-datasets SDK, CSV files,
or generate synthetic test data.  No game-specific constants or
formulas are embedded.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


@dataclass
class LoadedDataset:
    """Container for a loaded dataset ready for the pipeline.

    Attributes
    ----------
    df : DataFrame
        The data.
    target_col : str
        Name of the target (dependent) variable column.
    feature_cols : list of str
        Names of the feature (independent) variable columns.
    category_cols : list of str
        Names of the categorical columns (for grouping / conditioning).
    metadata : dict
        Arbitrary metadata about the dataset.
    """

    df: pd.DataFrame
    target_col: str
    feature_cols: list[str] = field(default_factory=list)
    category_cols: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class DataLoader:
    """Load data from various sources for the pipeline.

    Wraps the ``fusou-datasets`` SDK for Avro-based table access and
    also supports CSV / DataFrame inputs.

    Parameters
    ----------
    data_dir : str or None
        Base directory for fusou-datasets.  If *None*, uses the SDK default.
    """

    def __init__(self, data_dir: Optional[str] = None) -> None:
        self._data_dir = data_dir
        self._sdk: Any = None

    # ------------------------------------------------------------------
    # SDK helpers
    # ------------------------------------------------------------------

    def _ensure_configured(self) -> None:
        """Lazily import and configure fusou-datasets SDK."""
        if self._sdk is not None:
            return
        try:
            import fusou_datasets as fd  # type: ignore[import-untyped]

            if self._data_dir:
                fd.configure(data_dir=self._data_dir)
            self._sdk = fd
        except ImportError:
            raise ImportError(
                "fusou-datasets is required for SDK data loading.  "
                "Install it via ``pip install fusou-datasets``."
            )

    def _load_table(self, table_name: str) -> pd.DataFrame:
        """Load a single table from the SDK as a DataFrame."""
        self._ensure_configured()
        return self._sdk.load(table_name)

    def list_tables(self) -> List[str]:
        """List available tables via the SDK."""
        self._ensure_configured()
        try:
            return self._sdk.list_tables()
        except Exception as e:
            # If API key is not set, fall back to schema-based discovery
            return self._list_tables_from_schema()

    @staticmethod
    def _list_tables_from_schema() -> List[str]:
        """Extract table names from fusou_datasets.schema.Tables."""
        try:
            from fusou_datasets.schema import Tables

            table_names: List[str] = []
            for name in dir(Tables):
                cls = getattr(Tables, name)
                if (
                    isinstance(cls, type)
                    and hasattr(cls, "TABLE")
                    and isinstance(cls.TABLE, str)
                ):
                    table_names.append(cls.TABLE)
            return sorted(table_names)
        except ImportError:
            return []

    # ------------------------------------------------------------------
    # Auto-target discovery
    # ------------------------------------------------------------------

    @staticmethod
    def discover_targets(
        df: pd.DataFrame,
        *,
        min_unique: int = 10,
        exclude_patterns: Optional[List[str]] = None,
    ) -> List[str]:
        """Discover candidate target columns for formula extraction.

        Selects *continuous numeric* columns that are likely to be outputs
        of a deterministic formula plus noise.  Excludes identifiers,
        timestamps, flags, and low-cardinality integers.

        Parameters
        ----------
        df : DataFrame
        min_unique : int
            Minimum number of unique values for a column to be
            considered continuous (avoids flags / IDs).
        exclude_patterns : list of str or None
            Column name substrings to exclude (e.g. ``["uuid", "index"]``).

        Returns
        -------
        list of str
            Column names suitable as regression targets.
        """
        default_exclude = [
            "uuid", "env_uuid", "index", "timestamp", "_id",
            "flag", "eflag", "protect",
        ]
        exclude_pats = (exclude_patterns or []) + default_exclude

        targets: List[str] = []
        for col in df.columns:
            # Skip non-numeric
            if not pd.api.types.is_numeric_dtype(df[col]):
                continue

            # Skip columns matching exclude patterns
            col_lower = col.lower()
            if any(pat.lower() in col_lower for pat in exclude_pats):
                continue

            # Skip low-cardinality (flags, enum IDs)
            n_unique = df[col].nunique()
            if n_unique < min_unique:
                continue

            # Skip columns that are all NaN
            if df[col].isna().all():
                continue

            targets.append(col)

        return targets

    def discover_analysis_tasks(
        self,
        tables: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Auto-discover all (table, target, features) combinations.

        Loads each table, finds candidate target columns, and for
        each target identifies the remaining numeric columns as
        candidate features.

        Parameters
        ----------
        tables : list of str or None
            Table names to scan.  If *None*, scans all available tables.

        Returns
        -------
        list of dict
            Each dict has keys ``table``, ``target_col``, ``feature_cols``,
            ``n_samples``, ``df``.
        """
        if tables is None:
            tables = self.list_tables()

        tasks: List[Dict[str, Any]] = []
        for table in tables:
            try:
                df = self._load_table(table)
            except Exception as e:
                print(f"[discover] Skipping table '{table}': {e}")
                continue

            if len(df) < 30:
                print(
                    f"[discover] Skipping table '{table}': "
                    f"too few rows ({len(df)})"
                )
                continue

            targets = self.discover_targets(df)
            if not targets:
                continue

            for target_col in targets:
                feature_cols = self._auto_detect_numeric_cols(
                    df, exclude=[target_col],
                )
                # Need at least 1 feature
                if not feature_cols:
                    continue

                tasks.append({
                    "table": table,
                    "target_col": target_col,
                    "feature_cols": feature_cols,
                    "n_samples": len(df.dropna(subset=[target_col])),
                    "df": df,
                })

        return tasks

    # ------------------------------------------------------------------
    # Generic loaders
    # ------------------------------------------------------------------

    def load_from_sdk(
        self,
        tables: List[str],
        target_col: str,
        *,
        join_on: Optional[str] = None,
        feature_cols: Optional[List[str]] = None,
        category_cols: Optional[List[str]] = None,
        drop_na_target: bool = True,
    ) -> LoadedDataset:
        """Load and join one or more tables from the fusou-datasets SDK.

        Parameters
        ----------
        tables : list of str
            Table names to load (first is the primary table).
        target_col : str
            Target column name (must exist after joins).
        join_on : str or None
            Column to join tables on.  Defaults to ``"env_uuid"``.
        feature_cols : list of str or None
            Feature columns.  If *None*, auto-detected (all numeric
            columns except *target_col*).
        category_cols : list of str or None
            Categorical columns.  If *None*, auto-detected.
        drop_na_target : bool
            Whether to drop rows where *target_col* is NaN.

        Returns
        -------
        LoadedDataset
        """
        if join_on is None:
            join_on = "env_uuid"

        dfs: List[pd.DataFrame] = []
        for t in tables:
            try:
                dfs.append(self._load_table(t))
            except Exception as e:
                raise RuntimeError(
                    f"Failed to load table '{t}' from SDK: {e}"
                ) from e

        df = dfs[0]
        for other in dfs[1:]:
            shared = set(df.columns) & set(other.columns)
            if join_on in shared:
                other_cols = [
                    c for c in other.columns if c not in df.columns or c == join_on
                ]
                df = df.merge(other[other_cols], on=join_on, how="left")
            else:
                df = pd.concat([df, other], axis=1)

        if target_col not in df.columns:
            available = sorted(df.columns.tolist())
            raise ValueError(
                f"Target column '{target_col}' not found in joined data.\n"
                f"Available columns ({len(available)}):\n"
                + "\n".join(f"  - {c}" for c in available)
            )

        if drop_na_target:
            df = df.dropna(subset=[target_col]).reset_index(drop=True)

        if feature_cols is None:
            feature_cols = self._auto_detect_numeric_cols(df, exclude=[target_col])
        if category_cols is None:
            category_cols = self._auto_detect_category_cols(df, exclude=[target_col])

        return LoadedDataset(
            df=df,
            target_col=target_col,
            feature_cols=feature_cols,
            category_cols=category_cols,
            metadata={"tables": tables, "join_on": join_on},
        )

    def load_from_csv(
        self,
        path: str,
        target_col: str,
        *,
        feature_cols: Optional[List[str]] = None,
        category_cols: Optional[List[str]] = None,
        drop_na_target: bool = True,
    ) -> LoadedDataset:
        """Load data from a CSV file.

        Parameters
        ----------
        path : str
            Path to the CSV file.
        target_col : str
            Target column name.
        feature_cols : list of str or None
            If *None*, auto-detect numeric columns.
        category_cols : list of str or None
            If *None*, auto-detect categorical columns.
        drop_na_target : bool
            Whether to drop rows where *target_col* is NaN.

        Returns
        -------
        LoadedDataset
        """
        df = pd.read_csv(path)

        if target_col not in df.columns:
            raise ValueError(
                f"Target column '{target_col}' not found.  "
                f"Available: {list(df.columns)}"
            )

        if drop_na_target:
            df = df.dropna(subset=[target_col]).reset_index(drop=True)

        if feature_cols is None:
            feature_cols = self._auto_detect_numeric_cols(df, exclude=[target_col])
        if category_cols is None:
            category_cols = self._auto_detect_category_cols(df, exclude=[target_col])

        return LoadedDataset(
            df=df,
            target_col=target_col,
            feature_cols=feature_cols,
            category_cols=category_cols,
            metadata={"source": "csv", "path": str(path)},
        )

    @staticmethod
    def load_from_dataframe(
        df: pd.DataFrame,
        target_col: str,
        *,
        feature_cols: Optional[List[str]] = None,
        category_cols: Optional[List[str]] = None,
        drop_na_target: bool = True,
    ) -> LoadedDataset:
        """Wrap an existing DataFrame as a LoadedDataset.

        Parameters
        ----------
        df : DataFrame
        target_col : str
        feature_cols, category_cols : list of str or None
            Auto-detected if *None*.
        drop_na_target : bool

        Returns
        -------
        LoadedDataset
        """
        if target_col not in df.columns:
            raise ValueError(
                f"Target column '{target_col}' not found.  "
                f"Available: {list(df.columns)}"
            )

        df = df.copy()
        if drop_na_target:
            df = df.dropna(subset=[target_col]).reset_index(drop=True)

        if feature_cols is None:
            feature_cols = DataLoader._auto_detect_numeric_cols(
                df, exclude=[target_col],
            )
        if category_cols is None:
            category_cols = DataLoader._auto_detect_category_cols(
                df, exclude=[target_col],
            )

        return LoadedDataset(
            df=df,
            target_col=target_col,
            feature_cols=feature_cols,
            category_cols=category_cols,
            metadata={"source": "dataframe"},
        )

    # ------------------------------------------------------------------
    # Synthetic data generation
    # ------------------------------------------------------------------

    @staticmethod
    def create_synthetic(
        formula_fn: Callable[..., float],
        n_samples: int = 1000,
        feature_ranges: Optional[Dict[str, Tuple[float, float]]] = None,
        noise_fn: Optional[Callable[[np.random.Generator], float]] = None,
        category_spec: Optional[Dict[str, List[Any]]] = None,
        seed: int = 42,
        target_col: str = "y",
    ) -> LoadedDataset:
        """Generate synthetic data from a known formula for testing.

        Parameters
        ----------
        formula_fn : callable
            ``f(**features) -> float``.  Keyword arguments match
            *feature_ranges* keys.
        n_samples : int
            Number of rows to generate.
        feature_ranges : dict
            ``{feature_name: (low, high)}``.  Defaults to ``{"x": (0, 100)}``.
        noise_fn : callable or None
            ``f(rng) -> float`` additive noise.  Defaults to no noise.
        category_spec : dict or None
            ``{col_name: [possible_values]}``.  Each row gets a random value.
        seed : int
            Random seed.
        target_col : str
            Name for the target column.

        Returns
        -------
        LoadedDataset
        """
        rng = np.random.default_rng(seed)

        if feature_ranges is None:
            feature_ranges = {"x": (0.0, 100.0)}

        data: Dict[str, np.ndarray] = {}
        for name, (lo, hi) in feature_ranges.items():
            data[name] = rng.uniform(lo, hi, size=n_samples)

        cat_cols: List[str] = []
        if category_spec:
            for col, vals in category_spec.items():
                data[col] = rng.choice(vals, size=n_samples)
                cat_cols.append(col)

        y_vals = np.empty(n_samples, dtype=np.float64)
        for i in range(n_samples):
            kwargs = {name: float(data[name][i]) for name in feature_ranges}
            if category_spec:
                for col in cat_cols:
                    kwargs[col] = data[col][i]
            try:
                y_vals[i] = formula_fn(**kwargs)
            except Exception:
                y_vals[i] = np.nan

        if noise_fn is not None:
            for i in range(n_samples):
                y_vals[i] += noise_fn(rng)

        data[target_col] = y_vals
        df = pd.DataFrame(data)

        feature_cols = list(feature_ranges.keys())

        return LoadedDataset(
            df=df,
            target_col=target_col,
            feature_cols=feature_cols,
            category_cols=cat_cols,
            metadata={
                "source": "synthetic",
                "n_samples": n_samples,
                "seed": seed,
            },
        )

    # ------------------------------------------------------------------
    # Auto-detection helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _auto_detect_numeric_cols(
        df: pd.DataFrame,
        exclude: Optional[List[str]] = None,
    ) -> List[str]:
        """Return numeric (int/float) columns, excluding *exclude*."""
        exclude_set = set(exclude or [])
        cols: List[str] = []
        for col in df.columns:
            if col in exclude_set:
                continue
            if pd.api.types.is_numeric_dtype(df[col]):
                cols.append(col)
        return cols

    @staticmethod
    def _auto_detect_category_cols(
        df: pd.DataFrame,
        exclude: Optional[List[str]] = None,
    ) -> List[str]:
        """Return categorical / low-cardinality integer columns."""
        exclude_set = set(exclude or [])
        cols: List[str] = []
        for col in df.columns:
            if col in exclude_set:
                continue
            dtype = df[col].dtype
            if pd.api.types.is_string_dtype(df[col]) and not pd.api.types.is_numeric_dtype(df[col]):
                cols.append(col)
            elif dtype.name == "category":
                cols.append(col)
            elif pd.api.types.is_bool_dtype(df[col]):
                cols.append(col)
            elif pd.api.types.is_integer_dtype(df[col]) and df[col].nunique() <= 30:
                cols.append(col)
        return cols
