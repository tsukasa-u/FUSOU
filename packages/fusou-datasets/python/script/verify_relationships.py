#!/usr/bin/env python3
"""
Verify all table relationships in fusou-datasets
Checks ID/UUID linkages and identifies missing relationships
"""

import sys
sys.path.insert(0, './fusou_datasets')

import fusou_datasets
import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Set
import warnings
warnings.filterwarnings('ignore')

# APIキーと設定
fusou_datasets.configure(cache_dir="~/.fusou_datasets/cache")

print("✓ ライブラリインポート完了")
print(f"✓ Client ID: {fusou_datasets.get_client_id()}\n")

# テーブル一覧を確認
tables = fusou_datasets.list_tables()
print(f"利用可能テーブル数: {len(tables)}\n")

# 検証対象テーブル（カテゴリ別）
battle_tables = [t for t in tables if 'battle' in t or 'hougeki' in t or 'raigeki' in t or 'airattack' in t or 'taisen' in t]
deck_tables = [t for t in tables if 'deck' in t]
ship_tables = [t for t in tables if 'ship' in t and 'master' not in t]
slotitem_tables = [t for t in tables if 'slotitem' in t and 'master' not in t]
master_tables = [t for t in tables if 'master' in t]
other_tables = [t for t in tables if t not in battle_tables + deck_tables + ship_tables + slotitem_tables + master_tables]

print(f"戦闘データテーブル ({len(battle_tables)}): {', '.join(battle_tables[:5])}...")
print(f"艦隊テーブル ({len(deck_tables)}): {deck_tables}")
print(f"艦船テーブル ({len(ship_tables)}): {ship_tables}")
print(f"装備テーブル ({len(slotitem_tables)}): {slotitem_tables}")
print(f"マスタテーブル ({len(master_tables)}): {master_tables}")
print(f"その他テーブル ({len(other_tables)}): {other_tables[:5]}...\n")

# 検証結果を格納する辞書
verification_results = {}

# ============================================================================
# Battle と OwnDeck の関連付けを検証
# ============================================================================
print("=" * 80)
print("関連付け検証: Battle → OwnDeck")
print("=" * 80)

try:
    df_battle = fusou_datasets.load('battle', offline=True)
    df_own_deck = fusou_datasets.load('own_deck', offline=True)
    
    print(f"✓ Battle: {len(df_battle)} 行")
    print(f"✓ OwnDeck: {len(df_own_deck)} 行")
    
    battle_deck_refs = df_battle['f_deck_id'].dropna().unique()
    own_deck_ids = df_own_deck['uuid'].unique()
    
    print(f"\n  Battle.f_deck_id の一意値: {len(battle_deck_refs)}")
    print(f"  OwnDeck.uuid の一意値: {len(own_deck_ids)}")
    
    missing_refs = set(battle_deck_refs) - set(own_deck_ids)
    if missing_refs:
        print(f"\n  ⚠️ 欠落: {len(missing_refs)} 件")
    else:
        print(f"\n  ✓ すべての参照が存在")
    
    match_count = len(set(battle_deck_refs) & set(own_deck_ids))
    match_rate = 100 * match_count / len(battle_deck_refs) if battle_deck_refs.size > 0 else 0
    print(f"  マッピング率: {match_rate:.1f}% ({match_count}/{len(battle_deck_refs)})")
    
    verification_results['Battle→OwnDeck'] = {
        'matching': match_count,
        'total': len(battle_deck_refs),
        'missing': len(missing_refs),
        'rate': match_rate
    }
    
except Exception as e:
    print(f"✗ エラー: {e}")

# ============================================================================
# OwnDeck と OwnShip の関連付けを検証
# ============================================================================
print("\n" + "=" * 80)
print("関連付け検証: OwnDeck → OwnShip")
print("=" * 80)

