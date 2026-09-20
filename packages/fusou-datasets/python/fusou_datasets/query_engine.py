"""
fusou_datasets.query_engine
~~~~~~~~~~~~~~~~~~~~~~~~~~~

Query engine for fusou-datasets. Provides automatic table joins using 
a graph-based schema relationship registry.
"""

from typing import Dict, List, Tuple, Optional, Set
from collections import deque
from pathlib import Path
import numpy as np
import pandas as pd

from .schema import Column


class JoinGraph:
    """Graph of table relationships for automatic join path resolution."""
    
    def __init__(self):
        # Adjacency: table -> list of (neighbor_table, my_col, neighbor_col)
        self.adj: Dict[str, List[Tuple[str, str, str]]] = {}

    def add(self, table1: str, col1: str, table2: str, col2: str) -> None:
        """
        Register a join condition between two tables (bi-directional).
        
        Args:
            table1: Name of the first table (e.g. Tables.Battle.TABLE)
            col1: Join column in first table
            table2: Name of the second table
            col2: Join column in second table
        """
        if table1 not in self.adj:
            self.adj[table1] = []
        if table2 not in self.adj:
            self.adj[table2] = []
        
        # Add bi-directional edge
        self.adj[table1].append((table2, col1, col2))
        self.adj[table2].append((table1, col2, col1))

    def find_path(self, start_table: str, end_table: str) -> Optional[List[Tuple[str, str, str, str]]]:
        """BFS to find shortest path between tables."""
        if start_table == end_table:
            return []
        
        queue = deque([(start_table, [])])
        visited = {start_table}
        
        while queue:
            curr, path = queue.popleft()
            if curr == end_table:
                return path
            
            if curr in self.adj:
                # Sort neighbors for deterministic path finding
                for neighbor, my_col, neighbor_col in sorted(self.adj[curr], key=lambda x: x[0]):
                    if neighbor not in visited:
                        visited.add(neighbor)
                        new_path = path + [(curr, my_col, neighbor, neighbor_col)]
                        queue.append((neighbor, new_path))
        return None


# Initialize Registry
REGISTRY = JoinGraph()

# Load Core Relationships
from .relationships import define_core_relationships
define_core_relationships(REGISTRY)


def register_relationship(table1: str, col1: str, table2: str, col2: str) -> None:
    """Register a relationship between two tables."""
    REGISTRY.add(table1, col1, table2, col2)


def _resolve_cached_file(
    cache_path: Path, 
    table: str, 
    period_tag: str, 
    table_version: Optional[str] = None,
    split: str = "train"
) -> Optional[Path]:
    """
    Resolve cached parquet file path handling split partitioning, table_version nesting, and legacy structures.
    """
    candidate_splits = [split] if split else ["train", "validation"]
    
    # 1. If explicit table_version is provided
    if table_version:
        for s in candidate_splits:
            p = cache_path / table / table_version / period_tag / s / "data.parquet"
            if p.exists():
                return p
        flat = cache_path / table / table_version / period_tag / "data.parquet"
        if flat.exists():
            return flat

    # 2. Search in table directory for any version subdirectory (sorted newest/descending)
    table_dir = cache_path / table
    if table_dir.exists():
        version_dirs = [d for d in table_dir.iterdir() if d.is_dir()]
        for v_dir in sorted(version_dirs, key=lambda x: x.name, reverse=True):
            for s in candidate_splits:
                p = v_dir / period_tag / s / "data.parquet"
                if p.exists():
                    return p
            p_flat = v_dir / period_tag / "data.parquet"
            if p_flat.exists():
                return p_flat

    # 3. Check legacy flat path: cache_path / table / period_tag / [split] / data.parquet
    for s in candidate_splits:
        p = cache_path / table / period_tag / s / "data.parquet"
        if p.exists():
            return p
    legacy = cache_path / table / period_tag / "data.parquet"
    if legacy.exists():
        return legacy

    return None


def _prepare_for_merge(df: pd.DataFrame, join_col: str) -> pd.DataFrame:
    """
    If join_col contains lists or arrays, explode the column so pandas merge can operate on individual items.
    """
    if join_col in df.columns:
        sample = df[join_col].dropna()
        if len(sample) > 0 and isinstance(sample.iloc[0], (list, tuple, np.ndarray)):
            return df.explode(join_col)
    return df


