
/* ============================================================
   11. SCREEN TAB  (live capture, region select, floating translation)
   ============================================================ */
var SC = {
  stream: null, mode: null,            /* mode: 'live' (shared screen) | 'shot' (uploaded screenshot) */
  sel: null, selPx: null,              /* selected region as fractions of the source */
  lines: null,
  busy: false, paused: false, pending: false,
  worker: null, timer: null, prevSig: null, sigCanvas: null,
  firstChangeAt: 0, changedAt: 0, lastRun: 0
};
var FL = null;                          /* floating window state */
var SENS = {high: 0.006, mid: 0.015, low: 0.04};   /* share of changed cells that counts as "the screen changed" */

function showCapErr(msg){ var b = $('captureErr'); b.textContent = msg; b.style.display = 'block'; }
function clearCapErr(){ var b = $('captureErr'); b.style.display = 'none'; b.textContent = ''; }
function srcEl(){ return SC.mode === 'live' ? $('liveVideo') : $('cropCanvas'); }
function srcSize(){
  var el = srcEl();
  return SC.mode === 'live' ? {w: el.videoWidth, h: el.videoHeight} : {w: el.width, h: el.height};
}
function showStage(mode){
  SC.mode = mode; SC.sel = null; SC.selPx = null; SC.prevSig = null;
  $('cropStage').classList.add('show');
  $('liveVideo').style.display = mode === 'live' ? 'block' : 'none';
  $('cropCanvas').style.display = mode === 'shot' ? 'block' : 'none';
  $('cropSel').style.display = 'none';
  $('screenActions').style.display = 'flex';
  $('liveOpts').style.display = mode === 'live' ? 'flex' : 'none';
  $('btnStopCap').style.display = mode === 'live' ? '' : 'none';
  $('btnFloat').style.display = mode === 'live' ? '' : 'none';
  $('btnFloat').disabled = !!IN_CLAUDE;
  $('btnFloat').title = IN_CLAUDE ? '懸浮即時翻譯需使用下載的獨立版（Claude.ai 內嵌頁面無法分享螢幕）' : '';
  $('btnFloat').textContent = '🪟 開啟懸浮即時翻譯';
}

/* ---- start / stop screen sharing ---- */
async function startCapture(){
  clearCapErr();
  if(!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)){
    showCapErr('這個瀏覽器不支援螢幕分享（手機瀏覽器通常不支援）。請改用電腦版 Chrome / Edge，或使用「上傳截圖圖片」。');
    return;
  }
  if(window.isSecureContext === false){
    showCapErr('頁面不是在安全環境開啟（需要 https、localhost，或直接開啟本機的 .html 檔），瀏覽器因此封鎖螢幕分享。請改用「上傳截圖圖片」。');
    return;
  }
  stopCapture(true);
  try{
    var stream = await navigator.mediaDevices.getDisplayMedia({video: {frameRate: {ideal: 5, max: 15}}, audio: false});
    var v = $('liveVideo');
    v.muted = true; v.srcObject = stream;
    await v.play();
    SC.stream = stream;
    stream.getVideoTracks()[0].addEventListener('ended', function(){ stopCapture(); toast('畫面分享已結束'); });
    showStage('live');
  }catch(e){
    var m = String((e && e.message) || '');
    if(e && e.name === 'NotAllowedError' && /policy|disallowed/i.test(m)){
      showCapErr(IN_CLAUDE
        ? '此頁面嵌在 Claude.ai 裡，瀏覽器不允許嵌入頁面分享螢幕。請下載「獨立版 HTML」，用 Chrome / Edge 直接開啟後再使用；或先用 Win+Shift+S（Mac：Cmd+Shift+4）截圖，再按「上傳截圖圖片」。'
        : '瀏覽器的權限政策封鎖了螢幕分享（頁面可能被嵌在其他網頁中）。請在獨立的分頁開啟此檔案，或改用「上傳截圖圖片」。');
    } else if(e && e.name === 'NotAllowedError'){
      showCapErr('已取消或拒絕分享畫面。請再按一次「開始擷取畫面」，並在跳出的視窗中選擇要分享的螢幕或視窗；如果系統（macOS）擋住，請到「系統設定 → 隱私權與安全性 → 螢幕錄製」允許瀏覽器。');
    } else {
      showCapErr('無法開始螢幕分享（' + ((e && e.name) || '錯誤') + '）：' + m + '。可改用「上傳截圖圖片」。');
    }
  }
}
function stopCapture(silent){
  stopLoop();
  closeFloat(true);
  if(SC.stream){ SC.stream.getTracks().forEach(function(t){ try{ t.stop(); }catch(e){} }); SC.stream = null; }
  var v = $('liveVideo');
  try{ v.pause(); v.srcObject = null; }catch(e){}
  if(SC.mode === 'live'){
    SC.mode = null;
    $('cropStage').classList.remove('show');
    $('screenActions').style.display = 'none';
    $('liveOpts').style.display = 'none';
  }
}
$('btnCapture').addEventListener('click', startCapture);
$('btnStopCap').addEventListener('click', function(){ stopCapture(); });
$('btnUploadShot').addEventListener('click', function(){ $('fileShot').click(); });
$('fileShot').addEventListener('change', function(){
  var file = this.files[0]; this.value = '';
  if(!file) return;
  clearCapErr();
  stopCapture(true);
  loadImageToCanvas(file, 3600).then(function(c){
    var cv = $('cropCanvas');
    cv.width = c.width; cv.height = c.height;
    cv.getContext('2d').drawImage(c, 0, 0);
    showStage('shot');
  }).catch(function(e){ showCapErr(errMsg(e)); });
});

