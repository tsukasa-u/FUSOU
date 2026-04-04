---
title: 索敵演出の代表機選定
description: >-
  battle PhaseSakuteki における索敵演出の代表機選定ロジックを整理したメモ。api_search による索敵成否判定と、装備索敵値 + sqrt(改修値) による代表機選定を分離して説明する。
contributors: ["github-copilot"]
date: 2026-04-04
slug: formulas/sakuteki_cutin_plane_selection
tags: [formulas, sakuteki, cutin, improvement, battle]
---

# 索敵演出の代表機選定

## 概要

`packages/equip_synergy_detector/output/deobfuscated.js` の battle `PhaseSakuteki` には、
索敵演出に使用する代表機を選ぶロジックがある。

ここで重要なのは、次の 2 つが **別処理** だという点である。

1. 索敵が成功したかどうか
2. 索敵演出でどの機体を飛ばすか

前者は戦闘データの `api_search` を読むだけであり、このコードでは再計算していない。
後者だけが `装備索敵値 + sqrt(改修値)` の比較で決まる。

---

## 情報源

- 実装: `main.js`
- 主要クラス: `PhaseSakuteki`, `SakutekiData`

---

## 1. 索敵成功判定

### 1-1. 判定元データ

索敵成功判定は `SakutekiData` が戦闘データの `api_search` をそのまま読んでいる。

```ts
_data_f = api_search[0]
_data_e = api_search[1]
```

### 1-2. 成功判定

```ts
isSuccess(value) = value == 1 || value == 2 || value == 5
```

### 1-3. 索敵機あり判定

```ts
hasPlane(value) = value == 1 || value == 2 || value == 3 || value == 4
```

### 1-4. 未帰還機あり判定

```ts
hasMikikan(value) = value == 2 || value == 3
```

### 1-5. 結論

- 索敵成功かどうかは `api_search` の受信結果で決まる
- このコード内では Formula 33 や索敵値合計を再計算していない
- `sqrt(改修値)` は **索敵成功判定には使われない**

---

## 2. 代表機選定ロジック

### 2-1. 呼ばれる条件

`PhaseSakuteki._startSakuteki()` では、味方側に索敵機ありと判定された場合だけ代表機選定が呼ばれる。

```ts
if (record.raw.sakuteki.hasPlane_f() == 1) {
  const slot = _searchEquipedSlotitems()
  _loadPlaneImage(slot)
}
```

### 2-2. 候補条件

候補になる装備は次の条件を満たすものだけである。

- 味方艦隊に装備されている
- 装備種別が `PlaneConst.SAKUTEKI` に含まれる
- そのスロットの搭載数が 1 以上

`PlaneConst.SAKUTEKI` には、艦上偵察機・水上偵察機・水上爆撃機・大型飛行艇・噴式偵察機などの索敵演出対象カテゴリが入る。

### 2-3. 評価式

各候補の評価値は次式で計算される。

$$
score = sakuteki + \sqrt{level}
$$

- `sakuteki`: 装備マスタが持つ素の索敵値
- `level`: 装備個体の改修値（★0〜10）

### 2-4. 選び方

候補の中から `score` が最大の 1 機を選ぶ。

これは確率処理ではなく、単純な最大値選択である。

```ts
if (score > maxScore) {
  maxScore = score
  selected = slot
}
```

### 2-5. 特例除外

選ばれた装備が `mst_id == 25` の場合は `null` に戻される。

その場合は専用機画像ではなく、汎用の索敵機スプライトが使われる。

---

## 3. 選ばれた後に何が起こるか

選ばれた装備は `_loadPlaneImage()` に渡され、装備 `mst_id` に対応する `item_up` 画像が読み込まれる。

その後 `_flyPlane()` で索敵カットインの飛行演出に使われる。

### 3-1. 実際に変わるもの

- 索敵演出で飛ぶ機体画像
- 機体の見た目のスケール補正
- どの索敵機が「代表機」として扱われるか

### 3-2. 変わらないもの

- 索敵成功か失敗か
- `api_search` の値
- ルート分岐判定
- 触接判定
- 装備画面や艦娘詳細画面で見える索敵値の表示

---

## 4. ユーザーから見える効果

この式による効果は **見た目上はあるが、索敵結果そのものではない**。

ユーザーが確認できる違いは、索敵演出で採用される代表機が変わる点である。

たとえば、同じ素索敵値 8 の水偵が 2 つあるとする。

- A: 素索敵 8, ★0
- B: 素索敵 8, ★9

このとき評価値は次のようになる。

$$
A = 8 + \sqrt{0} = 8
$$

$$
B = 8 + \sqrt{9} = 11
$$

そのため B が代表機として選ばれ、索敵カットインでは B の機体画像が優先される。

ただし、このドキュメント対象コードからは「B を積んでいるから索敵成功率が上がる」とは言えない。

---

## 5. 実装上の意味

このロジックは、索敵判定の本体式ではなく、**演出に表示する代表索敵機を自然に選ぶための補助式** と解釈するのが妥当である。

整理すると次の通り。

- 索敵成否: `api_search` の受信結果
- 索敵演出の代表機: `装備索敵値 + sqrt(改修値)` の最大値

したがって、改修値の影響先は「索敵演出の見た目」であり、少なくともこのコード範囲では「索敵本体の成功計算」ではない。
