(() => {
  const dot = document.getElementById('dot');
  const statusText = document.getElementById('statusText');
  const startScreen = document.getElementById('startScreen');
  const padScreen = document.getElementById('padScreen');
  const startBtn = document.getElementById('startBtn');
  const engageZone = document.getElementById('engageZone');
  const leftClick = document.getElementById('leftClick');
  const rightClick = document.getElementById('rightClick');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const closeSettings = document.getElementById('closeSettings');
  const sensitivityInput = document.getElementById('sensitivity');
  const sensitivityValue = document.getElementById('sensitivityValue');
  const invertXInput = document.getElementById('invertX');
  const invertYInput = document.getElementById('invertY');
  const axisXInput = document.getElementById('axisX');
  const axisYInput = document.getElementById('axisY');
  const debugReadout = document.getElementById('debugReadout');

  let ws = null;
  let engaged = false;
  let lastT = null;
  let accumDX = 0;
  let accumDY = 0;
  let flushTimer = null;

  // 軸の物理的な意味(alpha=ヨー相当かβ=ピッチ相当か等)は端末・ブラウザの
  // 実装によってズレることがあるため、どの生センサー値をX/Yに使うかを
  // 設定で選べるようにしてある。デフォルトは「画面が天井向き・充電ポートが
  // 体側」で持った際にヨー->左右、ピッチ->上下になるよう報告に基づき設定。
  const state = {
    sensitivity: parseFloat(localStorage.getItem('gm_sensitivity') || '5'),
    invertX: localStorage.getItem('gm_invertX') === '1',
    invertY: localStorage.getItem('gm_invertY') === '1',
    axisX: localStorage.getItem('gm_axisX') || 'gamma',
    axisY: localStorage.getItem('gm_axisY') || 'alpha',
  };

  sensitivityInput.value = state.sensitivity;
  sensitivityValue.textContent = state.sensitivity;
  invertXInput.checked = state.invertX;
  invertYInput.checked = state.invertY;
  axisXInput.value = state.axisX;
  axisYInput.value = state.axisY;

  sensitivityInput.addEventListener('input', () => {
    state.sensitivity = parseFloat(sensitivityInput.value);
    sensitivityValue.textContent = sensitivityInput.value;
    localStorage.setItem('gm_sensitivity', String(state.sensitivity));
  });
  invertXInput.addEventListener('change', () => {
    state.invertX = invertXInput.checked;
    localStorage.setItem('gm_invertX', state.invertX ? '1' : '0');
  });
  invertYInput.addEventListener('change', () => {
    state.invertY = invertYInput.checked;
    localStorage.setItem('gm_invertY', state.invertY ? '1' : '0');
  });
  axisXInput.addEventListener('change', () => {
    state.axisX = axisXInput.value;
    localStorage.setItem('gm_axisX', state.axisX);
  });
  axisYInput.addEventListener('change', () => {
    state.axisY = axisYInput.value;
    localStorage.setItem('gm_axisY', state.axisY);
  });

  settingsBtn.addEventListener('click', () => settingsPanel.classList.remove('hidden'));
  closeSettings.addEventListener('click', () => settingsPanel.classList.add('hidden'));

  function setStatus(connected) {
    dot.classList.toggle('connected', connected);
    statusText.textContent = connected ? '接続中' : '未接続';
  }

  function connectWS() {
    const url = `wss://${location.host}`;
    ws = new WebSocket(url);
    ws.addEventListener('open', () => setStatus(true));
    ws.addEventListener('close', () => {
      setStatus(false);
      setTimeout(connectWS, 1500); // 自動再接続
    });
    ws.addEventListener('error', () => setStatus(false));
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // 実物のマウスと同じ発想: 「中心」や「校正」は持たず、直前フレームからの
  // 回転量(角速度 × 経過時間)をそのままカーソルの移動量として都度送るだけ。
  // 位置を積分して絶対姿勢を保持するとドリフト(ズレの蓄積)が起きるため、
  // 加速度センサーの二重積分ではなくジャイロの角速度を採用している。
  function handleMotion(e) {
    if (!engaged) { lastT = null; return; }
    const rr = e.rotationRate;
    if (!rr) return;
    const now = performance.now();
    if (lastT === null) { lastT = now; return; }
    const dt = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;

    if (debugReadout) {
      const f = (v) => (typeof v === 'number' ? v.toFixed(1) : '--');
      debugReadout.textContent = `α: ${f(rr.alpha)}  β: ${f(rr.beta)}  γ: ${f(rr.gamma)}`;
    }

    // どの軸をX/Yに使うかは設定(state.axisX / state.axisY)で選べる。
    let dx = (rr[state.axisX] || 0) * dt * state.sensitivity;
    let dy = (rr[state.axisY] || 0) * dt * state.sensitivity;
    if (state.invertX) dx = -dx;
    if (state.invertY) dy = -dy;
    accumDX += dx;
    accumDY += dy;
  }

  function startFlushLoop() {
    if (flushTimer) return;
    flushTimer = setInterval(() => {
      if (accumDX === 0 && accumDY === 0) return;
      send({ type: 'move', dx: accumDX, dy: accumDY });
      accumDX = 0;
      accumDY = 0;
    }, 16); // 約60Hzでまとめて送信(送信のたびにPC側でydotoolを起動するため間引く)
  }

  // 指を離している間は実物のマウスを持ち上げているのと同じ状態にする。
  // これにより「ポケットに入れて歩いたら傾きでカーソルが暴れる」ことを防ぐ。
  function setEngaged(v) {
    engaged = v;
    lastT = null;
    engageZone.classList.toggle('active', v);
    if (!v) { accumDX = 0; accumDY = 0; }
  }

  engageZone.addEventListener('touchstart', (e) => { e.preventDefault(); setEngaged(true); }, { passive: false });
  engageZone.addEventListener('touchend', (e) => { e.preventDefault(); setEngaged(false); }, { passive: false });
  engageZone.addEventListener('touchcancel', () => setEngaged(false));
  // PCのブラウザで開いた場合の動作確認用
  engageZone.addEventListener('mousedown', () => setEngaged(true));
  window.addEventListener('mouseup', () => setEngaged(false));

  leftClick.addEventListener('touchstart', (e) => { e.preventDefault(); send({ type: 'click', button: 'left' }); }, { passive: false });
  rightClick.addEventListener('touchstart', (e) => { e.preventDefault(); send({ type: 'click', button: 'right' }); }, { passive: false });
  leftClick.addEventListener('click', () => send({ type: 'click', button: 'left' }));
  rightClick.addEventListener('click', () => send({ type: 'click', button: 'right' }));

  async function start() {
    startBtn.disabled = true;
    try {
      // iOS 13+ はユーザー操作(このボタン)からでないと許可ダイアログを出せない
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const result = await DeviceMotionEvent.requestPermission();
        if (result !== 'granted') {
          alert('センサーの使用が許可されませんでした。設定アプリのSafari項目から許可してください。');
          startBtn.disabled = false;
          return;
        }
      }
      window.addEventListener('devicemotion', handleMotion);
      startScreen.classList.add('hidden');
      padScreen.classList.remove('hidden');
      connectWS();
      startFlushLoop();
    } catch (err) {
      alert('開始に失敗しました: ' + err.message);
      startBtn.disabled = false;
    }
  }

  startBtn.addEventListener('click', start);
})();
