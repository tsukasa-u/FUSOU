---
title: Install FUSOU
contributors: ["tsukasa-u"]
description: >-
  FUSOU-APPをWindowsおよびLinux各ディストリビューションで導入するためのインストーラー選択指針、OSとアーキテクチャの判別方法、AppImage・deb・rpmそれぞれの具体的なインストール手順をまとめたガイド
date: 2025-10-17
slug: start/install
tags: [start, install]
---

# Install FUSOU-APP

このページでは FUSOU-APP のインストローラーのダウンロード方法について説明します。

Windows 向けには`.msi`および`.exe`形式のインストーラーが提供されています。

Linux 向けには以下のパッケージ形式が提供されています:

| パッケージ形式 (拡張子) | 対応ディストリビューション                             |
| ----------------------- | ------------------------------------------------------ |
| `.deb`                  | Debian, Ubuntu, Linux Mint, Pop!\_OS (Debian 系)       |
| `.rpm`                  | RHEL, Fedora, CentOS, openSUSE, AlmaLinux (Red Hat 系) |
| `.AppImage`             | ユニバーサル (ディストリビューション非依存)            |

どのパッケージ形式を選べば良いかわからない場合は、以下のディストリビューション、アーキテクチャの判別方法を参考にしてください。

## 対応環境と OS・アーキテクチャの判別

- Windows: Windows 10 以降 (64bit) x86_64 / arm64 に対応 (`.msi`, `.exe`)
- Linux: x86_64 / arm64 に対応 (`.AppImage`, `.deb`, `.rpm`)

### Windows での確認方法

```cmd
# コマンドプロンプト
echo %PROCESSOR_ARCHITECTURE%
# AMD64 (x86_64) OR ARM64
```

### Linux での確認方法

```bash
# アーキテクチャ
$ uname -m

# ディストリビューション
$ grep ^NAME= /etc/os-release
```

## ダウンロードとインストール方法

1. [FUSOU-APP のリリースページ](https://github.com/tsukasa-u/FUSOU/releases/latest) もしくは [ダウンロードページ](/download) にアクセスします。
2. 最新のリリースを見つけて、適切なインストーラーをダウンロードします。
3. ダウンロードしたファイルを実行して、インストールを完了させます。

## Windows（.exe）でのインストール手順

1. 最新の`fusou-windows-x64.exe`をダウンロード後、実行します。
2. セットアップウィザードの案内に従い、インストール先を確認して進めます。
3. 完了後、スタートメニューに追加された FUSOU を起動します。

## Windows（.msi）でのインストール手順

1. 最新の`fusou-windows-x64.msi`をダウンロード後、実行します。
2. セットアップウィザードの案内に従い、インストール先を確認して進めます。
3. 完了後、スタートメニューに追加された FUSOU を起動します。

## Linux `.AppImage` でのインストール

1. `fusou-linux-<arch>.AppImage` をダウンロードします。
2. ファイルに実行権限を付与します。

   ```bash
   chmod a+x fusou-linux-<arch>.AppImage
   ```

3. 実行します。

   ```bash
   $./fusou-linux-<arch>.AppImage
   ```

## Debian 系 (Ubuntu 等) `.deb` パッケージ

### `apt` を用いたインストール

1. `fusou-linux-<arch>.deb` をダウンロードします。
2. 依存関係を満たすためにリポジトリを更新します。

   ```bash
   sudo apt update
   ```

3. パッケージをインストールします。

   ```bash
   sudo apt install -f ./fusou-linux-<arch>.deb
   ```

4. 起動確認:

   ```bash
   fusou
   ```

### `dpkg` を用いたインストール

1. `fusou-linux-<arch>.deb` をダウンロードします。
2. `dpkg` コマンドでインストールします。

   ```bash
   sudo dpkg -i ./fusou-linux-<arch>.deb
   ```

3. 起動確認:

   ```bash
   fusou
   ```

## RPM 系 (Fedora, CentOS 等) `.rpm` パッケージ

1. ダウンロードした `fusou-linux-<arch>.rpm` を実行します。
2. DNF または Zypper を用いてインストールします。

   ```bash
   sudo dnf install ./fusou-linux-<arch>.rpm
   # もしくは
   sudo zypper install ./fusou-linux-<arch>.rpm
   ```

3. SELinux が有効な環境ではコンテキストを確認します。

   ```bash
   sudo restorecon -Rv /opt/fusou-app
   ```
