"""
Data Loader -- FUSOU database integration helper.

============================================================
Data Flow (v0.5 schema)
============================================================
hougeki -> individual shelling attacks with damage[], attacker/defender
indices, hit type (cl[]), and attack type (at_type).

Key schema facts (from actual Avro inspection):
    - hougeki.damage : array<int>     -- variable-length (1 hit per element)
    - hougeki.df     : array<int>     -- defender indices, matches damage
    - hougeki.cl     : array<int>     -- hit types, matches damage
    - hougeki.si     : array<int|null> -- used equipment IDs, variable-length
    - own_ship.karyoku : array<int>   -- [current, max], take [0] for value
    - own_ship.soukou  : array<int>   -- [current, max], take [0] for value
    - enemy_ship.karyoku : int        -- scalar (not array)
    - enemy_ship.soukou  : int        -- scalar (not array)

Variables Produced
-------------------
    attacker_karyoku (int) : attacker firepower (current value)
    attacker_raisou  (int) : attacker torpedo
    attacker_taiku   (int) : attacker anti-air
    attacker_lv      (int) : attacker level
    defender_soukou  (int) : defender armor
    defender_nowhp   (int) : defender HP at time of attack
    defender_maxhp   (int) : defender max HP
    damage           (int) : damage dealt (single hit, flattened)
    cl               (int) : 0=miss, 1=hit, 2=critical
    at_type          (int) : attack type code
    at_eflag         (int) : 0=friend->enemy, 1=enemy->friend
    hit_index        (int) : index within the multi-hit attack (0-based)
    n_hits           (int) : total number of hits in this attack action
    si               (list): equipment IDs used in this attack (variable-length)
"""

from __future__ import annotations

import sys
import warnings
from typing import Any, List, Optional, Union

import numpy as np
import pandas as pd


# ─── Utility: extract scalar from potentially-array stat ────────
def _extract_stat_value(val: Any) -> Optional[int]:
    """Extract the *current* stat value from an Avro field.

    own_ship stats are stored as ``[current, max]`` arrays.
    enemy_ship stats are plain ``int``.

    Args:
        val: Field value -- may be int, list, ndarray, or None.

    Returns:
        Integer stat value, or None if unavailable.
    """
    if val is None:
        return None
    if isinstance(val, (list, np.ndarray)):
        return int(val[0]) if len(val) > 0 else None
    return int(val)


# ─── Utility: flatten variable-length hougeki arrays ────────────
def flatten_hougeki(hougeki_df: pd.DataFrame) -> pd.DataFrame:
    """Expand multi-hit attacks into one row per hit.

    A single ``hougeki`` row represents one attack action, which may
    contain multiple hits (e.g. double attack = 2 hits, cut-in = 2-3).
    ``damage``, ``df``, ``cl``, ``protect_flag`` are parallel arrays
    of the same length.

    Args:
        hougeki_df: Raw hougeki DataFrame with array columns.

    Returns:
        Flattened DataFrame with one row per individual hit, plus:
            ``hit_index`` -- 0-based index within the attack
            ``n_hits``    -- total hits in the source attack action
    """
    rows: list[dict] = []

    for _, h in hougeki_df.iterrows():
        damages = h.get("damage")
        if damages is None:
            continue

        # Ensure list
        if not isinstance(damages, (list, np.ndarray)):
            damages = [damages]

        cls = h.get("cl")
        if not isinstance(cls, (list, np.ndarray)):
            cls = [cls] if cls is not None else [None] * len(damages)

        dfs = h.get("df")
        if not isinstance(dfs, (list, np.ndarray)):
            dfs = [dfs] if dfs is not None else [None] * len(damages)

        protect = h.get("protect_flag")
        if not isinstance(protect, (list, np.ndarray)):
            protect = [protect] if protect is not None else [None] * len(damages)

        si = h.get("si")
        if not isinstance(si, (list, np.ndarray)):
            si = [si] if si is not None else []
            
        f_hps = h.get("f_now_hps")
        e_hps = h.get("e_now_hps")

        n_hits = len(damages)

        for i, dmg in enumerate(damages):
            df_idx = dfs[i] if i < len(dfs) else None
            at_idx = h.get("at")
            at_eflag = h.get("at_eflag")
            
            # Dynamic HP extraction at the time of the action
            atk_hp, def_hp = None, None
            if f_hps is not None and e_hps is not None and df_idx is not None and at_idx is not None:
                if at_eflag == 0:  # friend -> enemy
                    atk_hp = f_hps[at_idx] if at_idx < len(f_hps) else None
                    def_hp = e_hps[df_idx] if df_idx < len(e_hps) else None
                else:  # enemy -> friend
                    atk_hp = e_hps[at_idx] if at_idx < len(e_hps) else None
                    def_hp = f_hps[df_idx] if df_idx < len(f_hps) else None

            rows.append({
                "env_uuid": h.get("env_uuid"),
                "battle_uuid": h.get("uuid"),
                "index_1": h.get("index_1"),
                "index_2": h.get("index_2"),
                "at_eflag": at_eflag,
                "at_type": h.get("at_type"),
                "at_index": at_idx,
                "df_index": df_idx,
                "damage": dmg,
                "cl": cls[i] if i < len(cls) else None,
                "protect_flag": protect[i] if i < len(protect) else None,
                "hit_index": i,
                "n_hits": n_hits,
                "si": list(si),  # keep full equipment list per hit
                "dynamic_attacker_nowhp": atk_hp,
                "dynamic_defender_nowhp": def_hp,
            })

    return pd.DataFrame(rows)


