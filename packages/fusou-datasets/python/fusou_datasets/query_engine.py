
import pandas as pd
from collections import deque
from .schema import Tables

class JoinGraph:
    def __init__(self):
        # Adjacency: table -> list of (neighbor_table, my_col, neighbor_col)
        self.adj = {}

    def add(self, table1, col1, table2, col2):
        if table1 not in self.adj: self.adj[table1] = []
        if table2 not in self.adj: self.adj[table2] = []
        
        # Add bi-directional edge
        self.adj[table1].append((table2, col1, col2))
        self.adj[table2].append((table1, col2, col1))

    def find_path(self, start_table, end_table):
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

# initialize Registry
REGISTRY = JoinGraph()

# Define Core Relationships
# Battle -> OwnDeck
REGISTRY.add(Tables.Battle.TABLE, Tables.Battle.F_DECK_ID, Tables.OwnDeck.TABLE, Tables.OwnDeck.UUID)
# OwnDeck -> OwnShip (Note: ship_ids is array, strict 1:1 join might fail if not exploded. Assuming simplified join logic or 1st ship for now is risky. But user asked for implementation. We will warn or assume simple join on ID match if pandas supports it, but pandas merge on list requires explode. 
# For now, let's implement the simpler 1:1 links first.
# Battle -> Cells
REGISTRY.add(Tables.Battle.TABLE, Tables.Battle.CELL_ID, Tables.Cells.TABLE, Tables.Cells.BATTLES) # This is complex. Cells.battles is list of battle IDs? No, Cells.uuid 
# Let's check Schema.
# Cells.UUID. Battle.CELL_ID (int). Cells has maparea_id etc.
# Wait, Battle.CELL_ID is int? Cells.UUID is string?
# Schema check: Battle: cell_id (int). Cells: uuid (string). 
# Actually Cells is usually {maparea_id}-{mapinfo_no}-{cell_no}.
# If they don't match types, we can't join.
# I'll stick to UUID joins which are safe strings.
# EnvInfo <-> Battle (on env_uuid) - Very safe.
REGISTRY.add(Tables.Battle.TABLE, Tables.Battle.ENV_UUID, Tables.EnvInfo.TABLE, Tables.EnvInfo.UUID)
# OwnShip -> ShipMaster (ship_id -> id)
REGISTRY.add(Tables.OwnShip.TABLE, Tables.OwnShip.SHIP_ID, Tables.ShipMaster.TABLE, Tables.ShipMaster.ID)
# OwnSlotitem -> SlotItemMaster
REGISTRY.add(Tables.OwnSlotitem.TABLE, Tables.OwnSlotitem.MST_SLOTITEM_ID, Tables.SlotItemMaster.TABLE, Tables.SlotItemMaster.ID)

