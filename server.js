'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const express = require('express');
const WebSocket = require('ws');
const selfsigned = require('selfsigned');

const PORT = Number(process.env.PORT) || 8443;
const ROOT = __dirname;
const CERT_DIR = path.join(ROOT, 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

// -------------------------------------------------------------------------
// スマホのセンサーAPI(DeviceMotionEvent)はセキュアコンテキスト(HTTPS)でしか
// 使えない仕様のため、HTTP のローカルIPアクセスだけでは動作しない。
// そのため初回起動時に自己署名証明書を自動生成してHTTPSで待ち受ける。
// スマホ側では初回アクセス時にブラウザの警告画面が出るので「詳細設定」等から
// 進んでもらう必要がある(README参照)。
// -------------------------------------------------------------------------
async function ensureCertificate() {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
  }
  console.log('[setup] 証明書が見つからないので自己署名証明書を生成します(初回のみ)...');
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: 'phone-gyro-mouse.local' }],
    { keySize: 2048, algorithm: 'sha256', days: 3650 }
  );
  fs.writeFileSync(KEY_PATH, pems.private);
  fs.writeFileSync(CERT_PATH, pems.cert);
  console.log('[setup] certs/ に証明書を保存しました(次回起動からは再利用されます)');
  return { key: pems.private, cert: pems.cert };
}

function listLanAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

// --- ydotool ブリッジ ------------------------------------------------------
// 実マウスと同じ「動いた分だけ」を都度 ydotool に渡すだけで、絶対座標や
// 中心・校正といった概念は一切扱わない。
//
// コマンド仕様(ydotool本家 ReimuNotMoe/ydotool 準拠):
//   相対移動: ydotool mousemove -x <dx> -y <dy>            (--absolute を付けなければ相対移動)
//   ホイール: ydotool mousemove --wheel -y <amount>
//   クリック: ydotool click 0xC0 (左) / 0xC1 (右) / 0xC2 (中央)
// バージョン差異で `mousemove_relative` 系のコマンド名を使う古いフォークもあるため、
// `ydotool mousemove --help` で手元の仕様が違う場合はここだけ書き換えれば良い。
function runYdotool(args, label) {
  execFile('ydotool', args, (err) => {
    if (err) {
      console.error(`[ydotool] ${label} 失敗: ${err.message}`);
      console.error('  → ydotoold が起動しているか確認してください (README参照)');
    }
  });
}

function moveMouse(dx, dy) {
  const ix = Math.round(dx);
  const iy = Math.round(dy);
  if (ix === 0 && iy === 0) return;
  runYdotool(['mousemove', '-x', String(ix), '-y', String(iy)], 'mousemove');
}

const CLICK_CODES = { left: '0xC0', right: '0xC1', middle: '0xC2' };

function clickButton(button) {
  const code = CLICK_CODES[button] || CLICK_CODES.left;
  runYdotool(['click', code], `click(${button})`);
}

function scrollWheel(amount) {
  const iv = Math.round(amount);
  if (iv === 0) return;
  runYdotool(['mousemove', '--wheel', '-y', String(iv)], 'scroll');
}

// --- サーバー起動 -----------------------------------------------------------
async function main() {
  const { key, cert } = await ensureCertificate();

  const app = express();
  app.use(express.static(path.join(ROOT, 'public')));

  const server = https.createServer({ key, cert }, app);
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('[ws] スマホが接続しました');
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'move') moveMouse(msg.dx, msg.dy);
      else if (msg.type === 'click') clickButton(msg.button);
      else if (msg.type === 'scroll') scrollWheel(msg.dy);
    });
    ws.on('close', () => console.log('[ws] スマホが切断しました'));
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log(`phone-gyro-mouse が port ${PORT} で起動しました`);
    console.log('同じWi-Fi内のスマホのブラウザで以下を開いてください:');
    const addrs = listLanAddresses();
    if (addrs.length === 0) {
      console.log(`  https://<このPCのローカルIP>:${PORT}`);
    } else {
      addrs.forEach((a) => console.log(`  https://${a}:${PORT}`));
    }
    console.log('');
    console.log('※初回アクセス時はブラウザに証明書の警告が出ます。');
    console.log('  「詳細設定」→「安全でないページに進む」等で進んでください(自己署名証明書のため)。');
    console.log('');
  });
}

main().catch((err) => {
  console.error('起動に失敗しました:', err);
  process.exit(1);
});
