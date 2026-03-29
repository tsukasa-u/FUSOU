---
title: 航空機戦データとスプライトモーション対応
description: >-
  航空機戦の機数データ（count/lostcount）と、画面上のスプライト挙動
  （total/damage/crash）の対応を、分析と実装判断に使える粒度で整理した資料。
contributors: ["github-copilot"]
date: 2026-03-28
slug: formulas/aerial_sprite_mapping
tags: [formulas, aerial combat, sprite, motion, lostcount]
---

## 1. スコープ

この資料は、難読化解除済みクライアントコードで確認できた
航空戦スプライト実装を整理する。

対象コード:

- `packages/equip_synergy_detector/output/deobfuscated.js`

この資料は、次の対応関係を定義する。

- 入力データ: `count`, `lostcount`, `plane_from`
- 表示結果: `sprite_total`, `damage`, `crash`
- 推定可能範囲と推定不能範囲

対象は、開発実装・分析指標設計・UI表示設計で共通して使う解釈ルール。

## 2. 用語

- `count`: サイド全体の機数
- `lost_count_stage1`: Stage1の損失機数
- `lost_count_stage2`: Stage2の損失機数
- `plane_from`: 発艦元インデックス（機数ではない）
- `sprite_total`: 画面上に生成されたスプライト総数
- `power`: 各スプライトに保持される損耗用の内部値（初期値1）
- `crash`: スプライトが墜落状態に遷移した件数

## 3. データ側の基礎式

航空戦データは以下で整理できる。

$$
count\_stage1 = count - lost\_count\_stage1
$$

$$
count\_stage2 = count\_stage1 - lost\_count\_stage2
$$

`lostcount` は機数の損失であり、表示スプライト数そのものではない。

重要:

- 戦闘計算上の航空機損耗は各スロット単位だが、この資料はあくまでクライアント表示実装を扱う
- このクライアント表示実装では、各スロット残数を直接見てスプライト本数を更新していない
- `count/lostcount` は既存スプライトへの損耗配分に使われる

## 4. スプライト総数 (`sprite_total`) の扱い

### 4-1. 観測値（推奨）

画面に生成されたスプライト配列長を `sprite_total` とする。
このクライアントでは、まずこの配列が作られ、以後の損耗は既存要素に対して反映される。

生成時の実装仕様（要点）:

- `plane_from` の各要素は発艦元の艦インデックスとして扱われる
- 1艦あたり描画される機体スプライトは最大3
- 実際のスプライト数は、その艦の航空機系装備スロット数に依存する（0〜3）
- 生成時点では `onslot` や現在搭載数は参照していない
- `plane_from` に同じ艦が複数回あれば、そのたびにその艦の最大3機セットが追加生成される

生成対象判定は、次の順で行われる。

1. `plane_from` で発艦元の艦を選ぶ
2. その艦の装備スロットを先頭から走査する
3. 事前定義された「航空機として描画する装備種別集合」に一致するスロットだけ採用する
4. 採用数が3に達したら、その艦の探索を打ち切る

このため、同じ艦でも「装備順」と「3機上限」の影響で
描画される装備と描画されない装備が分かれる場合がある。

### 4-2. スプライト画像の決定

描画対象として採用された各装備は、装備マスタIDをキーにして画像を引く。

- 通常装備: 装備マスタのアイコン種別を画像キーとして使用
- 敵装備: 敵側用の変換テーブルを通した画像キーを使用

要点:

- 「どの装備を描くか」の判定と「どの画像で描くか」は別段階
- 画像選択段階では、すでに採用済みの装備だけが対象
- したがって、画像差分は選定結果を増減させない

### 4-3. 再計算値（推定）

`plane_from` と装備情報から近似計算できる。

ここでいう装備情報は「どのスロットに航空機系装備が載っているか」を指す。

$$
sprite\_total = \sum_{entry \in plane\_from} \min(3, eligible\_slots(ship(entry)))
$$

注意:

- `eligible_slots` は装備種別フィルタを含む
- `plane_from` は艦インデックス列であり、どのスロットから何機飛ぶかまでは表さない
- 機数は `count/lostcount` 側で扱われ、生成本数の決定には直接使われない
- `plane_from` 欠損時は厳密再計算できない
- 再計算値は観測値の代替ではなく補助値

