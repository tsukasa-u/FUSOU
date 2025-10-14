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

このページではFUSOU-APPでHTTPSを設定する方法について説明します。

## 前提知識

### httpsとMITM攻撃

HTTPS (HyperText Transfer Protocol Secure) は、HTTP通信をSSL/TLSプロトコルで暗号化することで、通信の安全性とプライバシーを確保するためのプロトコルです。HTTPSを使用することで、データの盗聴や改ざん、なりすましを防止できます。
特にログインが必要なWebサービスや、個人情報を扱うサイトでは、HTTPSの利用が必須であり、httpsで通信するwebsiteではアドレスバーの左側に鍵マークが表示されます。

仮に、httpsを利用しない場合、通信内容が暗号化されず、平文で通信されるため、第三者がその内容をかんたんに傍受することができます。これを利用したのが、MITM（Man-in-the-Middle）攻撃です。日本語で中間者攻撃といいます。MITM攻撃では、攻撃者が通信の途中に割り込み、ユーザーとサーバー間の通信を盗聴したり、改ざんしたりすることが可能になります。

このMITMによるなりすましでは、攻撃者がユーザーとサーバーの間に割り込み、ユーザーに偽のサーバー証明書を提示することで、ユーザーが攻撃者を正当なサーバーと誤認し、通信を続行させることができます。これを防ぐためには、サーバー証明書が信頼できる認証局（CA）によって発行されていることを確認する必要があります。この認証局は、ブラウザやOSにあらかじめ組み込まれている信頼されたCAのリストを参照して、サーバー証明書の有効性を検証しますが、利用者が意図的に信頼されていないCAをインストールし、インスールしたCAが保証するサーバー証明書を信頼するように設定することも可能です。

実際、攻撃手法に分類される手段ではありますが、利用者が意図的にMITMを利用することもあります。例えば、企業が従業員のネットワークアクセスを監視したり、制限したりするために、プロキシサーバーを設置し、通信を中継させることがあります。この場合、企業は従業員の通信内容を監視することができます。

このように、攻撃手段としても、管理手段としても利用されるMITMですが、2025年10月15日現在、艦これのエコシステムにおける専用ブラウザ(専ブラ)では、このMITMを利用してhttp通信を傍受しAPIリクエストを抽出し、ゲーム内データを表示しています。

さて、FUSOU-APPも例外にもれず、MITMを利用してhttp通信を傍受し、APIリクエストを抽出しています。FUSOU-APPでは、MITMを実現するために、ローカルプロキシサーバーを起動し、ブラウザのプロキシ設定をFUSOU-APPのローカルプロキシサーバーに向けることで、通信を中継させています。

### 艦これのhttps対応

艦これサーバーがhttpsに対応するために2025年10月16日に一日メンテを行うことが発表されました。これにより、艦これの通信はすべてhttpsで暗号化されるようになります。これに伴い、FUSOU-APPもhttpsに対応する必要があります。他、エコシステムにおいて事前のhttps化の告知により、各開発レポジトリにおいてもhttps対応のためのissueやPRが作成され、https対応が着々と進められていたことが伺えます。

## FUSOU-APPでのhttps対応

FUSOU-APPでは、https対応のために、以下の手順で設定を行います。ユーザーが行う必要があるのは、https通信をプロキシーするためのサーバー証明書をインストールすることです。ここまで聞くと、難しそうに感じるかもしれませんが、FUSOU-APPではこの手順をできるだけ簡単にするために、アプリケーション内でサーバー証明書の生成とインストールを半自動化しています。[^1]

[^1]: 利用者が独自にサーバー証明書を用意し、FUSOU-APPにインポートすることも可能です。この場合、FUSOU-APPの設定画面で「カスタム証明書を使用する」を有効にし、証明書ファイルを指定します。

認証局情報はUFSOUの初回起動時にインストールされます。

### Windowsでの証明書インストール

1. FUSOUを起動します。
2. システムトレイのFUSOUアイコンを右クリックし、`Open Launch Page`をクリックします。
3. FUSOUの起動ページが開きます。
4. `Run Proxy Server` が`On`になっていることを確認します。
5. `Start`ボタンをクリックすると、ローカルプロキシサーバーが起動します。このとき、ローカル認証局の証明書をインストールするかどうかの確認ダイアログが表示されます。
6. `はい`をクリックして、証明書をインストールします。これにより、FUSOU-APPが生成したサーバー証明書が信頼されるようになります。

