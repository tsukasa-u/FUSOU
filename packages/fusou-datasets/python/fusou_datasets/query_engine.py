
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


def query(columns: List[Column], period_tag: str = "latest") -> pd.DataFrame:
    """
    Auto-join query engine.
    columns: List of Column objects (e.g. Tables.Battle.TIMESTAMP)
    """
    from . import load # Avoid circular import

    if not columns:
        return pd.DataFrame()

    # 1. Identify Tables
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

    # 2. Find Spanning Strategy
    base_table = target_tables_list[0]
    print(f"Loading base table: {base_table}")
    
    main_df = load(base_table, period_tag=period_tag)
    
    merged_tables = {base_table}
    
    # 3. Calculate Edges needed
    edges_to_merge = []
    targets = list(set(target_tables_list) - {base_table})
    for t in targets:
        path = REGISTRY.find_path(base_table, t)
        if not path: raise ValueError(f"No path defined between {base_table} and {t}")
        for edge in path:
            if edge not in edges_to_merge:
                # check reverse
                rev = (edge[2], edge[3], edge[0], edge[1])
                if rev not in edges_to_merge:
                    edges_to_merge.append(edge)
    
    # 4. Execute Merge
    # Iterative expansion
    while len(merged_tables) < len(target_tables) or edges_to_merge:
        progress = False
        remaining_edges = []
        for (t1, c1, t2, c2) in edges_to_merge:
            if t1 in merged_tables and t2 not in merged_tables:
                print(f"Merging {t2} on {c1}={c2}...")
                df2 = load(t2, period_tag=period_tag)
                # Ensure join key exists
                if c1 not in main_df.columns:
                     # Attempt to find suffixed column?
                     # For now assume base table cols are pure, others suffixed.
                     pass 
                
                main_df = pd.merge(main_df, df2, left_on=c1, right_on=c2, how="inner", suffixes=("", f"_{t2}"))
                merged_tables.add(t2)
                progress = True
            elif t2 in merged_tables and t1 not in merged_tables:
                print(f"Merging {t1} on {c2}={c1}...")
                df1 = load(t1, period_tag=period_tag)
                main_df = pd.merge(main_df, df1, left_on=c2, right_on=c1, how="inner", suffixes=("", f"_{t1}"))
                merged_tables.add(t1)
                progress = True
            elif t1 in merged_tables and t2 in merged_tables:
                # Already merged
                pass
            else:
                remaining_edges.append((t1,c1,t2,c2))
        
        edges_to_merge = remaining_edges
        if not progress and edges_to_merge:
             # If we still have edges but made no progress, we might be stuck or disjoint?
             # But find_path verified connectivity.
             break 
        if not edges_to_merge: break

    return main_df

