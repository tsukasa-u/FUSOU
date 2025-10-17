---
title: Set up HTTPS for FUSOU
contributors: ["tsukasa-u"]
description: >-
  FUSOU-APPが艦これHTTPS化に対応するために必要なHTTPSとMITMの基礎知識、ローカル認証局の扱い、Windows・Linuxでの証明書インストール方法、バックエンドで実行される処理を包括的に解説するガイド
date: 2025-10-15
slug: guide/set_https
tags: [guide, https]
---

# Set up HTTPS for FUSOU-APP

> [!IMPORTANT]
> 2025/10/17/19:00 現在、FUSOU-APP は TLS Connection を確立できず、艦これサーバーとの通信ができない問題が発生しています。この問題は FUSOU-APP のバグであり、現在修正中です。修正が完了次第、本ドキュメントを更新します。

このページでは FUSOU-APP で HTTPS を設定する方法について説明します。

## 前提知識

### https と MITM 攻撃

HTTPS (HyperText Transfer Protocol Secure) は、HTTP 通信を SSL/TLS プロトコルで暗号化することで、通信の安全性とプライバシーを確保するためのプロトコルです。HTTPS を使用することで、データの盗聴や改ざん、なりすましを防止できます。
特にログインが必要な Web サービスや、個人情報を扱うサイトでは、HTTPS の利用が必須であり、https で通信する website ではアドレスバーの左側に鍵マークが表示されます。

仮に、https を利用しない場合、通信内容が暗号化されず、平文で通信されるため、第三者がその内容をかんたんに傍受することができます。これを利用したのが、MITM（Man-in-the-Middle）攻撃です。日本語で中間者攻撃といいます。MITM 攻撃では、攻撃者が通信の途中に割り込み、ユーザーとサーバー間の通信を盗聴したり、改ざんしたりすることが可能になります。

この MITM によるなりすましでは、攻撃者がユーザーとサーバーの間に割り込み、ユーザーに偽のサーバー証明書を提示することで、ユーザーが攻撃者を正当なサーバーと誤認し、通信を続行させることができます。これを防ぐためには、サーバー証明書が信頼できる認証局（CA）によって発行されていることを確認する必要があります。この認証局は、ブラウザや OS にあらかじめ組み込まれている信頼された CA のリストを参照して、サーバー証明書の有効性を検証しますが、利用者が意図的に信頼されていない CA をインストールし、インスールした CA が保証するサーバー証明書を信頼するように設定することも可能です。

実際、攻撃手法に分類される手段ではありますが、利用者が意図的に MITM を利用することもあります。例えば、企業が従業員のネットワークアクセスを監視したり、制限したりするために、プロキシサーバーを設置し、通信を中継させることがあります。この場合、企業は従業員の通信内容を監視することができます。

このように、攻撃手段としても、管理手段としても利用される MITM ですが、2025 年 10 月 15 日現在、艦これのエコシステムにおける専用ブラウザ(専ブラ)では、この MITM を利用して http 通信を傍受し API リクエストを抽出し、ゲーム内データを表示しています。

さて、FUSOU-APP も例外にもれず、MITM を利用して http 通信を傍受し、API リクエストを抽出しています。FUSOU-APP では、MITM を実現するために、ローカルプロキシサーバーを起動し、ブラウザのプロキシ設定を FUSOU-APP のローカルプロキシサーバーに向けることで、通信を中継させています。

### 艦これの https 対応

艦これサーバーが https に対応するために 2025 年 10 月 16 日に一日メンテを行うことが発表されました。これにより、艦これの通信はすべて https で暗号化されるようになります。これに伴い、FUSOU-APP も https に対応する必要があります。他、エコシステムにおいて事前の https 化の告知により、各開発レポジトリにおいても https 対応のための issue や PR が作成され、https 対応が着々と進められていたことが伺えます。

## FUSOU-APP での https 対応

FUSOU-APP では、https 対応のために、以下の手順で設定を行います。ユーザーが行う必要があるのは、https 通信をプロキシーするためのサーバー証明書をインストールすることです。ここまで聞くと、難しそうに感じるかもしれませんが、FUSOU-APP ではこの手順をできるだけ簡単にするために、アプリケーション内でサーバー証明書の生成とインストールを半自動化しています。[^1]

[^1]: 利用者が独自にサーバー証明書を用意し、FUSOU-APP にインポートすることも可能です。この場合、FUSOU-APP の設定画面で「カスタム証明書を使用する」を有効にし、証明書ファイルを指定します。

認証局情報は UFSOU の初回起動時にインストールされます。

### Windows での証明書インストール

