---
title: かばう演出とシールドモーション判定
description: >-
  戦闘中の「旗艦をかばう」系演出について、フェーズ別の入力データ、
  判定式、表示先決定、モーション分岐、例外経路まで整理した資料。
contributors: ["github-copilot"]
date: 2026-03-29
slug: formulas/shield-cover-sprite-motion
tags: [formulas, battle, shield, cover, sprite, motion]
---

## 1. スコープ

この資料は、戦闘演出における「かばう」表示（シールド表示と被弾モーション）を整理する。

対象コード:

- packages/equip_synergy_detector/output/deobfuscated.js

対象要素:

- シールド発生判定
- かばわれ先（旗艦）の決定
- 被弾時モーション分岐
- フェーズ別入力キー

## 2. 用語

- shield: かばう演出を有効化する内部判定
- defender: 実際に攻撃を受けた艦
- shield target: シールドエフェクトを表示する旗艦バナー

## 3. シールド判定の基本

複数の戦闘データモデルで、次の規則が使われる。

- 生ダメージ値に小数部がある場合: shield = true
- 小数部がない場合: shield = false

一般化式:

$$
shield = (raw\_damage \bmod 1) > 0
$$

実装上は、次が分離される。

- getDamage(): ダメージ表示用に整数化（floor）
- isShield(): 生ダメージ配列を参照し小数部判定

## 4. フェーズ別の入力データと判定

### 4-1. 砲撃戦（昼/夜）

入力:

- damages[idx]

判定式:

$$
shield(idx)=\big(damages[idx] \neq null\big)\land\big(damages[idx] \bmod 1 > 0\big)
$$

### 4-2. 雷撃戦

入力キーと判定式:

- 友軍側 isShield_f(idx): api_fydam[idx] を参照

$$
shield\_f(idx)=\big(api\_fydam[idx] \neq null\big)\land\big(api\_fydam[idx] \bmod 1 \neq 0\big)
$$

- 敵側 isShield_e(idx): 実装は api_eydam ではなく api_fydam[idx] を参照

$$
shield\_e(idx)=\big(api\_fydam[idx] \neq null\big)\land\big(api\_fydam[idx] \bmod 1 \neq 0\big)
$$

- 友軍側 hasShield_f(): api_fdam 全要素を走査

$$
hasShield\_f=\exists x\in api\_fdam\;\text{s.t.}\;(x \bmod 1 \neq 0)
$$

- 敵側 hasShield_e(): api_edam 全要素を走査

$$
hasShield\_e=\exists x\in api\_edam\;\text{s.t.}\;(x \bmod 1 \neq 0)
$$

### 4-3. 開幕雷撃（複数ヒット）

入力キーと判定式:

- 友軍側 isShield_f(idx): api_fydam_list_items[idx][0] を参照

$$
shield\_f(idx)=\big(api\_fydam\_list\_items[idx][0] \neq null\big)\land\big(api\_fydam\_list\_items[idx][0] \bmod 1 \neq 0\big)
$$

- 敵側 isShield_e(idx): 実装は api_eydam_list_items ではなく api_fydam_list_items[idx][0] を参照

$$
shield\_e(idx)=\big(api\_fydam\_list\_items[idx][0] \neq null\big)\land\big(api\_fydam\_list\_items[idx][0] \bmod 1 \neq 0\big)
$$

- 友軍側 isMultiShield_f(idx): api_fydam_list_items[idx] の各要素を判定

$$
multiShield\_f(idx)[k]=\big(api\_fydam\_list\_items[idx][k] \bmod 1 \neq 0\big)
$$

- 敵側 isMultiShield_e(idx): 実装は api_eydam_list_items ではなく api_fydam_list_items[idx] の各要素を判定

$$
multiShield\_e(idx)[k]=\big(api\_fydam\_list\_items[idx][k] \bmod 1 \neq 0\big)
$$

### 4-4. 航空戦 Stage3

判定:

- このモデル経路では整数化後ダメージ値で shield 判定されるため、
  実装上 shield は発生しない（常に false 扱い）

