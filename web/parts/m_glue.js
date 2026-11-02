
/* ============================================================
   MOBILE GLUE — 導覽、設定頁、原生橋接、版本與更新、懸浮翻譯控制
   ============================================================ */
const APP_VERSION = '__VER__';
var GH = {user: 'IanLin1120', repo: 'ai-translator',
  get pages(){ return 'https://' + this.user.toLowerCase() + '.github.io/' + this.repo + '/'; },
  get web(){ return 'https://github.com/' + this.user + '/' + this.repo; }};
var DEFAULT_CLAUDE_URL = 'https://claude.ai/artifact/GrGKSNbfMi5K2saoWNStz9';

var isApp = !!(window.AIT && typeof window.AIT.version === 'function');
var NAT = {
  call: function(fn){
    try{
      var a = Array.prototype.slice.call(arguments, 1);
      if(window.AIT && typeof window.AIT[fn] === 'function') return window.AIT[fn].apply(window.AIT, a);
    }catch(e){ console.error('AIT.' + fn, e); }
    return undefined;
  },
  has: function(fn){ return !!(window.AIT && typeof window.AIT[fn] === 'function'); }
};
function lsGet(k, d){ try{ var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
function h(tag, attrs){
  var el = document.createElement(tag);
  if(attrs) Object.keys(attrs).forEach(function(k){
    if(k === 'class') el.className = attrs[k];
    else if(k.slice(0, 2) === 'on') el[k] = attrs[k];
    else el.setAttribute(k, attrs[k]);
  });
  for(var i = 2; i < arguments.length; i++){
    var c = arguments[i];
    if(c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/* ---------- 頁面切換 ---------- */
var VIEWS = ['trans', 'files', 'screen', 'set'];
var curView = 'trans', prevView = 'trans';
function showView(v){
  if(VIEWS.indexOf(v) < 0) v = 'trans';
  if(v === 'set' && curView !== 'set') prevView = curView;
  curView = v;
  VIEWS.forEach(function(x){ $('v-' + x).classList.toggle('on', x === v); });
  Array.prototype.forEach.call(document.querySelectorAll('#nav button'), function(b){ b.classList.toggle('on', b.dataset.v === v); });
  var top = $('topShared');
  if(v !== 'set'){ var page = $('p-' + v); page.insertBefore(top, page.firstChild); top.style.display = ''; }
  else top.style.display = 'none';
  if(v === 'screen') refreshFloat();
  if(v === 'set') refreshSettingsPage();
  try{ if(NAT.has('hideKeyboard')) NAT.call('hideKeyboard'); }catch(e){}
}
Array.prototype.forEach.call(document.querySelectorAll('#nav button'), function(b){
  b.addEventListener('click', function(){ showView(b.dataset.v); });
});
function showFilePanel(f){
  Array.prototype.forEach.call(document.querySelectorAll('.fpanel'), function(p){ p.style.display = p.dataset.f === f ? '' : 'none'; });
  Array.prototype.forEach.call(document.querySelectorAll('#fileSeg .btn'), function(b){ b.classList.toggle('on', b.dataset.f === f); });
  lsSet('ait.file', f);
}
$('fileSeg').addEventListener('click', function(e){ var b = e.target.closest('.btn'); if(b) showFilePanel(b.dataset.f); });
showFilePanel(lsGet('ait.file', 'image'));

/* 外部連結走系統瀏覽器 */
function openExternal(u){ if(isApp && NAT.has('openUrl')) NAT.call('openUrl', u); else window.open(u, '_blank', 'noopener'); }
document.addEventListener('click', function(e){
  var a = e.target.closest && e.target.closest('a[data-ext]');
  if(a){ e.preventDefault(); openExternal(a.getAttribute('href')); }
});

/* ---------- 設定頁（取代原本的對話框） ---------- */
function refreshSettingsPage(){
  $('setAnthropicKey').value = CFG.anthropicKey;
  var sm = $('setModel'); sm.value = CFG.model; if(sm.value !== CFG.model) sm.value = 'claude-sonnet-5-5';
  $('setGKey').value = CFG.gKey;
  $('setRemember').checked = CFG.remember;
  $('setFallback').checked = CFG.autoFallback;
  $('setOcrMode').value = lsGet('ait.ocrMode', 'auto');
  $('claudeUrl').value = lsGet('ait.claudeUrl', DEFAULT_CLAUDE_URL);
  $('aboutVer').textContent = 'v' + APP_VERSION + (isApp ? '・APK v' + (Upd.apk() || '?') : '・網頁版');
  $('cardClaude').style.display = '';
  renderUpdCard();
}
openSettings = function(){ showView('set'); };
closeSettings = function(){ try{ localStorage.setItem('ai-translator-seen', '1'); }catch(e){} showView(prevView === 'set' ? 'trans' : prevView); };
$('btnSetClose').addEventListener('click', function(){ closeSettings(); });
$('setOcrMode').addEventListener('change', function(){ lsSet('ait.ocrMode', this.value); });
$('btnSetSave').addEventListener('click', function(){ lsSet('ait.ocrMode', $('setOcrMode').value); });
$('btnOpenClaude').addEventListener('click', function(){
  var u = ($('claudeUrl').value || '').trim() || DEFAULT_CLAUDE_URL;
  if(!/^https:\/\/claude\.ai\//.test(u)){ toast('網址必須是 https://claude.ai/ 開頭', true); return; }
  lsSet('ait.claudeUrl', u);
  if(isApp && NAT.has('openClaude')) NAT.call('openClaude', u); else window.open(u, '_blank', 'noopener');
});
$('btnOpenClaudeLogin').addEventListener('click', function(){
  if(isApp && NAT.has('openClaude')) NAT.call('openClaude', 'https://claude.ai/login'); else window.open('https://claude.ai/login', '_blank', 'noopener');
});
if(isApp) CFG.remember = true;

/* ---------- 文字頁小工具 ---------- */
$('btnPasteText').addEventListener('click', async function(){
  try{ var t = await navigator.clipboard.readText(); if(t){ $('textIn').value = t; } }
  catch(e){ toast('無法讀取剪貼簿，請長按輸入框貼上', true); }
});
$('btnClearText').addEventListener('click', function(){ $('textIn').value = ''; $('textOut').value = ''; textState.segs = null; });

/* ---------- 儲存檔案（原生：存到「下載」資料夾） ---------- */
function blobToB64(blob){
  return new Promise(function(res, rej){
    var r = new FileReader();
    r.onload = function(){ res(String(r.result).split(',')[1] || ''); };
    r.onerror = function(){ rej(r.error); };
    r.readAsDataURL(blob);
  });
}
if(isApp && NAT.has('saveFile')){
  saveFile = async function(filename, data, mime){
    var blob = (data instanceof Blob) ? data : new Blob([data], {type: mime || 'application/octet-stream'});
    try{
      var b64 = await blobToB64(blob);
      var r = NAT.call('saveFile', filename, blob.type || mime || 'application/octet-stream', b64);
      var o = {}; try{ o = JSON.parse(r); }catch(e){}
      if(o && o.ok){ if(o.path) toast('已存到：' + o.path); return true; }
      toast('儲存失敗：' + ((o && o.err) || '未知錯誤'), true); return false;
    }catch(e){ toast('儲存失敗：' + errMsg(e), true); return false; }
  };
}

/* ---------- 裝置端文字辨識（ML Kit）供圖片／截圖使用 ---------- */
var ocrWait = {};
function nativeOcr(b64, lang){
  return new Promise(function(res, rej){
    var id = 'o' + Date.now() + Math.random().toString(36).slice(2, 6);
    ocrWait[id] = {res: res, rej: rej};
    NAT.call('ocr', id, b64, lang || 'auto');
    setTimeout(function(){ if(ocrWait[id]){ delete ocrWait[id]; rej(new Error('文字辨識逾時')); } }, 60000);
  });
}
function useMlkit(){
  var m = lsGet('ait.ocrMode', 'auto');
  return isApp && NAT.has('ocr') && (m === 'mlkit' || (m === 'auto' && !CFG.anthropicKey));
}
var _aiImagesAvailable = aiImagesAvailable, _aiTranslateImage = aiTranslateImage;
aiImagesAvailable = function(){ return useMlkit() ? true : _aiImagesAvailable(); };
aiTranslateImage = async function(prepared, src, tgt){
  if(!useMlkit()) return _aiTranslateImage(prepared, src, tgt);
  var blocks = await nativeOcr(prepared.b64, src);                    /* ["段落文字", …] */
  var segs = (blocks || []).map(function(b){ return String(b || '').replace(/\s*\n\s*/g, ' ').trim(); }).filter(Boolean)
    .map(function(b){ return {orig: b, sents: splitSentences(b)}; });
  var flat = []; segs.forEach(function(s){ s.sents.forEach(function(x){ flat.push(x); }); });
  if(!flat.length) return [];
  var out = await translateBatch(flat, {sourceLang: src, targetLang: tgt});
  var k = 0;
  return segs.map(function(s){ return {orig: s.orig, pairs: s.sents.map(function(x){ return {o: x, t: out[k++]}; })}; });
};
imagesNotAvailable = function(){
  toast('圖片辨識需要 API 金鑰，或使用安裝版 App 的裝置端辨識。', true);
  if(!isApp) openSettings();
};

/* ---------- Claude 訂閱引擎（背景網頁版翻譯器 → 用月訂閱額度，結果直接顯示在這個介面） ---------- */
var CE = {state: 'none', wait: {}};
function subSupported(){ return isApp && NAT.has('cengReq'); }
function subOn(){ return subSupported() && engineSel.value === 'sub'; }
function claudeUrl(){ return lsGet('ait.claudeUrl', '') || DEFAULT_CLAUDE_URL; }
if(subSupported()){
  $('optSub').hidden = false; $('optSub').disabled = false;
  var savedEng = lsGet('ait.engine', ''); if(savedEng === 'sub' || savedEng === 'google') engineSel.value = savedEng;
  engineSel.addEventListener('change', function(){
    lsSet('ait.engine', engineSel.value);
    if(engineSel.value === 'sub') NAT.call('cengStart', claudeUrl());
  });
  if(engineSel.value === 'sub') NAT.call('cengStart', claudeUrl());
}else{ var _o = $('optSub'); if(_o) _o.remove(); }
function ceState(){ return String(NAT.call('cengState') || CE.state || 'none'); }
function ceFailText(st){
  if(st === 'login') return '尚未登入 claude.ai：請到「設定」→「Claude 訂閱模式」按「登入 claude.ai」（用 Email 登入），再回來重試。';
  if(st === 'noaccess') return 'Claude 網頁版翻譯器沒有取得翻譯權限：請到「設定」按「開啟 Claude 訂閱版翻譯」，在那個頁面翻譯一次並按「允許」，之後這裡就能用。';
  return null;
}
var _aiAvailable = aiAvailable, _callAIJson = callAIJson, _updateEnginePill = updateEnginePill;
aiAvailable = function(){ return subOn() ? true : _aiAvailable(); };
var _aiImagesAvailable2 = aiImagesAvailable;
aiImagesAvailable = function(){ return subOn() ? true : _aiImagesAvailable2(); };
callAIJson = async function(prompt, imgs){
  if(!subOn()) return _callAIJson(prompt, imgs);
  NAT.call('cengStart', claudeUrl());
  var t0 = Date.now(), st;
  while(true){                                     /* 等背景網頁版翻譯器就緒（最多 40 秒） */
    st = ceState();
    var bad = ceFailText(st); if(bad) throw new Error(bad);
    if(st === 'ready') break;
    if(Date.now() - t0 > 40000) throw new Error('Claude 網頁版翻譯器沒有回應（可能尚未登入或網路不穩）。可到「設定」開啟 Claude 訂閱版翻譯確認，或改用 Google 翻譯。');
    await sleep(500);
  }
  var id = 'c' + Date.now() + Math.random().toString(36).slice(2, 6);
  var req = {prompt: prompt, images: (imgs || []).map(function(x){ return {mime: x.mime, b64: x.b64}; })};
  return new Promise(function(res, rej){
    CE.wait[id] = {res: res, rej: rej};
    NAT.call('cengReq', id, JSON.stringify(req));
    setTimeout(function(){ if(CE.wait[id]){ delete CE.wait[id]; rej(new Error('Claude 訂閱翻譯逾時，請重試。')); } }, 120000);
  });
};
updateEnginePill = function(){
  _updateEnginePill();
  if(!subOn()) return;
  var st = ceState(), ready = st === 'ready';
  enginePill.textContent = ready ? 'Claude 訂閱引擎已就緒' : st === 'login' ? '需要登入 claude.ai' : st === 'noaccess' ? '需要授權網頁版翻譯器' : '連線 Claude 中…';
  enginePill.className = 'status-pill ' + (ready ? 'ok' : (st === 'login' || st === 'noaccess') ? 'bad' : '');
};
engineSel.addEventListener('change', function(){ updateEnginePill(); });

/* ---------- 版本與更新（GitHub：IanLin1120/ai-translator） ---------- */
var Upd = {
  gt: function(a, b){ var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for(var i = 0; i < Math.max(x.length, y.length); i++){ var p = x[i] || 0, q = y[i] || 0; if(p !== q) return p > q; } return false; },
  apk: function(){ return (isApp && NAT.call('version')) || ''; },
  autoOn: function(){ return lsGet('ait.autoUpd', true) !== false; },
  boot: function(){
    var self = this;
    try{ localStorage.removeItem('ait.otaFail'); }catch(e){}
    document.addEventListener('visibilitychange', function(){ if(!document.hidden) self.onResume(); });
    if(!this.autoOn()) return;
    setTimeout(function(){ self.auto(); }, 4000);
  },
  auto: function(){ if(!this.autoOn() || this.isOpen()) return; lsSet('ait.updAt', Date.now()); this.check(false); },
  manifest: async function(){
    var r = await fetch(GH.pages + 'version.json?t=' + Date.now(), {cache: 'no-store'});
    if(!r.ok) throw new Error(r.status === 404 ? 'GitHub 上還沒有發布版本（請確認已開啟 GitHub Pages）' : 'HTTP ' + r.status);
    return r.json();
  },
  idb: function(){ return new Promise(function(res, rej){ var q = indexedDB.open('ait-ota', 1); q.onupgradeneeded = function(){ q.result.createObjectStore('f'); }; q.onsuccess = function(){ res(q.result); }; q.onerror = function(){ rej(q.error); }; }); },
  store: async function(html){
    var db = await this.idb();
    await new Promise(function(res, rej){ var t = db.transaction('f', 'readwrite'); t.objectStore('f').put(html, 'html'); t.oncomplete = res; t.onerror = function(){ rej(t.error); }; });
    db.close();
  },
  check: async function(manual){
    var self = this;
    function say(t){ var st = $('updSt'); if(st) st.textContent = t; }
    try{
      say('檢查中…');
      var v = await this.manifest(); lsSet('ait.updLast', {v: v, t: Date.now()});
      var apk = this.apk();
      var apkNew = isApp && apk && v.apkName && this.gt(v.apkName, apk);
      var must = isApp && v.minApk && apk && this.gt(v.minApk, apk);
      function apkDlg(must){
        say('有新版 APK v' + (v.apkName || v.app) + (must ? '（需要重新安裝）' : ''));
        self.dialog('🎉 有新版 APK v' + esc(v.apkName || v.app),
          (v.notes ? esc(v.notes) + '<br><br>' : '') + (must ? '這次是大改版（手機端程式有更新），需要安裝新的 APK。' : '手機端程式有更新，建議安裝新的 APK。') +
          (self.native() ? '按「下載並安裝」會直接在 App 裡下載，完成後跳出系統的「更新」確認；' : '') + '會直接覆蓋舊版，設定與金鑰都會保留。',
          [[self.native() ? '⬇ 下載並安裝' : '⬇ 下載最新版 APK', function(){ self.installLatest(); }],
           ['稍後', function(){ if(!must) lsSet('ait.apkSnooze', {v: v.apkName, t: Date.now()}); }]]);
      }
      if(must){ apkDlg(true); return; }
      var snz = lsGet('ait.apkSnooze', null), snoozed = !manual && snz && snz.v === v.apkName && Date.now() - snz.t < 12 * 3600e3;
      if(apkNew && !this.gt(v.app, APP_VERSION)){ if(!snoozed) apkDlg(false); else say('有新版 APK v' + v.apkName); return; }
      if(!this.gt(v.app, APP_VERSION)){ say('已經是最新版本 v' + APP_VERSION); if(manual) toast('已經是最新版本 v' + APP_VERSION); return; }
      if(!isApp){
        say('有新版本 v' + v.app);
        if(manual) this.dialog('有新版本 v' + esc(v.app), '網頁版請重新整理，或開啟 GitHub 上的最新網頁版。', [['🌐 開啟網頁版', function(){ self.open(GH.pages); }], ['稍後', null]]);
        return;
      }
      say('下載新版本 v' + v.app + '…');
      var r = await fetch(GH.pages + 'index.html?t=' + Date.now(), {cache: 'no-store'});
      if(!r.ok) throw new Error('HTTP ' + r.status);
      var html = await r.text();
      if(html.indexOf("const APP_VERSION = '" + v.app + "'") < 0 || html.length < 1000000) throw new Error('下載不完整，稍後再試');
      await this.store(html); lsSet('ait.ota', {ver: v.app, minApk: v.minApk || ''});
      try{ localStorage.removeItem('ait.otaFail'); }catch(e){}
      say('已下載 v' + v.app + '，重新開啟後套用');
      this.dialog('已下載新版本 v' + esc(v.app), v.notes ? esc(v.notes) : '介面與功能更新', [['🔄 立即套用', function(){ location.reload(); }], ['下次開啟時套用', null]]);
    }catch(e){ say('無法檢查更新：' + e.message); if(manual) toast('無法檢查更新：' + e.message, true); }
  },
  releases: async function(){
    var self = this;
    this.dialog('⬇ 下載 APK', '<div id="relL" class="sub">讀取 GitHub 版本清單中…</div>', [['關閉', null]]);
    try{
      var r = await fetch(GH.pages + 'apks.json?t=' + Date.now(), {cache: 'no-store'});
      if(!r.ok) throw new Error(r.status === 404 ? '找不到版本清單（請確認已開啟 GitHub Pages）' : 'HTTP ' + r.status);
      var L = await r.json(), apk = this.apk();
      $('relL').innerHTML = L.length ? L.map(function(x, i){
        return '<div class="relR"><div class="grow"><b>v' + esc(x.v) + '</b>' + (i === 0 ? ' <span class="tyTag" style="background:#5f9a5a">最新</span>' : '') +
          (apk && x.v === apk ? ' <span class="tyTag" style="background:#a2613a">目前安裝</span>' : '') +
          '<div class="sub">' + esc(x.date || '') + (x.size ? '・' + (x.size / 1048576).toFixed(1) + ' MB' : '') + '</div>' +
          (x.notes ? '<div class="sub relN">' + esc(x.notes).replace(/\n/g, '<br>') + '</div>' : '') + '</div>' +
          '<button class="btn sm ' + (i === 0 ? 'pri' : '') + '" data-v="' + esc(x.v) + '" data-u="' + esc(GH.pages + 'apk/' + encodeURIComponent(x.file)) + '">⬇</button></div>';
      }).join('') : '<div class="sub">GitHub 上還沒有可下載的 APK</div>';
      Array.prototype.forEach.call(document.querySelectorAll('#relL [data-u]'), function(b){ b.onclick = function(){ self.install(b.dataset.u, b.dataset.v); }; });
    }catch(e){ $('relL').textContent = '⚠️ 無法讀取版本清單：' + e.message; }
  },
  open: function(u){ openExternal(u); },
  native: function(){ return !!(isApp && NAT.has('installApk')); },
  installLatest: async function(){
    try{
      var r = await fetch(GH.pages + 'apks.json?t=' + Date.now(), {cache: 'no-store'}); var L = await r.json();
      if(!L.length) throw new Error('沒有可下載的 APK');
      this.install(GH.pages + 'apk/' + encodeURIComponent(L[0].file), L[0].v);
    }catch(e){ toast('無法取得版本清單：' + e.message, true); this.releases(); }
  },
  install: function(url, v){
    var self = this;
    if(!this.native()){ this.open(url); toast('已用瀏覽器開始下載，完成後點通知安裝（直接覆蓋安裝，資料會保留）'); return; }
    if(!NAT.call('canInstall')){
      this.pend = {url: url, v: v};
      this.dialog('需要允許安裝', '第一次在 App 內更新，需要允許「AI 全能翻譯」安裝應用程式。按「前往設定」打開「允許來自這個來源的應用程式」，回到 App 後會自動繼續下載安裝。',
        [['前往設定', function(){ NAT.call('askInstall'); }], ['改用瀏覽器下載', function(){ self.pend = null; self.open(url); }], ['取消', function(){ self.pend = null; }]]);
      return;
    }
    this.pend = null; this.instUrl = url;
    this.dialog('⬇ 更新到 v' + esc(v || ''), '<div id="apkTx" class="sub">準備下載…</div><div class="prog" style="margin-top:8px"><i id="apkBar" style="width:0%"></i></div>', [['在背景繼續', null]]);
    NAT.call('installApk', url);
  },
  onResume: function(){
    var self = this;
    if(this.autoOn() && Date.now() - lsGet('ait.updAt', 0) > 30 * 60e3) setTimeout(function(){ self.auto(); }, 1500);
    if(this.pend && this.native() && NAT.call('canInstall')){ var p = this.pend; this.pend = null; setTimeout(function(){ self.install(p.url, p.v); }, 400); }
    refreshFloat();
  },
  onApk: function(d){
    try{ d = typeof d === 'string' ? JSON.parse(d) : d; }catch(e){ return; }
    var tx = $('apkTx'), bar = $('apkBar');
    function set(t, p){ if(tx) tx.textContent = t; if(bar && p != null) bar.style.width = Math.round(p * 100) + '%'; }
    var self = this;
    if(d.state === 'download') set(d.pct >= 0 ? '下載中 ' + Math.round(d.pct * 100) + '%' : '下載中…', d.pct >= 0 ? d.pct : null);
    else if(d.state === 'installing') set('下載完成，準備安裝…', 1);
    else if(d.state === 'confirm') set('請在系統視窗按「更新」；安裝完成後重新開啟 App 就是新版本（設定與金鑰都保留）', 1);
    else if(d.state === 'done'){ set('✓ 安裝完成', 1); toast('✓ 已更新完成'); }
    else if(d.state === 'error'){
      var u = this.instUrl;
      this.dialog('更新沒有完成', esc(d.msg || '未知錯誤') + '<br><br>可以改用瀏覽器下載 APK，再點通知安裝（直接覆蓋舊版）。', [['改用瀏覽器下載', function(){ if(u) self.open(u); }], ['關閉', null]]);
    }
  },
  dialog: function(title, html, btns){
    var el = $('updSheet'); if(!el){ el = h('div', {id: 'updSheet'}); document.body.appendChild(el); }
    el.innerHTML = '<div class="plBg"></div><div class="plBox glass"><div class="lab"><span>' + title + '</span></div><div style="margin:6px 0 12px;line-height:1.6">' + html + '</div><div class="acts">' +
      btns.map(function(b, i){ return '<button class="btn ' + (i === 0 ? 'pri' : '') + '" data-i="' + i + '">' + b[0] + '</button>'; }).join('') + '</div></div>';
    el.classList.add('on');
    function close(){ el.classList.remove('on'); }
    el.querySelector('.plBg').onclick = close;
    Array.prototype.forEach.call(el.querySelectorAll('[data-i]'), function(b){ b.onclick = function(){ var f = btns[+b.dataset.i][1]; close(); if(f) f(); }; });
  },
  isOpen: function(){ var el = $('updSheet'); return !!(el && el.classList.contains('on')); },
  closeDlg: function(){ var el = $('updSheet'); if(el) el.classList.remove('on'); }
};
function renderUpdCard(){
  var self = Upd, mount = $('updMount'); mount.textContent = '';
  var last = lsGet('ait.updLast', null), apk = self.apk(), ota = window.__OTA || (lsGet('ait.ota', null) || {}).ver;
  function row(ic, t, s, fn, id){
    var sub2 = null;
    if(id){
      sub2 = h('div', {class: 'sub', id: id}, last ? '上次檢查 ' + new Date(last.t).toLocaleString('zh-TW', {hour12: false}).slice(0, -3) + (last.v && self.gt(last.v.app, APP_VERSION) ? '・有新版本 v' + last.v.app : '') : '');
    }
    return h('div', {class: 'setRow', onclick: fn}, h('span', {class: 'ic'}, ic), h('div', {class: 'grow'}, h('b', null, t), h('div', {class: 'sub'}, s), sub2), h('span', null, '›'));
  }
  var sw = h('input', {type: 'checkbox'}); sw.checked = self.autoOn(); sw.onchange = function(){ lsSet('ait.autoUpd', sw.checked); };
  var card = h('div', {class: 'card glass'},
    h('h3', null, '🔄 版本與更新'),
    h('label', {class: 'lab'}, h('span', null, '自動更新', h('span', {class: 'sub'}, '開啟 App 時從 GitHub 下載最新版介面與功能（不用重新安裝 APK）；大改版才需要下載新 APK')), h('span', {class: 'sw'}, sw, h('span'))),
    row('🔄', '檢查更新', '目前版本 v' + APP_VERSION + (isApp ? '・APK v' + (apk || '?') : '・網頁版') + (window.__OTA ? '（已線上更新）' : ''), function(){ self.check(true); }, 'updSt'),
    isApp ? row('⬇', '下載 APK 到手機', '可選最新版或任一舊版本', function(){ self.releases(); }) : null,
    isApp && (window.__OTA || ota) ? row('↩️', '還原為 APK 內建版本', '線上更新後有問題時使用（v' + (window.APP_BUILTIN || '') + '）', function(){
      self.dialog('還原為 APK 內建版本？', '會刪除線上下載的新版介面，改回這支 APK 內建的版本。設定與金鑰不受影響。', [['還原', function(){ try{ localStorage.removeItem('ait.ota'); }catch(e){} location.replace(location.pathname + '#builtin'); location.reload(); }], ['取消', null]]);
    }) : null,
    row('🌐', '網頁版', GH.pages.replace('https://', ''), function(){ self.open(GH.pages); }),
    row('📦', 'GitHub 儲存庫', '所有版本的 APK、更新說明', function(){ self.open(GH.web); }));
  mount.appendChild(card);
}

/* ---------- 懸浮即時翻譯（原生） ---------- */
var FL = {running: false};
function flPrefs(){ return Object.assign({ocr: 'mlkit', engine: 'google', sens: 'mid', gap: '2500', showOrig: true}, lsGet('ait.fl', {})); }
function flSavePrefs(){ lsSet('ait.fl', {ocr: $('flOcr').value, engine: $('flEngine').value, sens: $('flSens').value, gap: $('flGap').value, showOrig: $('flShowOrig').checked}); }
function refreshFloat(){
  var native = isApp && NAT.has('startFloat');
  $('flNative').style.display = native ? '' : 'none';
  $('flWebOnly').classList.toggle('hide', native);
  if(!native) return;
  var p = flPrefs();
  $('flOcr').value = p.ocr; $('flEngine').value = p.engine; $('flSens').value = p.sens; $('flGap').value = p.gap; $('flShowOrig').checked = p.showOrig;
  var ov = !!NAT.call('canOverlay'), nt = !!NAT.call('canNotif');
  $('permOverlay').textContent = ov ? '已允許' : '未允許'; $('permOverlay').className = ov ? 'ok' : 'no'; $('btnAskOverlay').style.display = ov ? 'none' : '';
  $('permNotif').textContent = nt ? '已允許' : '未允許'; $('permNotif').className = nt ? 'ok' : 'no'; $('btnAskNotif').style.display = nt ? 'none' : '';
  FL.running = !!NAT.call('floatRunning');
  setFlState();
}
function setFlState(txt){
  $('flDot').classList.toggle('on', FL.running);
  $('flState').textContent = txt || (FL.running ? '執行中：切到其他 App，點懸浮的「譯」圓球開始框選' : '尚未啟動');
  $('btnFlStart').disabled = FL.running; $('btnFlStop').disabled = !FL.running;
}
['flOcr', 'flEngine', 'flSens', 'flGap', 'flShowOrig'].forEach(function(id){ $(id).addEventListener('change', flSavePrefs); });
$('btnAskOverlay').addEventListener('click', function(){ NAT.call('askOverlay'); });
$('btnAskNotif').addEventListener('click', function(){ NAT.call('askNotif'); setTimeout(refreshFloat, 800); });
$('btnFlStart').addEventListener('click', function(){
  if(!isApp || !NAT.has('startFloat')){ toast('請安裝 APK 版 App 使用此功能', true); return; }
  flSavePrefs();
  var p = flPrefs();
  if((p.ocr === 'claude' || p.engine === 'claude') && !CFG.anthropicKey){ toast('選了 Claude 辨識／翻譯，請先到「設定」填入 API 金鑰', true); return; }
  if(!NAT.call('canOverlay')){ toast('請先允許「顯示在其他應用程式上層」', true); NAT.call('askOverlay'); return; }
  var cfg = {src: srcSel.value, tgt: tgtSel.value, srcName: langName(srcSel.value), tgtName: langName(tgtSel.value),
    ocr: p.ocr, engine: p.engine, gKey: CFG.gKey, aKey: CFG.anthropicKey, model: CFG.model,
    sens: p.sens, gap: parseInt(p.gap, 10) || 2500, showOrig: !!p.showOrig};
  NAT.call('startFloat', JSON.stringify(cfg));
  setFlState('正在啟動…請在系統視窗允許螢幕錄製');
});
$('btnFlStop').addEventListener('click', function(){ NAT.call('stopFloat'); FL.running = false; setFlState(); });

/* ---------- 原生事件入口 ---------- */
window.onNativeEvent = function(type, data){
  try{
    if(type === 'apk') Upd.onApk(data);
    else if(type === 'float'){
      var d = typeof data === 'string' ? JSON.parse(data) : data;
      if(d.state === 'started'){ FL.running = true; setFlState(); }
      else if(d.state === 'stopped'){ FL.running = false; setFlState(); }
      else if(d.state === 'denied'){ FL.running = false; setFlState('螢幕錄製權限被拒絕'); toast('需要允許螢幕錄製才能懸浮翻譯', true); }
      else if(d.state === 'error'){ FL.running = false; setFlState(); toast('懸浮翻譯錯誤：' + (d.msg || ''), true); }
    }
    else if(type === 'perm') refreshFloat();
    else if(type === 'ceng'){
      var c = typeof data === 'string' ? JSON.parse(data) : data;
      if(c.state){ CE.state = c.state; updateEnginePill(); }
      else if(c.id && CE.wait[c.id]){
        var w2 = CE.wait[c.id]; delete CE.wait[c.id];
        if(c.ok){ try{ w2.res(JSON.parse(c.text)); }catch(e){ try{ w2.res(parseJsonLoose(c.text)); }catch(e2){ w2.rej(new Error('Claude 回傳格式無法解析')); } } }
        else w2.rej(new Error(c.text || 'Claude 訂閱翻譯失敗'));
      }
    }
    else if(type === 'ocr'){
      var o = typeof data === 'string' ? JSON.parse(data) : data, w = ocrWait[o.id];
      if(w){ delete ocrWait[o.id]; if(o.ok) w.res(o.lines || []); else w.rej(new Error(o.err || '文字辨識失敗')); }
    }
  }catch(e){ console.error('onNativeEvent', type, e); }
};
/* 返回鍵：回傳 true 表示網頁已處理 */
window.onNativeBack = function(){
  if(Upd.isOpen()){ Upd.closeDlg(); return true; }
  if($('exModal').classList.contains('show')){ closeExport(); return true; }
  if(curView === 'set'){ closeSettings(); return true; }
  if(curView !== 'trans'){ showView('trans'); return true; }
  return false;
};

/* ---------- 啟動 ---------- */
showView('trans');
updateEnginePill();
if(!isApp){ $('cardClaude').querySelector('.desc').textContent = '用你的 Claude 月訂閱額度翻譯（不需要 API 金鑰）：直接在 claude.ai 開啟網頁版翻譯器。'; }
Upd.boot();