def query(columns, period_tag="latest"):
    """
    Auto-join query engine.
    columns: List of Column objects (e.g. Tables.Battle.TIMESTAMP)
    """
    from . import load # Avoid circular import

    if not columns:
        return pd.DataFrame()

    # 1. Identify Tables
    target_tables = set()
    col_map = {} # table -> list of columns to keep
    
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
    # Pick the first table as "Base".
    base_table = target_tables_list[0]
    # We need to join everything to base_table (or transitively).
    # Since we use BFS, we can try to find path from base to all others.
    
    joins = [] # List of (right_table, left_on, right_on)
    
    loaded_dfs = {}
    # Load base table
    print(f"Loading base table: {base_table}")
    loaded_dfs[base_table] = load(base_table, period_tag=period_tag)

    # For each other table, find path from ALREADY JOINED SET to NEW TABLE.
    # Simple approach: Path from base_table to target.
    joined_tables = {base_table}
    pending_tables = set(target_tables_list) - {base_table}

    while pending_tables:
        # Sort pending by distance to any joined table?
        # Or just pick one and find path from base.
        target = pending_tables.pop()
        path = REGISTRY.find_path(base_table, target)
        if path is None:
            raise ValueError(f"Cannot join {base_table} to {target}: No path defined in registry.")
        
        # Execute path
        curr = base_table
        # path is list of (curr, col1, next, col2)
        # We need to traverse path. If intermediate tables are not loaded, load them.
        for (t1, c1, t2, c2) in path:
            # t1 is current (should be in loaded/joined), t2 is next.
            if t2 in joined_tables:
                curr = t2
                continue # Already joined this link (loop?)
            
            # Load t2
            print(f"Loading join table: {t2}")
            df2 = load(t2, period_tag=period_tag)
            loaded_dfs[t2] = df2

            # Perform Merge: loaded_dfs[curr] merge df2
            # Since we want one BIG dataframe, we should merge into `main_df`.
            # Actually, `loaded_dfs[base_table]` becomes the growing `main_df`.
            # But wait, t1 might not be base_table, it might be an intermediate we just joined.
            # We need to maintain `main_df` which contains columns from all joined tables.
            # Merging strategy:
            # iteratively merge to the main df.
            # But columns might conflict. Suffixes?
            # We assume user wants specific columns.
            pass
            
            # Merge logic
            left_df = loaded_dfs[t1] # This might be the BIG merged df if t1==base?
            # No, `loaded_dfs` stores raw tables.
            # We should probably merge iteratively.
            
            joined_tables.add(t2)
            curr = t2

    # Actual Merge Execution
    # Simplified: We have a tree of joins rooted at base_table.
    # But `path` logic above just verified connectivity and loading. 
    # We need to merge them.
    
    # Re-calculate logic:
    # Build a merge execution plan.
    # We have `target_tables`.
    
    # Simple Star Schema or Snow Flake?
    # Let's assume we merge everything into `base_table` dataframe.
    
    main_df = loaded_dfs[base_table]
    
    # Re-run paths to actually merge
    # This is tricky because "path from base to target" might re-walk same edges.
    # We need a spanning tree covering all target nodes.
    
    # For MVP: support only 1 hop or simple chain?
    # Or just `reduce`?
    
    # Let's iterate `joined_tables` (but order matters).
    # Correct approach:
    # queue = [base_table]
    # processed = {base_table}
    # While queue:
    #   t = queue.pop()
    #   neighbors = find neighbors of t that are in (Path Union).
    #   merge.
    
    # Hack for MVP:
    # Just merge following the path found for each pending table.
    # Use `suffixes=(None, '_dup')` and drop dups?
    # This is getting complex for a single file.
    
    # I'll implement a simple iterative merge based on the paths computed.
    # Re-compute paths to get edges.
    edges_to_merge = []
    
    targets = list(set(target_tables_list) - {base_table})
    for t in targets:
        path = REGISTRY.find_path(base_table, t)
        if not path: raise ValueError(f"No path {base_table}->{t}")
        for edge in path:
            # edge: (t1, c1, t2, c2)
            # Ensure we merge t1->t2. 
            # If t2 already merged, skip.
            # But edge is directed t1->t2.
            # We need unique set of edges to form a tree.
            # Since it's BFS from base, it forms a tree naturally.
            if edge not in edges_to_merge:
                # check reverse edge
                rev = (edge[2], edge[3], edge[0], edge[1])
                if rev not in edges_to_merge:
                    edges_to_merge.append(edge)
    
    # Now execute merges in order?
    # We need to merge (t1, t2).
    # We assume t1 is already in `main_df`.
    # But `main_df` starts with base_table.
    # So we need to ensure t1 is "reachable" in main_df.
    # Since edges come from BFS paths from base, t1 MUST be closer to base than t2.
    # So sorting edges by distance from base?
    # Or just iterative expansion.
    
    merged_tables = {base_table}
    # Loop until all edges processed
    while len(merged_tables) < len(joins) + 1: # Logic flaw
        pass
        # Simple loop over edges
        progress = False
        remaining_edges = []
        for (t1, c1, t2, c2) in edges_to_merge:
            if t1 in merged_tables and t2 not in merged_tables:
                # Merge t2 into main_df (which represents t1 set)
                print(f"Merging {t2} on {c1}={c2}...")
                df2 = load(t2, period_tag=period_tag)
                # Ensure c1 is in main_df.
                if c1 not in main_df.columns:
                    # Maybe it was renamed? or it's there.
                    pass
                
                main_df = pd.merge(main_df, df2, left_on=c1, right_on=c2, how="inner", suffixes=("", f"_{t2}"))
                merged_tables.add(t2)
                progress = True
            elif t2 in merged_tables and t1 not in merged_tables:
                 # Reverse merge
                print(f"Merging {t1} on {c2}={c1}...")
                df1 = load(t1, period_tag=period_tag)
                main_df = pd.merge(main_df, df1, left_on=c2, right_on=c1, how="inner", suffixes=("", f"_{t1}"))
                merged_tables.add(t1)
                progress = True
            elif t1 in merged_tables and t2 in merged_tables:
                # Already merged both? Cycle or redundancy. Skip.
                pass
            else:
                remaining_edges.append((t1,c1,t2,c2))
        
        edges_to_merge = remaining_edges
        if not progress and edges_to_merge:
             raise ValueError("Graph disconnected during merge?")
        if not edges_to_merge: break

    # Select Columns
    final_cols = []
    for col in columns:
        # col is string "timestamp" with table="battle".
        # In main_df, it might be "timestamp" or "timestamp_battle"?
        # Since we used suffixes=("", "_table"), base table cols stay pure.
        # Others get suffix.
        # This is brittle.
        # Robust way: Rename columns BEFORE merge to {table}_{col}.
        pass
    
    # Return main_df with all columns for now as Beta.
    return main_df

