"""
fusou_datasets._verification
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

VerificationDataset class providing clean separation between exploratory data (train)
and verification data (validation) for hypothesis testing.
Supports both project-wide verification and single-table fluent querying.
"""

from typing import Optional, Dict, Any, Union, List, Callable
import pandas as pd

from ._config import _config
from ._loader import load
from ._query_builder import DatasetQuery
from .schema import Column, TableInput, TableMeta, resolve_table_name


class VerificationDataset:
    """
    Structured dataset accessor for scientific verification programs.
    Guarantees strict separation between exploratory analysis (train split)
    and hypothesis testing (validation split) to prevent data leakage.
    
    Usage patterns:
    1. Single-table fluent mode:
       ds = fd.VerificationDataset("cells", split="validation")
       df = ds.filter(maparea_id=45).to_dataframe()
       
    2. Multi-table study mode:
       vd = fd.VerificationDataset()
       train_q = vd.explore("cells")
       val_q = vd.verify("cells")
    """
    
    def __init__(
        self,
        table_or_period_tag: Optional[str] = None,
        period_tag: Optional[str] = None,
        table_version: Optional[str] = None,
        scope: str = "all",
        split: str = "validation",
        offline: bool = False
    ):
        # Disambiguate if first argument is a table name or period_tag
        if table_or_period_tag and (
            hasattr(table_or_period_tag, "TABLE")
            or (
                isinstance(table_or_period_tag, str)
                and not table_or_period_tag.startswith("20") 
                and table_or_period_tag not in ("latest", "all")
            )
        ):
            self.table: Optional[str] = resolve_table_name(table_or_period_tag)
            self.period_tag = period_tag or _config.get("period_tag", "latest")
        else:
            self.table = None
            self.period_tag = table_or_period_tag or period_tag or _config.get("period_tag", "latest")
            
        self.table_version = table_version or _config.get("table_version")
        self.scope = scope
        self.split = split
        self.offline = offline
        self._cached_dfs: Dict[str, pd.DataFrame] = {}
        self._delegate_query: Optional[DatasetQuery] = None

    def _get_query(self) -> DatasetQuery:
        if self._delegate_query is None:
            if not self.table:
                raise ValueError(
                    "No table specified for direct query operations.\n"
                    "Specify table in constructor (VerificationDataset('cells')) or use explore('cells') / verify('cells')."
                )
            key = f"{self.table}:{self.split}"
            if key not in self._cached_dfs:
                df = load(
                    table=self.table,
                    period_tag=self.period_tag,
                    table_version=self.table_version,
                    scope=self.scope,
                    split=self.split,
                    offline=self.offline
                )
                self._cached_dfs[key] = df
            self._delegate_query = DatasetQuery(self._cached_dfs[key])
        return self._delegate_query

    # Delegate fluent methods to DatasetQuery when single-table mode is used
    def filter(self, *predicates: Callable[[pd.DataFrame], pd.Series], **kwargs) -> DatasetQuery:
        return self._get_query().filter(*predicates, **kwargs)

    def select(self, *columns: Union[str, Column]) -> DatasetQuery:
        return self._get_query().select(*columns)

    def sort_by(self, *columns: Union[str, Column], ascending: bool = True) -> DatasetQuery:
        return self._get_query().sort_by(*columns, ascending=ascending)

    def limit(self, n: int) -> DatasetQuery:
        return self._get_query().limit(n)

    def to_dataframe(self) -> pd.DataFrame:
        return self._get_query().to_dataframe()

    def to_pandas(self) -> pd.DataFrame:
        return self._get_query().to_pandas()

    def to_arrow(self):
        return self._get_query().to_arrow()

    def explore(self, table: Optional[str] = None) -> DatasetQuery:
        """
        Load exploratory data (split='train', 70% of dataset).
        Use this for finding patterns, fitting distributions, and forming hypotheses.
        """
        t = table or self.table
        if not t:
            raise ValueError("Table name required for explore()")
        key = f"{t}:train"
        if key not in self._cached_dfs:
            df = load(
                table=t,
                period_tag=self.period_tag,
                table_version=self.table_version,
                scope=self.scope,
                split="train",
                offline=self.offline
            )
            self._cached_dfs[key] = df
        return DatasetQuery(self._cached_dfs[key])

    def verify(self, table: Optional[str] = None) -> DatasetQuery:
        """
        Load verification data (split='validation', 20% of dataset).
        Use this strictly for hypothesis confirmation and test evaluation.
        Access to this split is logged for reproducibility audits.
        """
        t = table or self.table
        if not t:
            raise ValueError("Table name required for verify()")
        key = f"{t}:validation"
        if key not in self._cached_dfs:
            df = load(
                table=t,
                period_tag=self.period_tag,
                table_version=self.table_version,
                scope=self.scope,
                split="validation",
                offline=self.offline
            )
            self._cached_dfs[key] = df
        return DatasetQuery(self._cached_dfs[key])

    @property
    def snapshot_info(self) -> Dict[str, Any]:
        """Metadata capturing the exact data snapshot for reproducibility."""
        return {
            "period_tag": self.period_tag,
            "table_version": self.table_version or "latest",
            "scope": self.scope,
            "split": self.split,
            "offline": self.offline,
        }
