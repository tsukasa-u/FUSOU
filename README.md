# FUSOU

![FUSOU](image.png)

## What for? 何のために？
I want to use a minimal data viewer for playing Kancolle, so I decided to make one.
And finally, I want to analyze data such as detailed battle results to improve my war record and make my database. In the future, I want to analyze all the data gathered from all users.
Furthermore, I can't rely on the analyzed data because such data is a lot on the internet, and few of them can misanalyzed. I can't determine which is true.

ユーザーが通常のプレイで取得し得るデータのみで艦これを遊びたいため、自作しようと決意した。ゆくゆくは、集めたデータを解析し、戦績向上、自分のためのデータベースを構築しようと考えている。さらに、このアプリを多数の方が利用してくれるのであれば、全体のデータを用いた解析も考えている。さらに言えば、ネット上には情報が散乱しているように感じ(自分の調査不足ではある)、ソースの出どころやその情報自体が確かなのかがよくわからない。

## System Configuration システム構成
FUOSU-PROXY : <br>
&emsp; proxy http communication via proxy server<br>
&emsp; プロキシサーバを経由してhttp通信を中継

FUSOU-APP : <br>
&emsp; A simple in-game data viewer<br>
&emsp; 簡易なゲーム内データ閲覧用

FUSOU-WEB : <br>
&emsp; Data viewer for analyzed data<br>
&emsp; 解析データ閲覧用

## My idea 考えていること
I think the in-game data such as parameters like hp and equipment and analyzed data we cannot access normally should be separated locally and online. This means you can only view data you can normally access in a game with a local app and can access data analyzed or not normally accessible by the website.

HPや装備などのユーザがアクセスできるパラメータと、普段はアクセスできない分析データなどのゲーム内データは、ローカルとオンラインで分離する必要があると考えている。ゲーム内で普段アクセスできるデータはローカルアプリでのみ表示し、ウェブサイトでは分析データや普段はアクセスできないデータにアクセスできるようなシステムを構築したい。

# In the Future 今後
I improve my App to be able to use for playing Kancolle. And then, add code for data analysis.

艦これをプレイすることができる状態まで開発を続けます。その後はデータ解析のプログラムをかく予定です。
