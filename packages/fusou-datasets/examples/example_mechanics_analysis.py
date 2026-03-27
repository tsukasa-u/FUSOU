#!/usr/bin/env python3
"""
Example: Game Mechanics Analysis Pipeline
==========================================

Demonstrates the full 3-stage pipeline using SYNTHETIC data.
No API key or Julia installation required.

Run:
    python example_mechanics_analysis.py

Pipeline Variable Mapping
--------------------------
    Predictor (X):
        attacker_karyoku  -- Attacker's firepower stat
        defender_soukou   -- Defender's armor stat (multi-variable mode)

    Target (Y):
        damage  -- Integer damage dealt per hit

    Controls:
        cl      -- Hit type (0=miss, 1=hit, 2=critical)
        at_type -- Attack type code

    Ground-Truth Formula (known for validation):
        Pre-cap:   base = floor(karyoku * 1.5 + 5)
        Post-cap:  if base > 180: base = 180 + sqrt(base - 180)
        Critical:  base * 1.5
        Damage:    floor((base - soukou * rand) * ammo_rand)
"""

from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import numpy as np
import pandas as pd


def run_single_variable_demo() -> None:
    """Demo 1: Single-variable analysis (karyoku -> damage)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    from analysis.data_loader import generate_synthetic_data
    from analysis.analyzer import GameMechanicsAnalyzer

    print("=" * 70)
    print("  Demo 1: Single-Variable Analysis")
    print("  X = attacker_karyoku -> Y = damage")
    print("=" * 70)
    print()

    df = generate_synthetic_data(n_samples=8000, seed=42, cap_value=180)
    df_hits = df[df["cl"] == 1].copy()
    print(f"Data: {len(df_hits)} normal-hit records")
    print(f"  attacker_karyoku range: [{df_hits['attacker_karyoku'].min()}, "
          f"{df_hits['attacker_karyoku'].max()}]")
    print(f"  damage range:           [{df_hits['damage'].min()}, "
          f"{df_hits['damage'].max()}]")
    print()

    analyzer = GameMechanicsAnalyzer(
        min_samples=3, min_segment_length=8, cap_penalty_scale=5.0,
    )
    result = analyzer.fit_and_discover(
        df_hits, x_cols="attacker_karyoku", y_col="damage",
    )

    print()
    print(analyzer.summary())

    save_dir = os.path.join(_HERE, "output")
    os.makedirs(save_dir, exist_ok=True)
    analyzer.plot_results(save_path=os.path.join(save_dir, "single_var_analysis.png"))
    print(f"Plot saved to: {save_dir}/single_var_analysis.png")


def run_multi_variable_demo() -> None:
    """Demo 2: Multi-variable analysis (karyoku + soukou -> damage)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    from analysis.data_loader import generate_synthetic_data
    from analysis.analyzer import GameMechanicsAnalyzer

    print()
    print("=" * 70)
    print("  Demo 2: Multi-Variable Analysis")
    print("  X = [attacker_karyoku, defender_soukou] -> Y = damage")
    print("=" * 70)
    print()

    df = generate_synthetic_data(n_samples=8000, seed=42, cap_value=180)
    df_hits = df[df["cl"] == 1].copy()
    print(f"Data: {len(df_hits)} normal-hit records")
    print(f"  attacker_karyoku range: [{df_hits['attacker_karyoku'].min()}, "
          f"{df_hits['attacker_karyoku'].max()}]")
    print(f"  defender_soukou range:  [{df_hits['defender_soukou'].min()}, "
          f"{df_hits['defender_soukou'].max()}]")
    print(f"  damage range:           [{df_hits['damage'].min()}, "
          f"{df_hits['damage'].max()}]")
    print()

    analyzer = GameMechanicsAnalyzer(
        min_samples=3, min_segment_length=8, cap_penalty_scale=5.0,
    )
    result = analyzer.fit_and_discover(
        df_hits,
        x_cols=["attacker_karyoku", "defender_soukou"],
        y_col="damage",
    )

    print()
    print(analyzer.summary())

    save_dir = os.path.join(_HERE, "output")
    os.makedirs(save_dir, exist_ok=True)
    analyzer.plot_results(save_path=os.path.join(save_dir, "multi_var_analysis.png"))
    print(f"Plot saved to: {save_dir}/multi_var_analysis.png")


if __name__ == "__main__":
    run_single_variable_demo()
    run_multi_variable_demo()

    print()
    print("=" * 70)
    print("  Both demos complete!")
    print("=" * 70)