/* ---- drag to select a region (mouse / touch / pen) ---- */
(function wireCrop(){
  var stage = $('cropStage'), selEl = $('cropSel'), drag = null;
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function pos(e){
    var r = srcEl().getBoundingClientRect();
    return {x: clamp(e.clientX - r.left, 0, r.width), y: clamp(e.clientY - r.top, 0, r.height), w: r.width, h: r.height};
  }
  function draw(x, y, w, h){
    selEl.style.left = x + 'px'; selEl.style.top = y + 'px';
    selEl.style.width = w + 'px'; selEl.style.height = h + 'px';
  }
  stage.addEventListener('pointerdown', function(e){
    if(!SC.mode) return;
    e.preventDefault();
    var p = pos(e); drag = {x: p.x, y: p.y};
    try{ stage.setPointerCapture(e.pointerId); }catch(err){}
    selEl.style.display = 'block'; draw(p.x, p.y, 0, 0);
  });
  stage.addEventListener('pointermove', function(e){
    if(!drag) return;
    var p = pos(e);
    var x = Math.min(p.x, drag.x), y = Math.min(p.y, drag.y), w = Math.abs(p.x - drag.x), h = Math.abs(p.y - drag.y);
    draw(x, y, w, h);
    SC.selPx = {x: x, y: y, w: w, h: h, cw: p.w, ch: p.h};
  });
  function end(){
    if(!drag) return;
    drag = null;
    var s = SC.selPx;
    if(s && s.w > 8 && s.h > 8){ SC.sel = {fx: s.x / s.cw, fy: s.y / s.ch, fw: s.w / s.cw, fh: s.h / s.ch}; }
    else { SC.sel = null; selEl.style.display = 'none'; }
    SC.selPx = null; SC.prevSig = null;
  }
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
})();