try:
    df_own_ship = fusou_datasets.load('own_ship', offline=True)
    
    print(f"✓ OwnShip: {len(df_own_ship)} 行")
    
    deck_ship_refs = df_own_deck['ship_ids'].dropna().unique()
    own_ship_ids = df_own_ship['uuid'].unique()
    
    print(f"\n  OwnDeck.ship_ids の一意値: {len(deck_ship_refs)}")
    print(f"  OwnShip.uuid の一意値: {len(own_ship_ids)}")
    
    missing_refs = set(deck_ship_refs) - set(own_ship_ids)
    if missing_refs:
        print(f"\n  ⚠️ 欠落: {len(missing_refs)} 件")
    else:
        print(f"\n  ✓ すべての参照が存在")
    
    match_count = len(set(deck_ship_refs) & set(own_ship_ids))
    match_rate = 100 * match_count / len(deck_ship_refs) if len(deck_ship_refs) > 0 else 0
    print(f"  マッピング率: {match_rate:.1f}% ({match_count}/{len(deck_ship_refs)})")
    
    verification_results['OwnDeck→OwnShip'] = {
        'matching': match_count,
        'total': len(deck_ship_refs),
        'missing': len(missing_refs),
        'rate': match_rate
    }
    
except Exception as e:
    print(f"✗ エラー: {e}")

# ============================================================================
# OwnShip と ShipMaster の関連付けを検証
# ============================================================================
print("\n" + "=" * 80)
print("関連付け検証: OwnShip → ShipMaster (Master Data)")
print("=" * 80)

try:
    df_ship_master = fusou_datasets.load_master('mst_ship')
    
    print(f"✓ ShipMaster: {len(df_ship_master)} 行")
    
    own_ship_refs = df_own_ship['ship_id'].dropna().astype(int).unique()
    ship_master_ids = df_ship_master['id'].unique()
    
    print(f"\n  OwnShip.ship_id の一意値: {len(own_ship_refs)}")
    print(f"  ShipMaster.id の一意値: {len(ship_master_ids)}")
    
    missing_refs = set(own_ship_refs) - set(ship_master_ids)
    if missing_refs:
        print(f"\n  ⚠️ 欠落: {len(missing_refs)} 件")
        print(f"     例: {list(missing_refs)[:5]}")
    else:
        print(f"\n  ✓ すべての参照が存在")
    
    match_count = len(set(own_ship_refs) & set(ship_master_ids))
    match_rate = 100 * match_count / len(own_ship_refs) if len(own_ship_refs) > 0 else 0
    print(f"  マッピング率: {match_rate:.1f}% ({match_count}/{len(own_ship_refs)})")
    
    verification_results['OwnShip→ShipMaster'] = {
        'matching': match_count,
        'total': len(own_ship_refs),
        'missing': len(missing_refs),
        'rate': match_rate
    }
    
except Exception as e:
    print(f"✗ エラー: {e}")

# ============================================================================
# OwnShip と OwnSlotitem の関連付けを検証
# ============================================================================
print("\n" + "=" * 80)
print("関連付け検証: OwnShip → OwnSlotitem")
print("=" * 80)

try:
    df_own_slotitem = fusou_datasets.load('own_slotitem', offline=True)
    
    print(f"✓ OwnSlotitem: {len(df_own_slotitem)} 行")
    
    own_ship_slot_refs = df_own_ship['slot'].dropna().unique()
    own_slotitem_ids = df_own_slotitem['uuid'].unique()
    
    print(f"\n  OwnShip.slot の一意値: {len(own_ship_slot_refs)}")
    print(f"  OwnSlotitem.uuid の一意値: {len(own_slotitem_ids)}")
    
    missing_refs = set(own_ship_slot_refs) - set(own_slotitem_ids)
    if missing_refs:
        print(f"\n  ⚠️ 欠落: {len(missing_refs)} 件")
    else:
        print(f"\n  ✓ すべての参照が存在")
    
    match_count = len(set(own_ship_slot_refs) & set(own_slotitem_ids))
    match_rate = 100 * match_count / len(own_ship_slot_refs) if len(own_ship_slot_refs) > 0 else 0
    print(f"  マッピング率: {match_rate:.1f}% ({match_count}/{len(own_ship_slot_refs)})")
    
    verification_results['OwnShip→OwnSlotitem'] = {
        'matching': match_count,
        'total': len(own_ship_slot_refs),
        'missing': len(missing_refs),
        'rate': match_rate
    }
    
