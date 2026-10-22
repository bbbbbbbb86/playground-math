/* 操場數學練習器：加入主畫面、全螢幕、版本更新
   - 只在自己的 HTTPS 網址（或 localhost）註冊 service worker；在 Claude 預覽框架或 file:// 裡不註冊。
   - 加入主畫面一定要玩家自己確認；收到瀏覽器的安裝事件才顯示「安裝」按鈕，否則顯示操作步驟。
   - 從主畫面開啟（standalone）時，不顯示加入主畫面與全螢幕按鈕。 */
(function () {
  'use strict';
  // 部署後請填入正式網址（例如 'https://帳號.github.io/playground-math/'）。
  // 空白時：在自己的網址上就用目前網址；在 Claude 預覽頁裡不提供複製（避免複製到 Claude 分享頁）。
  var OFFICIAL_URL = '';
  var KEY_PREFIX = 'pgm.';
  var ua = navigator.userAgent || '';
  var env = {
    inFrame: (function () { try { return window.top !== window.self; } catch (e) { return true; } })(),
    ios: /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    android: /Android/i.test(ua),
    inApp: /Line\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|KAKAOTALK|; wv\)/i.test(ua),
    iosOtherBrowser: /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua),
    coarse: window.matchMedia && matchMedia('(pointer: coarse)').matches,
  };
  function isStandalone() {
    var mm = function (q) { return window.matchMedia && matchMedia(q).matches; };
    // display-mode: fullscreen 在一般瀏覽器按「全螢幕」時也會成立，所以只有不是網頁全螢幕時才算從主畫面啟動
    var browserFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    return mm('(display-mode: standalone)') || (mm('(display-mode: fullscreen)') && !browserFs) || navigator.standalone === true;
  }
  var installedThisSession = false;
  function canFullscreen() {
    var d = document;
    return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
  }
  function inFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  var deferredPrompt = null;
  var state = { swWaiting: null, updateDismissed: false, registration: null };
  window.__pwa = { env: env, isStandalone: isStandalone, state: state };

  function svg(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
  }
  var ICON_ADD = svg('<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M12 8v6M9 11h6"/>');
  var ICON_FS = svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>');
  var ICON_FS_EXIT = svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>');

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  // ---------- 對話框（沿用遊戲的 .modal 樣式） ----------
  function openModal(content, label, opener) {
    var prev = opener || document.activeElement;
    var box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
    box.appendChild(content);
    var back = el('div', { class: 'modal-back pwa-modal' }, [box]);
    function close() {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      var back2 = prev && prev.isConnected ? prev : document.getElementById('btn-install');
      if (back2 && back2.focus) back2.focus({ preventScroll: true });
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.body.appendChild(back);
    setTimeout(function () { var f = box.querySelector('[data-autofocus]') || box.querySelector('button'); f && f.focus({ preventScroll: true }); }, 30);
    return { close: close, box: box };
  }

  // ---------- 加入主畫面教學 ----------
  function stepsList(items) {
    var ol = el('ol', { class: 'pwa-steps' });
    items.forEach(function (h) { ol.appendChild(el('li', { html: h })); });
    return ol;
  }
  function recordsNote() {
    return el('p', { class: 'pwa-note', text: '提醒：從主畫面開啟的練習器，作答紀錄和瀏覽器裡的分開存放。如果已經在瀏覽器作答過，請先在「教師設定」下載全部紀錄（JSON），再到主畫面版的「教師設定」按「匯入紀錄」。' });
  }
  function officialUrl() {
    if (OFFICIAL_URL) return OFFICIAL_URL;
    return env.inFrame ? '' : location.href.split('#')[0];
  }
  function copyRow() {
    var url = officialUrl();
    if (!url) return el('p', { class: 'pwa-note', text: '這裡是預覽頁，不能加入主畫面。請向老師索取練習器的正式網址，用 Safari 或 Chrome 開啟後再加入。' });
    var msg = el('span', { role: 'status', style: 'font-size:14px;color:var(--ink-2)' });
    var input = el('input', { type: 'text', readonly: '', value: url, 'aria-label': '練習器網址', onfocus: function () { input.select(); } });
    var btn = el('button', { type: 'button', class: 'linkbtn', onclick: function () {
      var fail = function () { input.focus(); input.select(); msg.textContent = '請長按上面的網址，選「拷貝」。'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { msg.textContent = '已複製網址。'; }, fail);
      else fail();
    } }, ['複製遊戲網址']);
    return el('div', {}, [el('div', { class: 'pwa-url' }, [input, btn]), msg]);
  }
  function showInstallGuide(ev) {
    var opener = (ev && ev.currentTarget) || document.activeElement;
    var body = el('div');
    var m;
    var title = el('h2', { id: 'pwa-guide-title', text: '加入主畫面' });
    body.appendChild(title);
    var fallback = el('p', { class: 'pwa-note', text: '如果找不到「加入主畫面」或「安裝」，請改用 Safari（iPhone、iPad）或 Chrome（Android）開啟練習器網址再試一次。選項名稱可能因瀏覽器不同而有差異。' });
    if (env.inFrame) {
      body.appendChild(el('p', { text: '這個畫面是 Claude 的預覽頁，不能從這裡加入主畫面。' }));
      body.appendChild(stepsList(['用 Safari（iPhone、iPad）或 Chrome（Android）開啟練習器的<b>正式網址</b>。', '在那裡按首頁的「加入主畫面」，照著步驟做。']));
      body.appendChild(copyRow());
    } else if (env.inApp) {
      body.appendChild(el('p', { html: '你現在可能是在 LINE、Facebook 等 App 裡面開啟網頁，這裡通常不能加入主畫面。' }));
      body.appendChild(stepsList([
        '按「複製遊戲網址」，或從右上角選單選「用瀏覽器開啟」（有的 App 才有）。',
        env.ios ? '打開 <b>Safari</b>，貼上網址開啟。' : '打開 <b>Chrome</b>，貼上網址開啟。',
        '在那裡按首頁的「加入主畫面」。',
      ]));
      body.appendChild(copyRow());
      body.appendChild(fallback);
    } else if (env.ios) {
      if (env.iosOtherBrowser) body.appendChild(el('p', { text: '建議改用 Safari 開啟；其他瀏覽器的選單可能沒有這個選項。' }));
      body.appendChild(stepsList([
        '使用 <b>Safari</b> 開啟練習器的網址。',
        '點<b>分享</b>（方框加向上箭頭；iPhone 在畫面下方或網址列旁的「⋯」裡，iPad 在右上角）。',
        '選<b>加入主畫面</b>。',
        '如果有<b>以網頁 App 開啟</b>的選項，請把它打開。',
        '按<b>加入</b>，之後從主畫面的「操場數學」圖示開啟。',
      ]));
      body.appendChild(el('p', { text: '從主畫面圖示開啟，就不會顯示一般瀏覽器的網址列與工具列。' }));
      if (env.iosOtherBrowser) body.appendChild(copyRow());
    } else if (deferredPrompt) {
      body.appendChild(el('p', { text: '按下面的按鈕，瀏覽器會跳出確認視窗，按「安裝」就完成了。' }));
      var res = el('p', { role: 'status', class: 'err', style: 'color:var(--ink-2)' });
      var install = el('button', { type: 'button', class: 'btn primary', 'data-autofocus': '', onclick: function () {
        var p = deferredPrompt;
        if (!p) return;
        deferredPrompt = null; // 同一個安裝事件只能用一次
        install.remove();
        p.prompt();
        (p.userChoice || Promise.resolve({ outcome: 'unknown' })).then(function (c) {
          res.textContent = c.outcome === 'accepted'
            ? '已加入主畫面，之後從主畫面圖示開啟。'
            : '沒有安裝也沒關係，可以繼續在這裡練習。之後想安裝，可以從瀏覽器選單選「加入主畫面」或「安裝」。';
          decorateHome();
        });
      } }, ['安裝到主畫面']);
      body.appendChild(install);
      body.appendChild(res);
    } else {
      body.appendChild(stepsList(env.android ? [
        '使用 <b>Chrome</b> 開啟練習器的網址。',
        '點右上角的<b>⋮</b>選單。',
        '選<b>加入主畫面</b>或<b>安裝應用程式</b>，再按<b>安裝</b>。',
        '之後從主畫面的「操場數學」圖示開啟。',
      ] : [
        '電腦：用 <b>Chrome</b> 或 <b>Edge</b>，點網址列右邊的安裝圖示，或從選單選「安裝操場中的數學」。',
        '平板、手機：用 Safari（iPad、iPhone）或 Chrome（Android）開啟網址，再從瀏覽器選單加入主畫面。',
      ]));
      body.appendChild(fallback);
    }
    body.appendChild(recordsNote());
    var row = el('div', { class: 'row' }, [el('button', { type: 'button', class: 'btn quiet', id: 'pwa-guide-close', onclick: function () { m.close(); } }, ['知道了'])]);
    body.appendChild(row);
    m = openModal(body, '加入主畫面', opener);
    m.box.setAttribute('aria-labelledby', 'pwa-guide-title');
  }

  // ---------- 全螢幕 ----------
  function toggleFullscreen() {
    var d = document, root = d.documentElement;
    if (inFullscreen()) {
      (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      return;
    }
    var req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!req) return;
    try {
      var r = req.call(root, { navigationUI: 'hide' });
      if (r && r.catch) r.catch(function () { toast('這個瀏覽器不能切換全螢幕。可以改用「加入主畫面」。'); });
    } catch (e) { toast('這個瀏覽器不能切換全螢幕。可以改用「加入主畫面」。'); }
  }
  function toast(text) {
    var t = el('div', { class: 'pwa-update', role: 'status' }, [el('span', { text: text })]);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  // ---------- 首頁按鈕（首頁每次重畫時補上） ----------
  function decorateHome() {
    var home = document.querySelector('.home');
    var foot = document.querySelector('.home .foot');
    if (!home || !foot) return;
    home.querySelectorAll('.pwa-btn, .pwa-install').forEach(function (b) { b.remove(); });
    var teacher = foot.querySelector('#btn-teacher');
    var standalone = isStandalone();
    if (!standalone && !installedThisSession) {
      var units = home.querySelector('.units');
      var row = el('div', { class: 'pwa-install' }, [
        el('button', { type: 'button', class: 'linkbtn pwa-btn', id: 'btn-install', 'aria-describedby': 'pwa-install-note', html: ICON_ADD + '<span>加入主畫面</span>', onclick: showInstallGuide }),
        el('span', { class: 'pwa-install-note', id: 'pwa-install-note', text: '加入後可從手機桌面開啟，享受更完整的遊戲畫面。' }),
      ]);
      units && units.parentNode ? units.parentNode.insertBefore(row, units.nextSibling) : foot.insertBefore(row, teacher);
    }
    if (!standalone && canFullscreen()) {
      var fs = inFullscreen();
      foot.insertBefore(el('button', { type: 'button', class: 'linkbtn pwa-btn', id: 'btn-fullscreen', 'aria-pressed': String(fs), html: (fs ? ICON_FS_EXIT : ICON_FS) + '<span>' + (fs ? '離開全螢幕' : '全螢幕') + '</span>', onclick: toggleFullscreen }), teacher);
    }
  }

  // ---------- 直放提示：轉成橫放後自動收起（不中斷練習） ----------
  function onOrientation() {
    if (window.innerWidth > window.innerHeight) {
      document.querySelectorAll('.coach').forEach(function (c) {
        if (/橫放/.test(c.textContent)) c.remove();
      });
    }
  }

  // ---------- 版本更新 ----------
  function safeToReload() {
    var app = document.getElementById('app');
    return app && app.classList.contains('mode-home') && !document.querySelector('.modal-back');
  }
  function offerUpdate() {
    if (!state.swWaiting || state.updateDismissed || document.querySelector('.pwa-update.offer')) return;
    if (!safeToReload()) { setTimeout(offerUpdate, 4000); return; }
    var bar = el('div', { class: 'pwa-update offer', role: 'status' }, [
      el('span', { text: '有新版本可以更新' }),
      el('button', { type: 'button', class: 'now', onclick: function () {
        bar.remove();
        var w = state.swWaiting;
        if (w) w.postMessage({ type: 'SKIP_WAITING' });
      } }, ['現在更新']),
      el('button', { type: 'button', class: 'later', onclick: function () { state.updateDismissed = true; bar.remove(); } }, ['稍後']),
    ]);
    document.body.appendChild(bar);
  }
  function registerSW() {
    if (!('serviceWorker' in navigator) || env.inFrame || !window.isSecureContext || location.protocol === 'file:') return;
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading || !state.hadController) return;
      reloading = true;
      location.reload();
    });
    state.hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function (reg) {
      state.registration = reg;
      var track = function (w) {
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) { state.swWaiting = w; offerUpdate(); }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) { state.swWaiting = reg.waiting; offerUpdate(); }
      track(reg.installing);
      reg.addEventListener('updatefound', function () { track(reg.installing); });
      // 從背景回到前景時檢查一次新版本
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reg.update().catch(function () {}); });
    }).catch(function () { /* 不能註冊時遊戲照常可玩 */ });
  }

  // ---------- 啟動 ----------
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    decorateHome();
  });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; installedThisSession = true; decorateHome(); });
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) { document.addEventListener(ev, decorateHome); });
  if (window.matchMedia) {
    ['(display-mode: standalone)', '(orientation: landscape)'].forEach(function (q) {
      var mq = matchMedia(q);
      var fn = function () { decorateHome(); onOrientation(); };
      mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener && mq.addListener(fn);
    });
  }
  window.addEventListener('resize', onOrientation);
  document.documentElement.classList.toggle('is-standalone', isStandalone());

  function start() {
    var overlay = document.getElementById('overlay3d');
    if (overlay && window.MutationObserver) {
      new MutationObserver(function () {
        var foot = document.querySelector('.home .foot');
        if (foot && !foot.dataset.pwa) { foot.dataset.pwa = '1'; decorateHome(); }
      }).observe(overlay, { childList: true, subtree: true });
    }
    decorateHome();
    registerSW();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.__pwa.showInstallGuide = showInstallGuide;
  window.__pwa.decorateHome = decorateHome;
  window.__pwa.offerUpdate = offerUpdate;
  window.__pwa.KEY_PREFIX = KEY_PREFIX;
})();
