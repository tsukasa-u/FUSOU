#!/usr/bin/env python3
"""Run the formula extraction pipeline from CLI.

Usage
-----
    # Auto-discover all targets from SDK (recommended)
    python scripts/run_pipeline.py --sdk --output results/

    # Specific table + target
    python scripts/run_pipeline.py --sdk --tables hougeki --target-col damage

    # Specific tables, auto-discover targets within them
    python scripts/run_pipeline.py --sdk --tables hougeki,midnight_hougeki

    # From CSV (target-col required)
    python scripts/run_pipeline.py --csv data.csv --target-col damage

    # Synthetic test data
    python scripts/run_pipeline.py --synthetic --output results/

    # Discover only (list candidate targets without running pipeline)
    python scripts/run_pipeline.py --sdk --discover-only
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

# Add parent to path so the package can be imported directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fusou_formula.data_loader import DataLoader, LoadedDataset
from fusou_formula.exporter import FormulaExporter
from fusou_formula.pipeline import Pipeline, PipelineConfig


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="fusou-formula: Black-box model extraction pipeline",
    )

    # Data source (mutually exclusive)
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument("--csv", help="Path to CSV data file")
    source.add_argument(
        "--sdk",
        action="store_true",
        help="Load from fusou-datasets SDK",
    )
    source.add_argument(
        "--synthetic",
        action="store_true",
        help="Use synthetic test data",
    )

    # Data options
    p.add_argument(
        "--target-col",
        help=(
            "Target column name. If omitted in SDK mode, "
            "auto-discovers all candidate targets."
        ),
    )
    p.add_argument(
        "--feature-cols",
        help="Comma-separated feature column names (auto-detect if omitted)",
    )
    p.add_argument(
        "--tables",
        help=(
            "Comma-separated table names for SDK mode. "
            "If omitted, scans all available tables."
        ),
    )
    p.add_argument(
        "--discover-only",
        action="store_true",
        help="List candidate targets without running the pipeline",
    )
    p.add_argument(
        "--max-targets",
        type=int,
        default=0,
        help="Max number of targets to analyse (0 = unlimited)",
    )

    # Pipeline parameters
    p.add_argument("--output", default="results", help="Output directory")
    p.add_argument(
        "--skip-phases",
        help="Comma-separated phase numbers to skip (e.g. '2,5')",
    )
    p.add_argument("--parsimony", type=float, default=0.005)
    p.add_argument("--max-complexity", type=int, default=30)
    p.add_argument("--sr-iterations", type=int, default=150)
    p.add_argument("--sr-populations", type=int, default=40)
    p.add_argument(
        "--binary-ops",
        default="+,-,*,/",
        help="Comma-separated binary operators",
    )
    p.add_argument(
        "--unary-ops",
        default="sqrt,abs,log,exp,sin,square,cube",
        help="Comma-separated unary operators",
    )
    p.add_argument("--n-folds", type=int, default=5)

    # Publishing
    p.add_argument(
        "--publish",
        action="store_true",
        help="Publish to FUSOU-WEB API",
    )
    p.add_argument("--api-url", default="https://dev.fusou.pages.dev")
    p.add_argument("--api-key", default="")
    p.add_argument("--artifact-id", help="Override artifact ID")

    return p.parse_args()


def build_config(args: argparse.Namespace) -> PipelineConfig:
    return PipelineConfig(
        sr_binary_operators=args.binary_ops.split(","),
        sr_unary_operators=args.unary_ops.split(","),
        sr_parsimony=args.parsimony,
        sr_max_complexity=args.max_complexity,
        sr_populations=args.sr_populations,
        sr_niterations=args.sr_iterations,
        val_n_folds=args.n_folds,
    )


# Known table descriptions for documentation in artifacts
_TABLE_DESCRIPTIONS: dict[str, str] = {
    "hougeki": "砲撃戦（昼戦の砲撃フェーズ）",
    "midnight_hougeki": "夜戦砲撃",
    "opening_taisen": "先制対潜攻撃",
    "opening_raigeki": "先制雷撃",
    "closing_raigeki": "閉幕雷撃",
    "battle": "戦闘メインテーブル",
    "own_ship": "自軍艦船ステータス",
    "enemy_ship": "敵艦船ステータス",
    "friend_ship": "友軍艦船ステータス",
    "own_slotitem": "自軍装備情報",
    "enemy_slotitem": "敵装備情報",
    "own_deck": "自軍艦隊編成",
    "enemy_deck": "敵艦隊編成",
    "cells": "マップセル情報",
    "airbase": "基地航空隊",
    "plane_info": "航空機情報",
    "airbase_airattack": "基地航空攻撃",
    "opening_airattack": "開幕航空戦",
    "support_airattack": "支援航空攻撃",
    "support_hourai": "支援砲雷撃",
    "ship_master": "艦船マスタデータ",
    "ship_type": "艦種マスタ",
    "slot_item_master": "装備マスタデータ",
    "map_area_master": "海域マスタ",
    "map_info_master": "マップ情報マスタ",
    "env_info": "環境情報",
}

# Known column descriptions
_COLUMN_DESCRIPTIONS: dict[str, str] = {
    # Battle / Hougeki
    "damage": "ダメージ値",
    "at": "攻撃元インデックス",
    "at_type": "攻撃タイプ（連撃/カットイン等）",
    "df": "防御先インデックス",
    "cl": "命中フラグ（0=ミス, 1=命中, 2=クリティカル）",
    "at_eflag": "攻撃者フラグ（0=自軍, 1=敵）",
    "si": "使用装備ID",
    "protect_flag": "かばいフラグ",
    "f_now_hps": "攻撃後の自軍残HP",
    "e_now_hps": "攻撃後の敵残HP",
    "f_dam": "自軍へのダメージ",
    "e_dam": "敵へのダメージ",
    # Ship stats
    "karyoku": "火力",
    "raisou": "雷装",
    "taiku": "対空",
    "soukou": "装甲",
    "kaihi": "回避",
    "taisen": "対潜",
    "sakuteki": "索敵",
    "lucky": "運",
    "lv": "レベル",
    "nowhp": "現在HP",
    "maxhp": "最大HP",
    "cond": "士気（コンディション）",
    "soku": "速力",
    "leng": "射程",
    "fuel": "燃料",
    "bull": "弾薬",
    # Air battle
    "f_loss_plane1": "自軍航空機損失数（ステージ1）",
    "f_loss_plane2": "自軍航空機損失数（ステージ2）",
    "e_loss_plane1": "敵航空機損失数（ステージ1）",
    "e_loss_plane2": "敵航空機損失数（ステージ2）",
    "f_damages": "自軍ダメージ（航空戦）",
    "e_damages": "敵ダメージ（航空戦）",
    "air_superiority": "制空状態",
    # Battle-level
    "f_total_damages": "自軍が受けたダメージ合計",
    "e_total_damages": "敵が受けたダメージ合計",
    "f_formation": "自軍陣形",
    "e_formation": "敵陣形",
    "cell_id": "セルID",
    # Equipment
    "houm": "命中補正",
    "houk": "回避補正",
    "baku": "爆装",
    "distance": "行動半径",
    "cost": "配備コスト",
    # Master
    "ship_id": "艦船マスタID",
    "mst_ship_id": "艦船マスタID",
    "mst_slotitem_id": "装備マスタID",
}


def _run_single(
    dataset: LoadedDataset,
    target_name: str,
    config: PipelineConfig,
    args: argparse.Namespace,
    skip_phases: list[int] | None,
    table_name: str = "",
    data_source: dict[str, object] | None = None,
) -> None:
    """Run pipeline + export for a single target."""
    df = dataset.df
    target_col = dataset.target_col
    feature_cols = dataset.feature_cols

    label = f"{table_name}/{target_name}" if table_name else target_name
    print(f"\n{'='*60}")
    print(f"  Target:   {label}")
    print(f"  Data:     {len(df)} rows, {len(feature_cols)} features")
    print(f"  Features: {feature_cols}")
    print(f"{'='*60}\n")

    pipeline = Pipeline(config)
    result = pipeline.run(
        df=df,
        target_col=target_col,
        feature_cols=feature_cols,
        skip_phases=skip_phases,
    )

    # Report
    report = pipeline.report()
    print("\n" + report)

    # Export
    safe_table = table_name.replace("/", "_") if table_name else ""
    if args.artifact_id:
        artifact_id = args.artifact_id
    elif safe_table:
        artifact_id = f"analysis_{safe_table}_{target_name}_v1"
    else:
        artifact_id = f"analysis_{target_name}_v1"

    exporter = FormulaExporter()
    artifact = exporter.export(
        pipeline_result=result,
        artifact_id=artifact_id,
        target_name=target_name,
        status="candidate",
        df=df,
        target_col=target_col,
        feature_cols=feature_cols,
        data_source=data_source,
    )

    filepath = exporter.save(artifact, args.output)
    print(f"\nArtifact saved: {filepath}")

    # Publish
    if args.publish:
        if not args.api_key:
            print("Warning: --api-key is required for publishing — skipping")
            return
        try:
            exporter.publish(artifact, args.api_url, args.api_key)
            print(f"Published to {args.api_url}")
        except Exception as e:
            print(f"Publish failed: {e}")


def main() -> None:
    args = parse_args()
    config = build_config(args)

    skip_phases = None
    if args.skip_phases:
        skip_phases = [int(x.strip()) for x in args.skip_phases.split(",")]

    loader = DataLoader()

    # ------------------------------------------------------------------
    # CSV mode: single target (required)
    # ------------------------------------------------------------------
    if args.csv:
        if not args.target_col:
            print("Error: --target-col is required for CSV mode")
            sys.exit(1)
        dataset = loader.load_from_csv(
            args.csv,
            args.target_col,
            feature_cols=(
                [c.strip() for c in args.feature_cols.split(",")]
                if args.feature_cols
                else None
            ),
        )
        csv_source: dict[str, object] = {
            "type": "csv",
            "csv_path": args.csv,
            "column_descriptions": {
                col: _COLUMN_DESCRIPTIONS.get(col, "")
                for col in [args.target_col] + dataset.feature_cols
            },
        }
        _run_single(
            dataset, args.target_col, config, args, skip_phases,
            data_source=csv_source,
        )
        return

    # ------------------------------------------------------------------
    # Synthetic mode
    # ------------------------------------------------------------------
    if args.synthetic:
        dataset = DataLoader.create_synthetic(
            formula_fn=lambda x, z: math.floor(x * 1.5 + z * 0.3 + 5),
            n_samples=5000,
            feature_ranges={"x": (10.0, 200.0), "z": (0.0, 100.0)},
            noise_fn=lambda rng: rng.uniform(0.0, 3.0),
            seed=42,
        )
        synthetic_source: dict[str, object] = {
            "type": "synthetic",
            "formula_description": "floor(x * 1.5 + z * 0.3 + 5) + uniform(0, 3)",
            "column_descriptions": {
                "y": "合成目的変数（テスト用ダミー、実データのフィールドではありません）",
                "x": "合成特徴量1（10〜200の一様乱数、テスト用ダミー）",
                "z": "合成特徴量2（0〜100の一様乱数、テスト用ダミー）",
            },
            "note": "このデータはパイプラインの動作テスト用に生成された合成データです。"
                    "fusou-datasetsの実際のテーブルやフィールドとは一切関係ありません。",
        }
        _run_single(
            dataset, "synthetic_target", config, args, skip_phases,
            data_source=synthetic_source,
        )
        return

    # ------------------------------------------------------------------
    # SDK mode
    # ------------------------------------------------------------------
    if not args.sdk:
        print("Error: specify --csv, --sdk, or --synthetic")
        sys.exit(1)

    tables = (
        [t.strip() for t in args.tables.split(",")]
        if args.tables
        else None
    )

    # If a specific target is given, behave as before (single run)
    if args.target_col:
        if not tables:
            print("Error: --tables is required when --target-col is specified")
            sys.exit(1)
        dataset = loader.load_from_sdk(
            tables,
            args.target_col,
            feature_cols=(
                [c.strip() for c in args.feature_cols.split(",")]
                if args.feature_cols
                else None
            ),
        )
        table_label = ",".join(tables)
        sdk_source: dict[str, object] = {
            "type": "sdk",
            "tables": tables,
            "table_descriptions": {
                t: _TABLE_DESCRIPTIONS.get(t, "") for t in tables
            },
            "column_descriptions": {
                col: _COLUMN_DESCRIPTIONS.get(col, "")
                for col in [args.target_col] + dataset.feature_cols
            },
        }
        _run_single(
            dataset, args.target_col, config, args, skip_phases,
            table_name=table_label,
            data_source=sdk_source,
        )
        return

    # ------------------------------------------------------------------
    # Auto-discovery mode: find all (table, target) pairs
    # ------------------------------------------------------------------
    print("=== fusou-formula: Auto-Discovery Mode ===\n")
    print("Scanning tables for candidate targets …\n")

    tasks = loader.discover_analysis_tasks(tables=tables)

    if not tasks:
        print("No candidate targets found.")
        sys.exit(0)

    # Print discovery summary
    print(f"Found {len(tasks)} candidate target(s):\n")
    print(f"  {'#':<4} {'Table':<30} {'Target':<25} {'Features':<6} {'Rows':<8}")
    print(f"  {'-'*4} {'-'*30} {'-'*25} {'-'*6} {'-'*8}")
    for i, task in enumerate(tasks, 1):
        print(
            f"  {i:<4} {task['table']:<30} {task['target_col']:<25} "
            f"{len(task['feature_cols']):<6} {task['n_samples']:<8}"
        )
    print()

    if args.discover_only:
        # Also print per-table column details
        tables_seen: set[str] = set()
        for task in tasks:
            t = task["table"]
            if t in tables_seen:
                continue
            tables_seen.add(t)
            print(f"  [{t}] columns: {task['feature_cols'] + [task['target_col']]}")
        return

    # Apply max-targets limit
    if args.max_targets > 0:
        tasks = tasks[: args.max_targets]
        print(f"Running pipeline for first {len(tasks)} target(s) …\n")
    else:
        print(f"Running pipeline for all {len(tasks)} target(s) …\n")

    # Execute pipeline for each task
    t0 = time.time()
    completed = 0
    failed = 0

    for i, task in enumerate(tasks, 1):
        print(f"\n>>> Task {i}/{len(tasks)}: {task['table']}.{task['target_col']}")

        try:
            df = task["df"]
            target_col = task["target_col"]
            feature_cols = task["feature_cols"]

            dataset = DataLoader.load_from_dataframe(
                df, target_col, feature_cols=feature_cols,
            )
            task_table = task["table"]
            task_source: dict[str, object] = {
                "type": "sdk",
                "tables": [task_table],
                "table_descriptions": {
                    task_table: _TABLE_DESCRIPTIONS.get(task_table, ""),
                },
                "column_descriptions": {
                    col: _COLUMN_DESCRIPTIONS.get(col, "")
                    for col in [target_col] + feature_cols
                },
            }
            _run_single(
                dataset,
                target_col,
                config,
                args,
                skip_phases,
                table_name=task_table,
                data_source=task_source,
            )
            completed += 1
        except Exception as e:
            print(f"  ERROR: {e}")
            failed += 1
            continue

    elapsed = time.time() - t0
    print(f"\n{'='*60}")
    print(f"  Completed: {completed}/{len(tasks)} targets in {elapsed:.1f}s")
    if failed:
        print(f"  Failed: {failed}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