except Exception as e:
    print(f"✗ エラー: {e}")

# ============================================================================
# OwnSlotitem と SlotItemMaster の関連付けを検証
# ============================================================================
print("\n" + "=" * 80)
print("関連付け検証: OwnSlotitem → SlotItemMaster (Master Data)")
print("=" * 80)

try:
    df_slotitem_master = fusou_datasets.load_master('mst_slotitem')
    
    print(f"✓ SlotItemMaster: {len(df_slotitem_master)} 行")
    
    own_slotitem_refs = df_own_slotitem['mst_slotitem_id'].dropna().astype(int).unique()
    slotitem_master_ids = df_slotitem_master['id'].unique()
    
    print(f"\n  OwnSlotitem.mst_slotitem_id の一意値: {len(own_slotitem_refs)}")
    print(f"  SlotItemMaster.id の一意値: {len(slotitem_master_ids)}")
    
    missing_refs = set(own_slotitem_refs) - set(slotitem_master_ids)
    if missing_refs:
        print(f"\n  ⚠️ 欠落: {len(missing_refs)} 件")
        print(f"     例: {list(missing_refs)[:5]}")
    else:
        print(f"\n  ✓ すべての参照が存在")
    
    match_count = len(set(own_slotitem_refs) & set(slotitem_master_ids))
    match_rate = 100 * match_count / len(own_slotitem_refs) if len(own_slotitem_refs) > 0 else 0
    print(f"  マッピング率: {match_rate:.1f}% ({match_count}/{len(own_slotitem_refs)})")
    
    verification_results['OwnSlotitem→SlotItemMaster'] = {
        'matching': match_count,
        'total': len(own_slotitem_refs),
        'missing': len(missing_refs),
        'rate': match_rate
    }
    
except Exception as e:
    print(f"✗ エラー: {e}")

# ============================================================================
# Enemy & Friend Deck 検証
# ============================================================================
print("\n" + "=" * 80)
print("関連付け検証: Enemy/Friend Deck と Ships")
print("=" * 80)

try:
    if 'enemy_deck' in tables:
        df_enemy_deck = fusou_datasets.load('enemy_deck', offline=True)
        df_enemy_ship = fusou_datasets.load('enemy_ship', offline=True)
        
        print(f"\n✓ EnemyDeck: {len(df_enemy_deck)} 行, EnemyShip: {len(df_enemy_ship)} 行")
        
        enemy_deck_refs = df_enemy_deck['ship_ids'].dropna().unique()
        enemy_ship_ids = df_enemy_ship['uuid'].unique()
        
        missing = len(set(enemy_deck_refs) - set(enemy_ship_ids))
        match_count = len(set(enemy_deck_refs) & set(enemy_ship_ids))
        match_rate = 100 * match_count / len(enemy_deck_refs) if len(enemy_deck_refs) > 0 else 0
        print(f"  EnemyDeck → EnemyShip: マッピング率 {match_rate:.1f}%, 欠落 {missing} 件")
        
        verification_results['EnemyDeck→EnemyShip'] = {
            'matching': match_count,
            'total': len(enemy_deck_refs),
            'missing': missing,
            'rate': match_rate
        }
    
    if 'friend_deck' in tables:
        df_friend_deck = fusou_datasets.load('friend_deck', offline=True)
        df_friend_ship = fusou_datasets.load('friend_ship', offline=True)
        
        print(f"✓ FriendDeck: {len(df_friend_deck)} 行, FriendShip: {len(df_friend_ship)} 行")
        
        friend_deck_refs = df_friend_deck['ship_ids'].dropna().unique()
        friend_ship_ids = df_friend_ship['uuid'].unique()
        
        missing = len(set(friend_deck_refs) - set(friend_ship_ids))
        match_count = len(set(friend_deck_refs) & set(friend_ship_ids))
        match_rate = 100 * match_count / len(friend_deck_refs) if len(friend_deck_refs) > 0 else 0
        print(f"  FriendDeck → FriendShip: マッピング率 {match_rate:.1f}%, 欠落 {missing} 件")
        
        verification_results['FriendDeck→FriendShip'] = {
            'matching': match_count,
            'total': len(friend_deck_refs),
            'missing': missing,
            'rate': match_rate
        }
    