def query(
    columns: List[Column],
    period_tag: Optional[str] = None,
    table_version: Optional[str] = None,
    split: str = "train"
) -> pd.DataFrame:
    """
    Query cached data with auto-join.
    
    This function only works with cached data. Use load() to download 
    and cache required tables before querying.
    
    Args:
        columns: List of Column objects (e.g. Tables.Battle.TIMESTAMP)
        period_tag: "latest", "all", or specific tag
        table_version: Optional table version constraint (e.g. "0.6.0")
        
    Returns:
        pd.DataFrame: Merged DataFrame with requested columns
        
    Raises:
        DatasetNotFoundError: If required tables are not cached
    """
    from . import _config, DatasetNotFoundError

    if not columns:
        return pd.DataFrame()

    # Defaults from global config
    period_tag = period_tag or _config.get("period_tag", "latest")
    table_version = table_version or _config.get("table_version")

    # Check cache configuration
    cache_dir = _config.get("cache_dir")
    if not cache_dir:
        raise DatasetNotFoundError(
            "[!] Query requires cache configuration\n\n"
            "To use query():\n"
            "  1. Configure cache: fusou_datasets.configure(cache_dir='./data/cache')\n"
            "  2. Load tables: fusou_datasets.load('table_name', split='train')\n"
            "  3. Then query: query([Tables.X.Y, ...], split='train')"
        )

    # 1. Identify required tables and validate columns
    target_tables: Set[str] = set()
    col_map: Dict[str, List[Column]] = {} 
    
    for col in columns:
        if not hasattr(col, "table"):
            raise ValueError(f"Column {col} is not a valid schema Column object. Use Tables.X.Y")
        t = col.table
        target_tables.add(t)
        if t not in col_map:
            col_map[t] = []
        col_map[t].append(col)

    # Sort target tables for deterministic base table selection (reproducibility)
    target_tables_list = sorted(list(target_tables))
    if not target_tables_list:
        return pd.DataFrame()

    # 2. Find all required tables (including intermediate tables for joins)
    base_table = target_tables_list[0]
    all_required_tables = {base_table}
    
    targets = sorted(list(set(target_tables_list) - {base_table}))
    edges_to_merge = []
    for t in targets:
        path = REGISTRY.find_path(base_table, t)
        if not path:
            raise ValueError(f"No relationship defined between {base_table} and {t}")
        for edge in path:
            all_required_tables.add(edge[0])
            all_required_tables.add(edge[2])
            if edge not in edges_to_merge:
                rev = (edge[2], edge[3], edge[0], edge[1])
                if rev not in edges_to_merge:
                    edges_to_merge.append(edge)

    # 3. Check which tables are missing from cache
    missing_tables = []
    cached_data: Dict[str, pd.DataFrame] = {}
    cache_path = Path(cache_dir)
    
    for table in sorted(list(all_required_tables)):
        data_file = _resolve_cached_file(cache_path, table, period_tag, table_version)
        if data_file is not None and data_file.exists():
            cached_data[table] = pd.read_parquet(data_file)
        else:
            missing_tables.append(table)
    
    if missing_tables:
        missing_list = "\n".join(f"  - fusou_datasets.load('{t}', period_tag='{period_tag}')" for t in sorted(missing_tables))
        raise DatasetNotFoundError(
            f"? Missing cached data for query\n\n"
            f"The following tables need to be loaded first:\n{missing_list}\n\n"
            "?? After loading, run your query again."
        )

    # 4. Execute joins using cached data
    print(f"Querying from cache: {base_table}")
    main_df = cached_data[base_table]
    merged_tables = {base_table}
    
    while len(merged_tables) < len(all_required_tables) or edges_to_merge:
        progress = False
        remaining_edges = []
        for (t1, c1, t2, c2) in edges_to_merge:
            if t1 in merged_tables and t2 not in merged_tables:
                print(f"Joining {t2} on {c1}={c2}...")
                main_df = _prepare_for_merge(main_df, c1)
                df2 = _prepare_for_merge(cached_data[t2], c2)
                main_df = pd.merge(main_df, df2, left_on=c1, right_on=c2, how="inner", suffixes=("", f"_{t2}"))
                merged_tables.add(t2)
                progress = True
            elif t2 in merged_tables and t1 not in merged_tables:
                print(f"Joining {t1} on {c2}={c1}...")
                main_df = _prepare_for_merge(main_df, c2)
                df1 = _prepare_for_merge(cached_data[t1], c1)
                main_df = pd.merge(main_df, df1, left_on=c2, right_on=c1, how="inner", suffixes=("", f"_{t1}"))
                merged_tables.add(t1)
                progress = True
            elif t1 in merged_tables and t2 in merged_tables:
                pass
            else:
                remaining_edges.append((t1, c1, t2, c2))
        
        edges_to_merge = remaining_edges
        if not progress and edges_to_merge:
            break
        if not edges_to_merge:
            break

    # 5. Select only the requested columns with table-aware qualification
    selected_cols = []
    for col in columns:
        col_name = str(col)
        table_name = col.table
        
        # Priority 1: Exact match with table suffix (e.g., uuid_own_deck)
        suffixed = f"{col_name}_{table_name}"
        if suffixed in main_df.columns:
            selected_cols.append(suffixed)
        # Priority 2: Base column name if it belongs to base table or is unique
        elif col_name in main_df.columns:
            selected_cols.append(col_name)
        else:
            # Priority 3: Prefix matching fallback
            for df_col in main_df.columns:
                if df_col.startswith(col_name):
                    selected_cols.append(df_col)
                    break
            else:
                raise ValueError(f"Column '{col_name}' for table '{table_name}' not found in merged result")
    
    return main_df[selected_cols]