## 5. `lostcount` から `crash` への変換

表示側は、機数を直接1対1で落とすのではなく、
損失率を既存スプライト群へ配分して `damage/crash` を決める。

この実装では、スロット別残数に応じてスプライト本数を再構成しない。

### 5-1. 損失率

$$
p = \frac{\min(lostcount, count)}{count}
$$

$$
damage\_budget = sprite\_total \times p
$$

### 5-2. 結果の性質

- 同じ `lostcount` でも `crash` 件数は毎回同じとは限らない
- Stage2はStage1で減った各スプライトの `power` を引き継ぐ
- `crash` は演出結果、`lostcount` は記録値という役割分離が必要
- `count/lostcount` は既存スプライトへの配分に使われるため、スロット別枯渇を1対1には表現しない
- したがって「あるスロットが枯れたら対応スプライトが必ず消える」という実装にはなっていない

### 5-3. クラッシュ判定の実装準拠手順

初期状態:

- 各スプライトは `power = 1` で開始

1ステージ分の処理（Stage1/Stage2共通）:

1. `count <= 0` または `lostcount <= 0` なら終了
2. `ratio = min(lostcount, count) / count`
3. `budget = sprite_total * ratio`
4. スプライト配列のコピーからランダムに1件ずつ取り出し
5. 取り出したスプライトの `power > 0` なら
6. `delta = min(budget, power)` を減算
7. `power = power - delta`
8. `power == 0` なら `crash`、`0 < power < 1` なら `damage`
9. `budget <= 0` または候補が尽きたら終了

選択方式:

- 各反復で `Math.random()` により候補から1件を選ぶ
- 選んだ候補は候補配列から除外される（無置換抽出）

重要:

- 1ステージ内では同じスプライトは1回しか処理されない
- Stage2はStage1で減った `power` をそのまま使う（持ち越し）
- Stage2でも新しいスプライト再生成は行わない

### 5-4. Stage適用順

航空戦タスク内では、概ね次順で処理される。

1. Stage1損失反映
2. 対空処理
3. Stage2損失反映

この順序のため、Stage2の見た目はStage1の `power` 残量に依存する。

### 5-5. `damage` と `crash` の見た目差

- `damage`: 機体は残る（煙演出・軌道変化）
- `crash`: 機体は消える（墜落完了）

同じ `lostcount` でも `damage` と `crash` の内訳は固定ではないため、
再生結果の完全一致を前提にした比較は避ける。

## 6. 何が確定できて何が推定になるか

### 6-1. 確定できるもの

- `count`, `lost_count_stage1`, `lost_count_stage2`
- それらから導出される `count_stage1`, `count_stage2`

### 6-2. 条件付きで求まるもの

- `sprite_total` 再計算値（`plane_from` と装備情報が必要）
- `damage_budget` と、その結果として起こりうる `damage/crash` の範囲

### 6-3. 確定できないもの

- `lostcount` のみからの厳密 `crash` 件数
- `plane_from` 欠損時の厳密 `sprite_total`
- サイド合計 `count/lostcount` のみからの「どのスロットが枯れたか」
- スロット別枯渇を反映した見た目

## 7. 指標設計の推奨

同一画面・同一集計で混同を防ぐため、3系統で保持・表示する。

- 記録値: `plane_count_api`, `lost_count_api`
- 観測値: `sprite_total_observed`, `sprite_crash_observed`
- 推定値: `sprite_total_estimated`, `expected_crash_estimated`

推奨表示名:

- 機数損失（記録値）
- 表示クラッシュ（観測値）
- スプライト総数（推定）
- 推定クラッシュ（参考値）

## 8. 一次情報から言える結論

- スプライト生成本数は、`plane_from` と航空機装備スロット数で決まる
- 生成後の損耗反映は、`count/lostcount` を既存スプライトへランダム配分する
- 各スロット残数を直接見て、対応スプライトを減らす実装ではない
- したがって、このクライアント実装に限れば「スロットが枯れたのでそのスロット由来のスプライトが必ず消える」とは言えない