except Exception as e:
    print(f"✗ エラー: {e}")

# ============================================================================
# Battle → 戦闘詳細データの関連付けを検証
# ============================================================================
print("\n" + "=" * 80)
print("関連付け検証: Battle → 戦闘詳細データ")
print("=" * 80)

battle_detail_tables = {
    'hougeki': ('hougeki_list', 'hougeki'),
    'midnight_hougeki': ('midnight_hougeki_list', 'midnight_hougeki'),
    'opening_taisen': ('opening_taisen_list', 'opening_taisen'),
    'opening_raigeki': 'opening_raigeki',
    'closing_raigeki': 'closing_raigeki',
    'opening_airattack': ('opening_airattack_list', 'opening_airattack'),
    'airbase_assault': 'airbase_assult',
    'carrier_base_assault': 'carrierbase_assault',
    'support_hourai': 'support_hourai',
    'support_airattack': 'support_airattack',
    'friendly_force_attack': ('friendly_support_hourai_list', 'friendly_support_hourai'),
}

for battle_col, detail_info in battle_detail_tables.items():
    try:
        if isinstance(detail_info, tuple):
            list_table, detail_table = detail_info
        else:
            detail_table = detail_info
            list_table = None
        
        if battle_col not in df_battle.columns:
            print(f"\n  ℹ️  Battle.{battle_col} は存在しません")
            continue
        
        battle_refs = df_battle[battle_col].dropna().unique()
        
        if len(battle_refs) == 0:
            print(f"\n  ℹ️  Battle.{battle_col} は空です")
            continue
        
        if list_table and list_table in tables:
            df_list = fusou_datasets.load(list_table, offline=True)
            list_ids = df_list['uuid'].unique()
            
            missing = len(set(battle_refs) - set(list_ids))
            match_count = len(set(battle_refs) & set(list_ids))
            match_rate = 100 * match_count / len(battle_refs) if len(battle_refs) > 0 else 0
            
            status = "✓" if missing == 0 else "⚠️"
            print(f"\n{status} Battle.{battle_col} → {list_table}: {match_rate:.1f}%, 欠落 {missing} 件")
            
            verification_results[f'Battle→{list_table}'] = {
                'matching': match_count,
                'total': len(battle_refs),
                'missing': missing,
                'rate': match_rate
            }
        elif detail_table in tables:
            df_detail = fusou_datasets.load(detail_table, offline=True)
            detail_ids = df_detail['uuid'].unique()
            
            missing = len(set(battle_refs) - set(detail_ids))
            match_count = len(set(battle_refs) & set(detail_ids))
            match_rate = 100 * match_count / len(battle_refs) if len(battle_refs) > 0 else 0
            
            status = "✓" if missing == 0 else "⚠️"
            print(f"\n{status} Battle.{battle_col} → {detail_table}: {match_rate:.1f}%, 欠落 {missing} 件")
            
            verification_results[f'Battle→{detail_table}'] = {
                'matching': match_count,
                'total': len(battle_refs),
                'missing': missing,
                'rate': match_rate
            }
        else:
            print(f"\n  ℹ️  {list_table or detail_table} はキャッシュにありません")
            
    except Exception as e:
        print(f"\n  ✗ {battle_col}: {str(e)[:50]}")

# ============================================================================
# 環境情報の検証
# ============================================================================
print("\n" + "=" * 80)
print("環境情報（EnvInfo）の検証")
print("=" * 80)

