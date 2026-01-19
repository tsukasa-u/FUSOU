
import pandas as pd
from collections import deque
from typing import List, Dict, Tuple, Optional
from .schema import Tables, Column

class JoinGraph:
    def __init__(self):
        # Adjacency: table -> list of (neighbor_table, my_col, neighbor_col)
        self.adj: Dict[str, List[Tuple[str, str, str]]] = {}

    def add(self, table1: str, col1: str, table2: str, col2: str) -> None:
        """
        Register a join condition between two tables (bi-directional).
        
        Args:
            table1: Name of the first table (e.g. Tables.Battle.TABLE)
            col1: Join column in first table (e.g. Tables.Battle.F_DECK_ID)
            table2: Name of the second table
            col2: Join column in second table
            
        Example:
            graph.add(Tables.Battle.TABLE, "f_deck_id", Tables.OwnDeck.TABLE, "uuid")
        """
        if table1 not in self.adj: self.adj[table1] = []
        if table2 not in self.adj: self.adj[table2] = []
        
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
                for neighbor, my_col, neighbor_col in self.adj[curr]:
                    if neighbor not in visited:
                        visited.add(neighbor)
                        new_path = path + [(curr, my_col, neighbor, neighbor_col)]
                        queue.append((neighbor, new_path))
        return None

# ... (Imports and JoinGraph as before) ...

# initialize Registry
REGISTRY = JoinGraph()

# Load Core Relationships
from .relationships import define_core_relationships
define_core_relationships(REGISTRY)

def register_relationship(table1: str, col1: str, table2: str, col2: str) -> None:
    """
    Register a relationship between two tables.
    Example:
        register_relationship(Tables.Battle.TABLE, Tables.Battle.F_DECK_ID, Tables.OwnDeck.TABLE, Tables.OwnDeck.UUID)
    """
    REGISTRY.add(table1, col1, table2, col2)


def query(
    columns: List[Column],
    period_tag: str = "latest"
) -> pd.DataFrame:
    """
    Query cached data with auto-join.
    
    This function only works with cached data. Use load() to download 
    and cache required tables before querying.
    
    Args:
        columns: List of Column objects (e.g. Tables.Battle.TIMESTAMP)
        period_tag: "latest", "all", or specific tag
        
    Returns:
        pd.DataFrame: Merged DataFrame with requested columns
        
    Raises:
        DatasetNotFoundError: If required tables are not cached
        
    Example:
        # Step 1: Load required tables
        fusou_datasets.load("battle")
        fusou_datasets.load("own_deck")
        
        # Step 2: Query
        from fusou_datasets import Tables, query
        result = query([Tables.Battle.TIMESTAMP, Tables.OwnDeck.UUID])
    """
    from . import _config, DatasetNotFoundError
    from pathlib import Path
    import pandas as pd

    if not columns:
        return pd.DataFrame()

    # Check cache configuration
    cache_dir = _config.get("cache_dir")
    if not cache_dir:
        raise DatasetNotFoundError(
            "❌ Query requires cache configuration\n\n"
            "To use query():\n"
            "  1. Configure cache: fusou_datasets.configure(cache_dir='~/.fusou_datasets/cache')\n"
            "  2. Load tables: fusou_datasets.load('table_name')\n"
            "  3. Then query: query([Tables.X.Y, ...])"
        )

    # 1. Identify required tables
    target_tables = set()
    col_map = {} 
    
    for col in columns:
        if not hasattr(col, "table"):
            raise ValueError(f"Column {col} is not a valid schema Column object. Use Tables.X.Y")
        t = col.table
        target_tables.add(t)
        if t not in col_map: col_map[t] = []
        col_map[t].append(col)

    target_tables_list = list(target_tables)
    if not target_tables_list:
        return pd.DataFrame()

    # 2. Find all required tables (including intermediate tables for joins)
    base_table = target_tables_list[0]
    all_required_tables = {base_table}
    
    targets = list(set(target_tables_list) - {base_table})
    edges_to_merge = []
    for t in targets:
        path = REGISTRY.find_path(base_table, t)
        if not path:
            raise ValueError(f"No relationship defined between {base_table} and {t}")
        for edge in path:
            # Add intermediate tables
            all_required_tables.add(edge[0])
            all_required_tables.add(edge[2])
            if edge not in edges_to_merge:
                rev = (edge[2], edge[3], edge[0], edge[1])
                if rev not in edges_to_merge:
                    edges_to_merge.append(edge)

    # 3. Check which tables are missing from cache
    missing_tables = []
    cached_data = {}
    cache_path = Path(cache_dir)
    
    for table in all_required_tables:
        data_file = cache_path / table / period_tag / "data.parquet"
        if data_file.exists():
            cached_data[table] = pd.read_parquet(data_file)
        else:
            missing_tables.append(table)
    
    if missing_tables:
        missing_list = "\n".join(f"  - fusou_datasets.load('{t}', period_tag='{period_tag}')" for t in sorted(missing_tables))
        raise DatasetNotFoundError(
            f"❌ Missing cached data for query\n\n"
            f"The following tables need to be loaded first:\n{missing_list}\n\n"
            "💡 After loading, run your query again."
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
                df2 = cached_data[t2]
                main_df = pd.merge(main_df, df2, left_on=c1, right_on=c2, how="inner", suffixes=("", f"_{t2}"))
                merged_tables.add(t2)
                progress = True
            elif t2 in merged_tables and t1 not in merged_tables:
                print(f"Joining {t1} on {c2}={c1}...")
                df1 = cached_data[t1]
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

    # 5. Select only the requested columns
    selected_cols = []
    for col in columns:
        # Column is a str subclass, so the value itself is the column name
        col_name = str(col)
        # Handle column name conflicts from joins (e.g. uuid_own_deck)
        if col_name in main_df.columns:
            selected_cols.append(col_name)
        elif f"{col_name}_{col.table}" in main_df.columns:
            selected_cols.append(f"{col_name}_{col.table}")
        else:
            # Try to find the column with any suffix
            for df_col in main_df.columns:
                if df_col.startswith(col_name):
                    selected_cols.append(df_col)
                    break
            else:
                raise ValueError(f"Column '{col_name}' not found in merged result")
    
    return main_df[selected_cols]