### Linuxでの証明書インストール

1. FUSOUを起動します。
2. システムトレイのFUSOUアイコンを右クリックし、`Open Launch Page`をクリックします。
3. FUSOUの起動ページが開きます。
4. `Run Proxy Server` が`On`になっていることを確認します。
5. `Start`ボタンをクリックすると、ローカルプロキシサーバーが起動します。このとき、ローカル認証局の証明書をインストールするためのコマンドを実行するためのダイアログが表示されます。パスワードを求められるので、ユーザーのパスワードを入力します。
6. 証明書がインストールされると、FUSOU-APPはhttps通信を正しくプロキシできるようになります。

これで、FUSOU-APPはhttps通信を正しくプロキシできるようになります。

### macOSでの証明書インストール

macOS版FUSOU-APPは開発中です。開発者自身がmacOSユーザーでないため、開発が遅れています。macOS版FUSOU-APPのリリースまでしばらくお待ちください。

## バックエンドで認証局をインストールするとき何を行っているのか

FUSOU-APPでは認証局情報を生成する際にRustの`rcgen`クレート[^2]を使用しています。[^3]

[^2]: Rustではクレートとは、Rustのパッケージ管理システムであるCargoで管理されるライブラリやバイナリのことを指します。

[^3]: [rcgen](https://crates.io/crates/rcgen)

このクレートは、X.509 証明書を生成するシンプルなライブラリです。

FUSOU-APPがローカル認証局の証明書をインストールするとき、以下のコマンドを実行しています。

```bash
# Windows
certutil -user -addstore -f Root "C:\path\to\your\certificate.pem"

# Linux
sudo apt install -y ca-certificates
sudo cp /path/to/your/certificate.crt /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

Windowsでは`certutil`コマンドを使用して、証明書をシステムの信頼されたルート証明書ストアに追加しています。`certutil`はWindowsに標準で搭載されているコマンドラインツールで、証明書の管理を行うことができます。\
ここでは、`-user`オプションを指定することで、現在のユーザーの証明書ストアに証明書を追加しています。\
`-addstore`オプションは、証明書を指定したストアに追加するためのもので、`Root`は信頼されたルート証明書ストアを指します。\
`-f`オプションは、同じ名前の証明書が既に存在する場合に上書きすることを意味します。

Linuxでは、まず`ca-certificates`パッケージがインストールされていることを確認します。\
次に、証明書を`/usr/local/share/ca-certificates/`ディレクトリにコピーします。\
最後に、`update-ca-certificates`コマンドを実行して、システムの信頼された証明書ストアを更新します。\
さらにいうと、Linuxではインストールの処理を行う前に、すでに証明書がインストールされているかどうかを確認しています。

これにより、FUSOU-APPが生成したサーバー証明書が信頼されるようになります。

## まとめ

FUSOU-APPでHTTPSを設定するためには、ローカル認証局の証明書をインストールする必要があります。FUSOU-APPでは、この手順をできるだけ簡単にするために、アプリケーション内でサーバー証明書の生成とインストールを半自動化しています。これにより、ユーザーは簡単にHTTPSを設定し、安全な通信を確保できます。
HTTPSの設定が完了したら、FUSOU-APPはhttps通信を正しくプロキシできるようになります。

## 参考情報

- [艦これ公式Twitterによるhttps対応の告知](https://x.com/KanColle_STAFF/status/1976872441613107360)
- [certutil](https://learn.microsoft.com/ja-jp/windows-server/administration/windows-commands/certutil)
- [update-ca-certificates](https://manpages.debian.org/buster/ca-certificates/update-ca-certificates.8.en.html)
- [add_store.bat](https://github.com/tsukasa-u/FUSOU/blob/fusou-v0.3.2/packages/FUSOU-PROXY/proxy-https/cmd/add_store.bat)
- [add_store.sh](https://github.com/tsukasa-u/FUSOU/blob/fusou-v0.3.2/packages/FUSOU-PROXY/proxy-https/cmd/add_store.sh)
- [check_store.sh](https://github.com/tsukasa-u/FUSOU/blob/fusou-v0.3.2/packages/FUSOU-PROXY/proxy-https/cmd/check_ca.sh)
