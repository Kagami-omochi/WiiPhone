# phone-gyro-mouse

スマホのジャイロセンサー(角速度)を使って、PCのマウスカーソルを操作するツールです。
「中心」や「校正」は一切持たず、実物のマウスと同じく **その瞬間に動いた分だけカーソルへ足す** だけの単純な設計です。

## 仕組み・設計メモ

- **使うセンサーはジャイロ(`rotationRate`)のみ**。加速度センサーの値を2回積分して位置を出す方式も検討しましたが、ノイズや重力成分の影響で誤差が蓄積して勝手にドリフトしてしまい、結局どこかで「中心に戻す＝校正」が必要になります。角速度(deg/s)× 経過時間をそのまま今回のフレームの移動量として毎回加算するだけなら、蓄積誤差が起きず、実物の光学マウスが「動いた量だけを都度報告する」のと同じ挙動になります。地磁気センサー・加速度センサーは今回は未使用ですが、`public/app.js` の `handleMotion` を書き換えれば自由に追加できます。
- スマホの `DeviceMotionEvent` はブラウザの仕様上 **HTTPS(セキュアコンテキスト)でしか使えません**。HTTPのままローカルIPへアクセスするだけではセンサーの値が一切取れないため、初回起動時にNode側で自己署名証明書を自動生成し、HTTPSで待ち受けるようにしています。スマホでアクセスすると証明書の警告画面が出ますが、自分のPC宛てなので「詳細設定」→「アクセスする(危険性を承知で進む)」で進めば問題ありません。
- 「ここを押さえている間だけ操作を有効にする」領域(engage zone)を用意しています。実物のマウスも持ち上げている間はカーソルが動かないのと同じで、ポケットに入れて歩いた程度の揺れではカーソルが動かないようにするためです。指を離すと即座に無効になります。
- PC側のマウス制御は `ydotool` を利用しています。Waylandコンポジタ(Hyprlandなど)でも動く数少ない入力エミュレーションツールで、`ydotoold` デーモンを介して `/dev/uinput` に相対移動イベントを送ります。絶対座標移動はコンポジタ側のサポートが必要で環境依存が大きいため、今回は一貫して **相対移動のみ** を使っています。

## 必要なもの

- Node.js (v16以上)
- `ydotool` / `ydotoold`
- スマホとPCが同じLAN(Wi-Fi)にいること

### ydotool のセットアップ (Arch / CachyOS)

```bash
sudo pacman -S ydotool
# ユーザーサービスとして ydotoold を起動
systemctl --user enable --now ydotool.service
```

うまく起動しない・`ydotool: failed to connect socket` のようなエラーが出る場合は、ソケットパスの不一致が原因のことが多いです。

```bash
systemctl --user status ydotool.service   # 動いているか確認
# 動いているのにソケットが見つからない場合は環境変数で明示
export YDOTOOL_SOCKET="$XDG_RUNTIME_DIR/.ydotool_socket"
```

`ydotool mousemove --help` を実行して `-x`/`-y` オプションの説明が出れば、`server.js` のコマンドはそのまま使えます。もし手元のバージョンが `mousemove_relative -- <dx> <dy>` のような古い仕様だった場合は、`server.js` の `moveMouse` / `clickButton` / `scrollWheel` 関数内の `runYdotool([...])` の引数だけを書き換えてください。

## インストールと起動

```bash
npm install
npm start
```

起動すると以下のようにアクセス先が表示されます。

```
phone-gyro-mouse が port 8443 で起動しました
同じWi-Fi内のスマホのブラウザで以下を開いてください:
  https://192.168.x.x:8443
```

スマホのブラウザ(Chrome / Safari どちらでも可)でこのURLを開いてください。

1. 証明書の警告が出たら「詳細設定」→「アクセスする」で進む
2. 「開始する」をタップ(iPhoneの場合はセンサー利用の許可ダイアログが出るので許可)
3. 画面の枠(engage zone)を指で押さえたままスマホを傾けるとPCのカーソルが動く
4. 下部のボタンで左クリック・右クリック

歯車アイコンから感度・左右反転・上下反転を調整できます(設定はスマホのブラウザにローカル保存され、次回アクセス時も引き継がれます)。

## ポートを開放したい場合

CachyOSでファイアウォールを有効にしている場合、`8443/tcp` を許可してください。

```bash
# ufw の場合
sudo ufw allow 8443/tcp

# firewalld の場合
sudo firewall-cmd --add-port=8443/tcp --permanent && sudo firewall-cmd --reload
```

ポート番号は `PORT=9000 npm start` のように環境変数で変更できます。

## ファイル構成

```
phone-gyro-mouse/
├── server.js        # HTTPSサーバー + WebSocket + ydotool呼び出し
├── package.json
├── public/
│   ├── index.html    # スマホ側UI
│   ├── style.css
│   └── app.js         # センサー読み取り・WebSocket送信・UI制御
└── certs/             # 初回起動時に自動生成される自己署名証明書(.gitignore対象)
```
