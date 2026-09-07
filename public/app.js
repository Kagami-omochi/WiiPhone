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
  const debugReadout = document.getElementById('debugReadout');

  // 回転(傾け)関連のUI
  const sensitivityInput = document.getElementById('sensitivity');
  const sensitivityValue = document.getElementById('sensitivityValue');
  const invertXInput = document.getElementById('invertX');
  const invertYInput = document.getElementById('invertY');
  const axisXInput = document.getElementById('axisX');
  const axisYInput = document.getElementById('axisY');

  // 平行移動(スライド)関連のUI
  const enableTranslationInput = document.getElementById('enableTranslation');
  const tSensitivityInput = document.getElementById('tSensitivity');
  const tSensitivityValue = document.getElementById('tSensitivityValue');
  const invertTXInput = document.getElementById('invertTX');
  const invertTYInput = document.getElementById('invertTY');
  const axisTXInput = document.getElementById('axisTX');
  const axisTYInput = document.getElementById('axisTY');

  let ws = null;
  let engaged = false;
  let lastT = null;
  let accumDX = 0;
  let accumDY = 0;
  let flushTimer = null;

  // 平行移動の速度(加速度を積分したもの)。指を離すたびにリセットする。
  let velX = 0;
  let velY = 0;
  let velZ = 0;
  // accelerationが取れない端末向けの重力推定(ローパスフィルタ)
  const gravityEstimate = { x: 0, y: 0, z: 0 };
  const GRAVITY_LOWPASS = 0.8;

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

    enableTranslation: localStorage.getItem('gm_enableTranslation') !== '0', // 既定でON
    tSensitivity: parseFloat(localStorage.getItem('gm_tSensitivity') || '2000'),
    invertTX: localStorage.getItem('gm_invertTX') === '1',
    invertTY: localStorage.getItem('gm_invertTY') === '1',
    axisTX: localStorage.getItem('gm_axisTX') || 'x',
    axisTY: localStorage.getItem('gm_axisTY') || 'y',
  };

  sensitivityInput.value = state.sensitivity;
  sensitivityValue.textContent = state.sensitivity;
  invertXInput.checked = state.invertX;
  invertYInput.checked = state.invertY;
  axisXInput.value = state.axisX;
  axisYInput.value = state.axisY;

  enableTranslationInput.checked = state.enableTranslation;
  tSensitivityInput.value = state.tSensitivity;
  tSensitivityValue.textContent = state.tSensitivity;
  invertTXInput.checked = state.invertTX;
  invertTYInput.checked = state.invertTY;
  axisTXInput.value = state.axisTX;
  axisTYInput.value = state.axisTY;

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

  enableTranslationInput.addEventListener('change', () => {
    state.enableTranslation = enableTranslationInput.checked;
    localStorage.setItem('gm_enableTranslation', state.enableTranslation ? '1' : '0');
    velX = velY = velZ = 0;
  });
  tSensitivityInput.addEventListener('input', () => {
    state.tSensitivity = parseFloat(tSensitivityInput.value);
    tSensitivityValue.textContent = tSensitivityInput.value;
    localStorage.setItem('gm_tSensitivity', String(state.tSensitivity));
  });
  invertTXInput.addEventListener('change', () => {
    state.invertTX = invertTXInput.checked;
    localStorage.setItem('gm_invertTX', state.invertTX ? '1' : '0');
  });
  invertTYInput.addEventListener('change', () => {
    state.invertTY = invertTYInput.checked;
    localStorage.setItem('gm_invertTY', state.invertTY ? '1' : '0');
  });
  axisTXInput.addEventListener('change', () => {
    state.axisTX = axisTXInput.value;
    localStorage.setItem('gm_axisTX', state.axisTX);
  });
  axisTYInput.addEventListener('change', () => {
    state.axisTY = axisTYInput.value;
    localStorage.setItem('gm_axisTY', state.axisTY);
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

  // accelerationIncludingGravity から重力成分をローパスフィルタで推定して
  // 差し引くフォールバック(event.acceleration が取れない端末向け)。
  function getLinearAcceleration(e) {
    if (e.acceleration && e.acceleration.x !== null && e.acceleration.x !== undefined) {
      return e.acceleration;
    }
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.x === undefined) return null;
    gravityEstimate.x = GRAVITY_LOWPASS * gravityEstimate.x + (1 - GRAVITY_LOWPASS) * g.x;
    gravityEstimate.y = GRAVITY_LOWPASS * gravityEstimate.y + (1 - GRAVITY_LOWPASS) * g.y;
    gravityEstimate.z = GRAVITY_LOWPASS * gravityEstimate.z + (1 - GRAVITY_LOWPASS) * g.z;
    return {
      x: g.x - gravityEstimate.x,
      y: g.y - gravityEstimate.y,
      z: g.z - gravityEstimate.z,
    };
  }

  const ACCEL_DEADZONE = 0.12; // m/s^2 このレベル以下のノイズは無視する
  const VELOCITY_HALF_LIFE = 0.25; // 秒。加速度が止まると、この半減期で速度が0へ収束する
  // (実物のマウスを持ち上げて置き直す動きと同じで、常に中心へ戻す校正では
  //  なく、加速度入力が無くなれば自然に減衰するだけ。ドリフトの暴走を防ぐ)

  function updateTranslation(accel, dt) {
    let ax = accel[state.axisTX] || 0;
    let ay = accel[state.axisTY] || 0;
    if (Math.abs(ax) < ACCEL_DEADZONE) ax = 0;
    if (Math.abs(ay) < ACCEL_DEADZONE) ay = 0;

    const decay = Math.pow(0.5, dt / VELOCITY_HALF_LIFE);
    velX = velX * decay + ax * dt;
    velY = velY * decay + ay * dt;

    let tdx = velX * dt * state.tSensitivity;
    let tdy = velY * dt * state.tSensitivity;
    if (state.invertTX) tdx = -tdx;
    if (state.invertTY) tdy = -tdy;
    return { tdx, tdy };
  }

  // 実物のマウスと同じ発想: 「中心」や「校正」は持たず、直前フレームからの
  // 変化量をそのままカーソルの移動量として都度加算するだけ。
  //  - 回転: 角速度(rotationRate) × 経過時間をそのまま使う(積分なしなのでドリフトしない)
  //  - 平行移動: 加速度を積分して速度にするが、減衰(半減期)を掛けて
  //              動きが止まれば自然に0へ戻るようにし、暴走を防いでいる
  function handleMotion(e) {
    if (!engaged) { lastT = null; return; }
    const rr = e.rotationRate;
    const now = performance.now();
    if (lastT === null) { lastT = now; return; }
    const dt = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;

    let dx = 0;
    let dy = 0;

    if (rr) {
      dx = (rr[state.axisX] || 0) * dt * state.sensitivity;
      dy = (rr[state.axisY] || 0) * dt * state.sensitivity;
      if (state.invertX) dx = -dx;
      if (state.invertY) dy = -dy;
    }

    let accel = null;
    if (state.enableTranslation) {
      accel = getLinearAcceleration(e);
      if (accel) {
        const t = updateTranslation(accel, dt);
        dx += t.tdx;
        dy += t.tdy;
      }
    }

    if (debugReadout) {
      const f = (v) => (typeof v === 'number' ? v.toFixed(1) : '--');
      const rot = rr
        ? `回転 α: ${f(rr.alpha)}  β: ${f(rr.beta)}  γ: ${f(rr.gamma)}`
        : '回転 -- 非対応';
      const tr = accel
        ? `並進 x: ${f(accel.x)}  y: ${f(accel.y)}  z: ${f(accel.z)}`
        : '並進 -- 無効/非対応';
      debugReadout.innerHTML = `<div>${rot}</div><div>${tr}</div>`;
    }

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
    if (!v) {
      accumDX = 0; accumDY = 0;
      velX = 0; velY = 0; velZ = 0;
    }
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
