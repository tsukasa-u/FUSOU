![FUSOU](docs/images/title.png)

# FUSOU

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/tsukasa-u/FUSOU)
[![Static Badge](https://img.shields.io/badge/docs.rs-tsukasa--u%2FFUSOU-blue?logo=docsdotrs)](https://tsukasa-u.github.io/FUSOU/app/index.html)
[![docs](https://github.com/tsukasa-u/FUSOU/actions/workflows/export_doc.yml/badge.svg?branch=dev)](https://github.com/tsukasa-u/FUSOU/actions/workflows/export_doc.yml)
[![build](https://github.com/tsukasa-u/FUSOU/actions/workflows/check_build.yml/badge.svg?branch=dev)](https://github.com/tsukasa-u/FUSOU/actions/workflows/check_build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

FUSOU is a simple data viewer for [Kantai Collection](https://games.dmm.com/detail/kancolle) (艦隊これくしょん -艦これ-).<br>
The goal of this app is to display only the data that users can normally obtain through regular gameplay and to perform analysis using that data, unlike other similar apps.

FUSOU は [艦隊これくしょん](https://games.dmm.com/detail/kancolle) の簡易データ閲覧アプリです。<br>
このアプリは他の類似アプリと異なり、ユーザーが通常のプレイで取得し得るデータのみを表示し、そのデータを用いた解析を行うことを目標としています。

## Demo

![FUSOU Demo](docs/images/fusou-app-demo.gif)

## Download

Windows(latest) and Linux(latest-LTS)(x64, arm64) are supported.<br>
macOS is not supported because I don't have a mac.<br>
You can download the latest release from [Releases · tsukasa-u/FUSOU (github.com)](https://github.com/tsukasa-u/FUSOU/releases/latest)

Windows(最新)と Linux(最新-LTS)(x64, arm64)に対応しています。<br>
macOS は持っていないので対応していません。<br>
最新リリースは [Releases · tsukasa-u/FUSOU (github.com)](https://github.com/tsukasa-u/FUSOU/releases/latest)

## What for? 何のために？

I want to use a minimal data viewer for playing Kancolle, so I decided to make one.
And finally, I want to analyze data such as detailed battle results to improve my war record and make my database. In the future, I want to analyze all the data gathered from all users.
Furthermore, I can't rely on the analyzed data because such data is a lot on the internet, and few of them can misanalyzed. I can't determine which is true.

ユーザーが通常のプレイで取得し得るデータのみで艦これを遊びたいため、自作しようと決意した。ゆくゆくは、集めたデータを解析し、戦績向上、自分のためのデータベースを構築しようと考えている。さらに、このアプリを多数の方が利用してくれるのであれば、全体のデータを用いた解析も考えている。さらに言えば、ネット上には情報が散乱しているように感じ(自分の調査不足ではある)、ソースの出どころやその情報自体が確かなのかがよくわからない。

## System Configuration システム構成

FUOSU-PROXY : <br>
&emsp; proxy http communication via proxy server. https communication supported<br>
&emsp; プロキシサーバを経由して http 通信を中継. https 通信に対応

FUSOU-APP : <br>
&emsp; A simple in-game data viewer<br>
&emsp; 簡易なゲーム内データ閲覧用

FUSOU-WEB : <br>
&emsp; Data viewer for analyzed data<br>
&emsp; 解析データ閲覧用

## Enviroment Variables Management

We use [dotenvx](https://dotenvx.com/) to securely manage and encrypt environment variables for both local development and deployment. dotenvx enables encrypted `.env` files, making it easy to sync, share, and integrate environment variables across different environments and CI/CD pipelines while ensuring sensitive information remains protected.

| カテゴリ      | 変数名                                                        | 用途                               |
| ------------- | ------------------------------------------------------------- | ---------------------------------- |
| Supabase 認証 | VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY                     | フロントエンドからの Supabase 接続 |
| SupabaseDB    | SUPABASE_DATABASE_URL                                         | バックエンドからのデータベース接続 |
| Google OAuth  | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET                        | Google 認証                        |
| Discord RPC   | DISCORD_CLIENT_ID                                             | Discord Rich Presence 統合         |
| Tauri 署名    | TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD | アプリケーション署名               |

## Set up FUSOU-APP for Dev

### PreRequirement 事前準備

- pnpm (https://pnpm.io/en/installation)
- rust (https://rust-lang.org/en/tools/install/)
  - just (Optional) (https://crates.io/crates/just)

### 1. install module

run on terminal

```
cd "your-path-to-FUSOU"
pnpm install
```

### 2. (install dependencies for linux)

on Linux(Ubuntu), you have to install additional library

```
apt install libsoup-gnome2.4-dev libjavascriptcoregtk-4.0-dev libwebkit2gtk-4.0-dev
```

for v2, install library as tauri installation gaide and additionally install this library

```
apt install libayatana-appindicator3-dev
apt install librsvg2-dev
```

### 3. build shared-ui library

run on terminal

```
cd "your-path-to-FUSOU"/packages/shared-ui
pnpm build
pnpm install
```

### 4. launch tauri

run on terminal

```
cd "your-path-to-FUSOU"/packages/FUSOU-APP
pnpm tuari dev
```

## My idea 考えていること

I think the in-game data such as parameters like hp and equipment and analyzed data we cannot access normally should be separated locally and online. This means you can only view data you can normally access in a game with a local app and can access data analyzed or not normally accessible by the website.

HP や装備などのユーザがアクセスできるパラメータと、普段はアクセスできない分析データなどのゲーム内データは、ローカルとオンラインで分離するほうが望ましいのではないかと考えている。ゲーム内で普段アクセスできるデータはローカルアプリでのみ表示し、ウェブサイトでは分析データや普段はアクセスできないデータにアクセスできるようなシステムを構築したい。

# In the Future 今後

~~I improve my App to be able to use for playing Kancolle. And then, add code for data analysis.~~
I'm going to code data analysis because I released the app.

~~艦これをプレイすることができる状態まで開発を続けます。その後はデータ解析のプログラムをかく予定です。~~
リリースしたので、今後はデータ解析のプログラムをかく予定です。