含意:

- 航空戦 Stage3 単体では、かばう演出は出ない
- かばう演出が発生する判定は砲撃/雷撃側モデルに存在する

## 5. かばわれ先（表示対象）の決定

シールドが true のとき、演出レイヤは「対象艦そのもの」ではなく、
同じサイド内の旗艦バナーへシールド演出を出す。

判定ルール:

- 主力艦隊所属なら主力側 index 0
- 連合側所属なら連合側 index 0
- 友軍側所属なら友軍側 index 0

要点:

- シールド演出の表示先は常にそのグループの旗艦
- これが「旗艦をかばう」見た目を作る
- defender はそのまま被弾モーションを行い、shield target は旗艦側に分離される

## 6. 被弾モーション分岐

バナー側は moveAtDamage(shield) を受け、分岐する。

- shield = false: 通常被弾シェイク
- shield = true: シールド専用モーションと色演出

追加条件:

- バナーが不可視状態の場合は moveAtDamage が早期終了し、見た目の移動は再生されない

## 7. タスク実行時の適用順

実装順序は次順になる。

1. フェーズデータから defender ごとの damage/hit/shield を取得
2. shield=true の defender について、旗艦バナーを shield target として解決
3. layer_damage.showShieldAtBanner(shield target) を実行
4. defender 側で moveAtDamage(shield) を実行
5. 通常のダメージ数字・爆発・HP更新を実行

## 8. 航空戦経路での適用条件

航空戦の被弾表示経路では、対象艦ごとに次の条件式で被弾処理に入る。

$$
damage\_process = (\lnot isRai(idx)) \land (isBak(idx) \lor getDamage(idx) > 0)
$$

- 雷撃フラグが立っていない
- かつ 爆撃フラグあり または ダメージ値 > 0

また、同経路の shield 判定は常に false になる。

$$
shield(idx) = false
$$

したがって、
旗艦側シールド演出は発生せず、通常被弾モーションのみ再生される。

## 9. サポート攻撃での集約動作

支援砲撃・支援雷撃系タスクでは、shield target を一時配列で重複排除してから
シールド演出タスクを積む実装になっている。

要点:

- 同じ旗艦に対する重複シールド表示を抑制する
- defender ごとのダメージ演出は通常どおり個別に実行される

## 10. フェーズ横断の一般化

フェーズごとに次のとおり分岐する。

- 砲撃戦/雷撃戦（通常・開幕）: isShield=true の場合に「旗艦側シールド表示 -> moveAtDamage(true)」を実行
- 航空戦 Stage3: isShield=false 固定のため「旗艦側シールド表示」は実行されず、moveAtDamage(false) のみ実行

## 11. まとめ

- かばう表示のトリガは、ダメージ配列の小数部を使う shield 判定
- 表示先は被弾艦ではなく、同一グループの旗艦バナー
- モーションは shield 有無で専用分岐する
- 雷撃戦と開幕雷撃の敵側 isShield 系は、実装上 api_fydam 系配列を参照する
- 航空戦 Stage3 経路では shield は発生しない（常に false）

## 12. 判定再現アルゴリズム

次の手順で、資料から shield 判定をそのまま再現できる。

1. phase を判定する。
2. phase が 砲撃戦（昼/夜）なら、shield(idx) を damages[idx] の小数部で判定する。
3. phase が 雷撃戦なら、friend 側は api_fydam[idx]、enemy 側も api_fydam[idx] で判定する。
4. phase が 開幕雷撃なら、friend 側は api_fydam_list_items[idx][0]、enemy 側も api_fydam_list_items[idx][0] で判定する。
5. phase が 開幕雷撃の複数ヒットなら、multiShield_* を api_fydam_list_items[idx][k] の小数部で判定する。
6. phase が 航空戦 Stage3 なら、shield(idx)=false を返す。
7. shield(idx)=true のときだけ、表示先を defender の所属グループ旗艦 index 0 に固定して showShieldAtBanner を実行する。
8. defender 側バナーには moveAtDamage(shield(idx)) を渡す。