/* ---- crop the selected region (full resolution of the source) ---- */
function cropToCanvas(){
  var el = srcEl(), sz = srcSize();
  var s = SC.sel || {fx: 0, fy: 0, fw: 1, fh: 1};
  var sx = Math.round(s.fx * sz.w), sy = Math.round(s.fy * sz.h);
  var sw = Math.max(1, Math.round(s.fw * sz.w)), sh = Math.max(1, Math.round(s.fh * sz.h));
  var c = document.createElement('canvas'); c.width = sw; c.height = sh;
  c.getContext('2d').drawImage(el, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

/* ---- translate once ---- */
$('btnTransSel').addEventListener('click', async function(){
  if(!SC.mode) return;
  if(!aiImagesAvailable()){ imagesNotAvailable(); return; }
  var btn = this; btn.disabled = true;
  progress('Screen', 0, 1, '辨識並翻譯中');
  try{
    var prepared = await canvasToPrepared(cropToCanvas(), 1800);
    var lines = await aiTranslateImage(prepared, srcSel.value, tgtSel.value);
    SC.lines = lines;
    renderPairs($('resScreen'), lines, true);
    $('btnDlScreen').disabled = !lines.length;
    renderFloat();
    progressDone('Screen', '完成');
  }catch(e){
    console.error(e);
    toast('螢幕翻譯失敗：' + errMsg(e), true);
    progressDone('Screen', '發生錯誤');
  }
  btn.disabled = false;
});
$('btnDlScreen').addEventListener('click', function(){
  if(!SC.lines || !SC.lines.length) return;
  openExport({title: '匯出螢幕翻譯', names: nameSet('螢幕翻譯'), formats: [txtFormat(SC.lines)]});
});

/* ---- change detection on the selected region ---- */
function regionSig(){
  var v = $('liveVideo'), s = SC.sel || {fx: 0, fy: 0, fw: 1, fh: 1};
  var W = 128, H = 72;
  var c = SC.sigCanvas || (SC.sigCanvas = document.createElement('canvas'));
  c.width = W; c.height = H;
  var ctx = c.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(v, s.fx * v.videoWidth, s.fy * v.videoHeight, s.fw * v.videoWidth, s.fh * v.videoHeight, 0, 0, W, H);
  var d = ctx.getImageData(0, 0, W, H).data, g = new Uint8Array(W * H);
  for(var i = 0, j = 0; i < d.length; i += 4, j++) g[j] = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) | 0;
  return g;
}
function sigDiff(a, b){
  var n = 0;
  for(var i = 0; i < a.length; i++) if(Math.abs(a[i] - b[i]) > 16) n++;
  return n / a.length;
}
function tick(){
  if(SC.mode !== 'live' || !FL || SC.paused || !$('liveAuto').checked) return;
  var v = $('liveVideo');
  if(!v.videoWidth) return;
  var sig = regionSig(), now = Date.now();
  if(SC.prevSig && sigDiff(SC.prevSig, sig) > SENS[$('liveSens').value]){
    if(!SC.pending) SC.firstChangeAt = now;
    SC.pending = true; SC.changedAt = now;
    setFloatStatus('偵測到畫面變化…');
  }
  SC.prevSig = sig;
  /* translate once the region has been still for 1.2 s (or after 6 s of constant change), at most every 2.5 s */
  if(SC.pending && !SC.busy && (now - SC.changedAt >= 1200 || now - SC.firstChangeAt >= 6000) && now - SC.lastRun >= 2500){
    SC.pending = false;
    runTranslate('auto');
  }
}
function startLoop(){
  stopLoop();
  SC.prevSig = null; SC.pending = false; SC.paused = false; SC.lastRun = 0;
  try{   /* a worker timer keeps ticking even when this tab is in the background */
    var blob = new Blob(['setInterval(function(){postMessage(1)},1000)'], {type: 'text/javascript'});
    SC.worker = new Worker(URL.createObjectURL(blob));
    SC.worker.onmessage = tick;
  }catch(e){
    SC.worker = null;
    SC.timer = setInterval(tick, 1000);
  }
  runTranslate('first');
}
function stopLoop(){
  if(SC.worker){ try{ SC.worker.terminate(); }catch(e){} SC.worker = null; }
  if(SC.timer){ clearInterval(SC.timer); SC.timer = null; }
}
async function runTranslate(reason){
  if(SC.mode !== 'live' || !FL) return;
  if(SC.busy){ SC.pending = true; return; }
  SC.busy = true;
  setFloatStatus('翻譯中…');
  try{
    var prepared = await canvasToPrepared(cropToCanvas(), 1600);
    var lines = await aiTranslateImage(prepared, srcSel.value, tgtSel.value);
    SC.lines = lines; SC.lastRun = Date.now();
    renderFloat();
    renderPairs($('resScreen'), lines, true);
    $('btnDlScreen').disabled = !lines.length;
    setFloatStatus('已更新 ' + new Date().toLocaleTimeString());
    SC.prevSig = regionSig();
  }catch(e){
    SC.lastRun = Date.now() + 8000;                       /* back off after an error */
    var m = errMsg(e);
    if(/狀態碼 (401|403|404)/.test(m)){ SC.paused = true; m += '（已自動暫停，請檢查設定）'; }
    setFloatStatus('翻譯失敗：' + m);
  }finally{
    SC.busy = false;
  }
}

/* ---- floating window (Document Picture-in-Picture, popup fallback) ---- */
function mk(d, tag, cls, text){
  var e = d.createElement(tag);
  if(cls) e.className = cls;
  if(text != null) e.textContent = text;
  return e;
}
function copyStyles(d){
  Array.prototype.forEach.call(document.styleSheets, function(ss){
    try{
      var css = Array.prototype.map.call(ss.cssRules, function(r){ return r.cssText; }).join('\n');
      var st = d.createElement('style'); st.textContent = css; d.head.appendChild(st);
    }catch(e){
      if(ss.href){ var l = d.createElement('link'); l.rel = 'stylesheet'; l.href = ss.href; d.head.appendChild(l); }
    }
  });
}
function syncTheme(){
  if(!FL || !FL.win) return;
  try{
    var t = document.documentElement.getAttribute('data-theme'), r = FL.win.document.documentElement;
    if(t) r.setAttribute('data-theme', t); else r.removeAttribute('data-theme');
  }catch(e){}
}
new MutationObserver(syncTheme).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});