# ─── Build ship stat lookup ────────────────────────────────────
def _build_ship_lookup(
    ship_df: pd.DataFrame,
    stat_cols: List[str],
    is_own: bool,
) -> dict:
    """Build a (env_uuid, index) -> {stat: value} lookup dict.

    Handles the difference between own_ship (array stats) and
    enemy_ship (scalar stats).

    Args:
        ship_df: own_ship or enemy_ship DataFrame.
        stat_cols: Columns to extract (e.g. ["karyoku", "soukou"]).
        is_own: True for own_ship (array stats), False for enemy_ship.

    Returns:
        Dict mapping (env_uuid, index) -> {stat_name: int_value, ...}
    """
    lookup = {}
    extra_cols = ["lv", "nowhp", "maxhp"]

    for _, row in ship_df.iterrows():
        key = (row.get("env_uuid"), row.get("index"))
        entry = {}
        for col in stat_cols:
            raw = row.get(col)
            if is_own:
                entry[col] = _extract_stat_value(raw)
            else:
                entry[col] = int(raw) if raw is not None else None
        for col in extra_cols:
            val = row.get(col)
            entry[col] = int(val) if val is not None else None
        lookup[key] = entry

    return lookup


# ─── Main loader ────────────────────────────────────────────────
def _try_import_fusou():
    """Try to import fusou_datasets from the local package."""
    try:
        import fusou_datasets
        return fusou_datasets
    except ImportError:
        return None


def load_shelling_data(
    period_tag: str = "latest",
    table_version: str = "0.5",
    side: str = "friend",
    hit_types: Optional[list] = None,
    cache_dir: Optional[str] = None,
) -> pd.DataFrame:
    """Load and join shelling attack data from FUSOU database.

    Joins hougeki with own_ship / enemy_ship to produce an
    analysis-ready DataFrame with one row per individual hit.

    Variable-length handling:
        - hougeki.damage/cl/df arrays are flattened to one row per hit
        - own_ship stats like karyoku=[cur, max] are unpacked to cur value
        - hougeki.si (equipment list) is preserved as a list column

    Args:
        period_tag: Data period to load.
        table_version: Database schema version (e.g. "0.5").
        side: 'friend' (own->enemy), 'enemy' (enemy->own), or 'both'.
        hit_types: Filter by cl values (e.g. [1, 2] for hit+crit).
        cache_dir: Cache directory for fusou_datasets.

    Returns:
        DataFrame with columns including:
            attacker_karyoku, attacker_raisou, attacker_taiku,
            attacker_lv, defender_soukou, defender_nowhp,
            defender_maxhp, damage, cl, at_type, at_eflag,
            hit_index, n_hits, si
    """
    fd = _try_import_fusou()
    if fd is None:
        raise ImportError(
            "fusou_datasets is not installed.  Install from local:\n"
            "  pip install -e ../python"
        )

    if cache_dir:
        fd.configure(cache_dir=cache_dir)

    # Load tables
    print("Loading hougeki ...", file=sys.stderr)
    hougeki_df = fd.load("hougeki", period_tag=period_tag, table_version=table_version)

    print("Loading own_ship ...", file=sys.stderr)
    own_ship_df = fd.load("own_ship", period_tag=period_tag, table_version=table_version)

    print("Loading enemy_ship ...", file=sys.stderr)
    enemy_ship_df = fd.load("enemy_ship", period_tag=period_tag, table_version=table_version)

    # Flatten variable-length hougeki arrays
    print("Flattening variable-length attack arrays ...", file=sys.stderr)
    attack_df = flatten_hougeki(hougeki_df)

    if attack_df.empty:
        warnings.warn("No attack data after flattening hougeki.", RuntimeWarning)
        return attack_df

    # Build stat lookups (own_ship has array stats, enemy_ship has scalar)
    stat_cols = ["karyoku", "raisou", "taiku", "soukou"]
    own_lookup = _build_ship_lookup(own_ship_df, stat_cols, is_own=True)
    enemy_lookup = _build_ship_lookup(enemy_ship_df, stat_cols, is_own=False)

    # Join attacker/defender stats
    def _join_stats(row):
        env = row["env_uuid"]
        at_ef = row["at_eflag"]
        at_idx = row["at_index"]
        df_idx = row["df_index"]

        if at_ef == 0:  # friend -> enemy
            atk = own_lookup.get((env, at_idx), {})
            dfn = enemy_lookup.get((env, df_idx), {})
        else:  # enemy -> friend
            atk = enemy_lookup.get((env, at_idx), {})
            dfn = own_lookup.get((env, df_idx), {})

        # Use dynamic HP from battle action if available, else fallback to battle start HP
        dyn_atk_hp = row.get("dynamic_attacker_nowhp")
        dyn_def_hp = row.get("dynamic_defender_nowhp")
        
        return pd.Series({
            "attacker_karyoku": atk.get("karyoku"),
            "attacker_raisou": atk.get("raisou"),
            "attacker_taiku": atk.get("taiku"),
            "attacker_lv": atk.get("lv"),
            "attacker_nowhp": dyn_atk_hp if pd.notnull(dyn_atk_hp) else atk.get("nowhp"),
            "defender_soukou": dfn.get("soukou"),
            "defender_nowhp": dyn_def_hp if pd.notnull(dyn_def_hp) else dfn.get("nowhp"),
            "defender_maxhp": dfn.get("maxhp"),
        })

    stats_df = attack_df.apply(_join_stats, axis=1)
    result = pd.concat([attack_df, stats_df], axis=1)

    # Filter by side
    if side == "friend":
        result = result[result["at_eflag"] == 0]
    elif side == "enemy":
        result = result[result["at_eflag"] == 1]

    if hit_types is not None:
        result = result[result["cl"].isin(hit_types)]

    # Drop rows with missing essential stats
    result = result.dropna(subset=["attacker_karyoku", "defender_soukou", "damage"])

    # Ensure numeric
    numeric_cols = [
        "attacker_karyoku", "attacker_raisou", "attacker_taiku",
        "attacker_lv", "defender_soukou", "defender_nowhp",
        "defender_maxhp", "damage", "cl", "at_type", "at_eflag",
        "hit_index", "n_hits",
    ]
    for col in numeric_cols:
        if col in result.columns:
            result[col] = pd.to_numeric(result[col], errors="coerce")

    result = result.reset_index(drop=True)
    print(f"Loaded {len(result)} individual hit records.", file=sys.stderr)
    return result