1. FUSOU を起動します。
2. システムトレイの FUSOU アイコンを右クリックし、`Open Launch Page`をクリックします。
3. FUSOU の起動ページが開きます。
4. `Run Proxy Server` が`On`になっていることを確認します。
5. `Start`ボタンをクリックすると、ローカルプロキシサーバーが起動します。このとき、ローカル認証局の証明書をインストールするかどうかの確認ダイアログが表示されます。
6. `はい`をクリックして、証明書をインストールします。これにより、FUSOU-APP が生成したサーバー証明書が信頼されるようになります。

### Linux での証明書インストール

1. FUSOU を起動します。
2. システムトレイの FUSOU アイコンを右クリックし、`Open Launch Page`をクリックします。
3. FUSOU の起動ページが開きます。
4. `Run Proxy Server` が`On`になっていることを確認します。
5. `Start`ボタンをクリックすると、ローカルプロキシサーバーが起動します。このとき、ローカル認証局の証明書をインストールするためのコマンドを実行するためのダイアログが表示されます。パスワードを求められるので、ユーザーのパスワードを入力します。
6. 証明書がインストールされると、FUSOU-APP は https 通信を正しくプロキシできるようになります。

これで、FUSOU-APP は https 通信を正しくプロキシできるようになります。

### macOS での証明書インストール

macOS 版 FUSOU-APP は開発中です。開発者自身が macOS ユーザーでないため、開発が遅れています。macOS 版 FUSOU-APP のリリースまでしばらくお待ちください。

## バックエンドで認証局をインストールするとき何を行っているのか

FUSOU-APP では認証局情報を生成する際に Rust の`rcgen`クレート[^2]を使用しています。[^3]

[^2]: Rust ではクレートとは、Rust のパッケージ管理システムである Cargo で管理されるライブラリやバイナリのことを指します。
[^3]: [rcgen](https://crates.io/crates/rcgen)

このクレートは、X.509 証明書を生成するシンプルなライブラリです。

FUSOU-APP がローカル認証局の証明書をインストールするとき、以下のコマンドを実行しています。

```bash
# Windows
certutil -user -addstore -f Root "C:\path\to\your\certificate.pem"

# Linux
sudo apt install -y ca-certificates
sudo cp /path/to/your/certificate.crt /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

Windows では`certutil`コマンドを使用して、証明書をシステムの信頼されたルート証明書ストアに追加しています。`certutil`は Windows に標準で搭載されているコマンドラインツールで、証明書の管理を行うことができます。\
ここでは、`-user`オプションを指定することで、現在のユーザーの証明書ストアに証明書を追加しています。\
`-addstore`オプションは、証明書を指定したストアに追加するためのもので、`Root`は信頼されたルート証明書ストアを指します。\
`-f`オプションは、同じ名前の証明書が既に存在する場合に上書きすることを意味します。

Linux では、まず`ca-certificates`パッケージがインストールされていることを確認します。\
次に、証明書を`/usr/local/share/ca-certificates/`ディレクトリにコピーします。\
最後に、`update-ca-certificates`コマンドを実行して、システムの信頼された証明書ストアを更新します。\
さらにいうと、Linux ではインストールの処理を行う前に、すでに証明書がインストールされているかどうかを確認しています。

これにより、FUSOU-APP が生成したサーバー証明書が信頼されるようになります。

## まとめ

FUSOU-APP で HTTPS を設定するためには、ローカル認証局の証明書をインストールする必要があります。FUSOU-APP では、この手順をできるだけ簡単にするために、アプリケーション内でサーバー証明書の生成とインストールを半自動化しています。これにより、ユーザーは簡単に HTTPS を設定し、安全な通信を確保できます。
HTTPS の設定が完了したら、FUSOU-APP は https 通信を正しくプロキシできるようになります。

## 参考情報

- [艦これ公式 Twitter による https 対応の告知](https://x.com/KanColle_STAFF/status/1976872441613107360)
- [certutil](https://learn.microsoft.com/ja-jp/windows-server/administration/windows-commands/certutil)
- [update-ca-certificates](https://manpages.debian.org/buster/ca-certificates/update-ca-certificates.8.en.html)
- [add_store.bat](https://github.com/tsukasa-u/FUSOU/blob/fusou-v0.3.2/packages/FUSOU-PROXY/proxy-https/cmd/add_store.bat)
- [add_store.sh](https://github.com/tsukasa-u/FUSOU/blob/fusou-v0.3.2/packages/FUSOU-PROXY/proxy-https/cmd/add_store.sh)
- [check_store.sh](https://github.com/tsukasa-u/FUSOU/blob/fusou-v0.3.2/packages/FUSOU-PROXY/proxy-https/cmd/check_ca.sh)