function setFloatStatus(t){
  if(FL && FL.refs && FL.refs.status){ try{ FL.refs.status.textContent = t; }catch(e){} }
}
function buildFloatUI(win){
  var d = win.document;
  d.title = '即時翻譯';
  copyStyles(d); syncTheme();
  d.body.textContent = '';
  var wrap = mk(d, 'div', 'fl-wrap');
  var bar = mk(d, 'div', 'fl-bar');
  var status = mk(d, 'span', 'fl-status', '準備中…');
  bar.appendChild(mk(d, 'span', 'fl-dot'));
  bar.appendChild(mk(d, 'b', null, '即時翻譯'));
  bar.appendChild(status);
  var tools = mk(d, 'div', 'fl-tools');
  function addBtn(label, title, fn){
    var b = mk(d, 'button', 'fl-btn', label); b.title = title; b.addEventListener('click', fn); tools.appendChild(b); return b;
  }
  var bPause = addBtn('⏸', '暫停／繼續自動翻譯', function(){
    SC.paused = !SC.paused; bPause.textContent = SC.paused ? '▶' : '⏸';
    setFloatStatus(SC.paused ? '已暫停' : '偵測中…');
  });
  addBtn('🔄', '立即重新翻譯', function(){ runTranslate('manual'); });
  addBtn('A−', '縮小字級', function(){ FL.fontPx = Math.max(11, FL.fontPx - 2); renderFloat(); });
  addBtn('A+', '放大字級', function(){ FL.fontPx = Math.min(40, FL.fontPx + 2); renderFloat(); });
  addBtn('原文', '顯示／隱藏原文', function(){ FL.showOrig = !FL.showOrig; renderFloat(); });
  addBtn('📋', '複製譯文', async function(){
    var txt = (SC.lines || []).map(function(L){ return joinSents(L.pairs.map(function(p){ return p.t; }), tgtSel.value); }).join('\n');
    var ok = false;
    try{ await win.navigator.clipboard.writeText(txt); ok = true; }catch(e){ ok = await copyText(txt); }
    setFloatStatus(ok ? '已複製譯文' : '複製失敗');
  });
  var list = mk(d, 'div', 'fl-list');
  wrap.appendChild(bar); wrap.appendChild(tools); wrap.appendChild(list);
  d.body.appendChild(wrap);
  FL.refs = {status: status, list: list};
  renderFloat();
}
function renderFloat(){
  if(!FL || !FL.win || !FL.refs) return;
  try{
    var d = FL.win.document, list = FL.refs.list, any = false;
    list.textContent = '';
    list.style.fontSize = FL.fontPx + 'px';
    (SC.lines || []).forEach(function(L){
      (L.pairs || []).forEach(function(p){
        any = true;
        var row = mk(d, 'div', 'fl-row');
        if(FL.showOrig) row.appendChild(mk(d, 'div', 'fl-o', p.o));
        row.appendChild(mk(d, 'div', 'fl-t', p.t));
        list.appendChild(row);
      });
    });
    if(!any) list.appendChild(mk(d, 'div', 'fl-empty', '（尚未偵測到文字）'));
  }catch(e){}
}
async function openFloat(){
  if(FL){ closeFloat(); return; }
  if(SC.mode !== 'live'){ toast('請先按「開始擷取畫面」並框選區域', true); return; }
  if(IN_CLAUDE){ toast('懸浮即時翻譯需使用下載的獨立版。', true); return; }
  if(!aiImagesAvailable()){ imagesNotAvailable(); return; }
  var win = null, kind = 'inline';
  if('documentPictureInPicture' in window){
    try{ win = await window.documentPictureInPicture.requestWindow({width: 440, height: 560}); kind = 'pip'; }
    catch(e){ win = null; }
  }
  if(!win){
    try{
      win = window.open('', 'aiTranslatorFloat', 'popup=yes,width=440,height=560');
      if(win){
        kind = 'popup';
        win.document.open();
        win.document.write('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>即時翻譯</title></head><body></body></html>');
        win.document.close();
      }
    }catch(e){ win = null; }
  }
  FL = {win: win, kind: win ? kind : 'inline', fontPx: 17, showOrig: $('liveShowOrig').checked, refs: null};
  if(win){
    buildFloatUI(win);
    win.addEventListener('pagehide', function(){ if(FL && FL.win === win) closeFloat(true); });
    toast(kind === 'pip'
      ? '懸浮視窗已開啟，會保持在其他軟體上方。請把它拖到不會遮住所選區域的位置。'
      : '已開啟獨立小視窗（不一定會置頂；Windows 可用 PowerToys「Always on Top」，快捷鍵 Win+Ctrl+T）。');
  } else {
    toast('無法開啟懸浮視窗（可能被瀏覽器封鎖彈出視窗），改在頁面下方顯示即時結果。', true);
  }
  $('btnFloat').textContent = '❌ 關閉即時翻譯';
  startLoop();
}
function closeFloat(silent){
  stopLoop();
  var f = FL; FL = null;
  if(f && f.win){ try{ f.win.close(); }catch(e){} }
  var b = $('btnFloat');
  if(b) b.textContent = '🪟 開啟懸浮即時翻譯';
}
$('btnFloat').addEventListener('click', openFloat);