def generate_synthetic_data(
    n_samples: int = 5000,
    seed: int = 42,
    cap_value: int = 180,
) -> pd.DataFrame:
    """Generate synthetic battle data for testing.

    Kept here for unit-testing convenience only; full demo scripts
    belong in the ``examples/`` directory.

    Args:
        n_samples: Number of attack records.
        seed: Random seed.
        cap_value: Firepower cap threshold.

    Returns:
        DataFrame mimicking ``load_shelling_data()`` output shape.
    """
    rng = np.random.default_rng(seed)

    karyoku = rng.integers(30, 300, size=n_samples)
    soukou = rng.integers(50, 120, size=n_samples)
    cl = rng.choice([0, 1, 2], size=n_samples, p=[0.10, 0.70, 0.20])

    # Ground-truth formula
    base_attack = np.floor(karyoku * 1.5 + 5).astype(float)
    over_cap = base_attack > cap_value
    base_capped = base_attack.copy()
    base_capped[over_cap] = cap_value + np.sqrt(base_attack[over_cap] - cap_value)

    crit_mult = np.where(cl == 2, 1.5, 1.0)
    effective = np.floor(base_capped * crit_mult)
    armor_red = soukou * rng.uniform(0.7, 1.0, size=n_samples)
    ammo_mod = rng.uniform(0.95, 1.0, size=n_samples)
    raw_damage = np.floor((effective - armor_red) * ammo_mod)
    raw_damage[cl == 0] = 0
    damage = np.maximum(raw_damage, 0).astype(int)

    return pd.DataFrame({
        "attacker_karyoku": karyoku,
        "attacker_raisou": rng.integers(0, 100, size=n_samples),
        "attacker_taiku": rng.integers(20, 80, size=n_samples),
        "attacker_lv": rng.integers(1, 175, size=n_samples),
        "defender_soukou": soukou,
        "defender_nowhp": rng.integers(10, 200, size=n_samples),
        "defender_maxhp": rng.integers(10, 200, size=n_samples),
        "damage": damage,
        "cl": cl,
        "at_type": 0,
        "at_eflag": 0,
        "hit_index": 0,
        "n_hits": 1,
        "_true_base_attack": base_attack,
        "_true_base_attack_capped": base_capped,
    })