try:
    df_env_info = fusou_datasets.load('env_info', offline=True)
    
    print(f"\n✓ EnvInfo: {len(df_env_info)} 環境")
    
    env_uuids_in_battle = df_battle['env_uuid'].dropna().unique()
    env_uuids_in_env_info = df_env_info['uuid'].unique()
    
    print(f"  Battle の env_uuid: {len(env_uuids_in_battle)} 個")
    print(f"  EnvInfo.uuid: {len(env_uuids_in_env_info)} 個")
    
    missing = len(set(env_uuids_in_battle) - set(env_uuids_in_env_info))
    match_count = len(set(env_uuids_in_battle) & set(env_uuids_in_env_info))
    match_rate = 100 * match_count / len(env_uuids_in_battle) if len(env_uuids_in_battle) > 0 else 0
    
    if missing == 0:
        print(f"  ✓ すべての Battle.env_uuid は EnvInfo に存在")
    else:
        print(f"  ⚠️ {missing} 個の env_uuid が EnvInfo に存在しません")
    
    print(f"\n  タイムスタンプ範囲:")
    print(f"    最早: {pd.to_datetime(df_env_info['timestamp'].min(), unit='s')}")
    print(f"    最新: {pd.to_datetime(df_env_info['timestamp'].max(), unit='s')}")
    
    verification_results['Battle→EnvInfo'] = {
        'matching': match_count,
        'total': len(env_uuids_in_battle),
        'missing': missing,
        'rate': match_rate
    }
    
except Exception as e:
    print(f"✗ エラー: {e}")

# ============================================================================
# Cells → MapMaster の関連付けを検証
# ============================================================================
print("\n" + "=" * 80)
print("関連付け検証: Cells → Maps")
print("=" * 80)

try:
    df_cells = fusou_datasets.load('cells', offline=True)
    
    print(f"\n✓ Cells: {len(df_cells)} 行")
    
    if 'maparea_id' in df_cells.columns:
        cell_maparea = df_cells['maparea_id'].dropna().astype(int).unique()
        print(f"  Cells.maparea_id の一意値: {len(cell_maparea)} 個")
        print(f"  例: {sorted(cell_maparea)[:10].tolist()}")
    
    if 'mapinfo_no' in df_cells.columns:
        cell_mapinfo = df_cells['mapinfo_no'].dropna().astype(int).unique()
        print(f"  Cells.mapinfo_no の一意値: {len(cell_mapinfo)} 個")
        print(f"  例: {sorted(cell_mapinfo)[:10].tolist()}")
    
except Exception as e:
    print(f"✗ エラー: {e}")

# ============================================================================
# 最終レポート
# ============================================================================
print("\n" + "=" * 80)
print("📊 検証結果サマリー")
print("=" * 80)

# データサイズサマリー
print("\n📈 データサイズ:")
summary_data = {
    'Battle': len(df_battle),
    'OwnDeck': len(df_own_deck),
    'OwnShip': len(df_own_ship),
    'OwnSlotitem': len(df_own_slotitem),
    'ShipMaster': len(df_ship_master),
    'SlotItemMaster': len(df_slotitem_master),
    'Cells': len(df_cells),
    'EnvInfo': len(df_env_info),
}

for table_name, count in summary_data.items():
    print(f"  {table_name:20s}: {count:8,} 行")

# 関連付け品質サマリー
print("\n✅ 関連付け品質:")
for rel_name, result in verification_results.items():
    status = "✓" if result['missing'] == 0 else "⚠️"
    print(f"  {status} {rel_name:40s}: {result['rate']:5.1f}% (欠落 {result['missing']} 件)")

# 欠落がある関連付けをハイライト
missing_relationships = {k: v for k, v in verification_results.items() if v['missing'] > 0}
if missing_relationships:
    print("\n⚠️ 欠落がある関連付け:")
    for rel_name, result in missing_relationships.items():
        print(f"  • {rel_name}: {result['missing']} 件欠落")

print("\n" + "=" * 80)
print("✓ 検証完了")
print("=" * 80)
