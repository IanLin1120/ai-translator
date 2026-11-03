/* ============================================================
   電腦版／線上版「即時字幕」：瀏覽器語音辨識（Web Speech API）→（可選）翻譯 → 置頂小視窗或頁面內字幕。
   可完全不翻譯，只顯示聽到的原文。字型／大小／顏色／背景／透明度都能自訂。
   ============================================================ */
(function(){
if(window.AIT && typeof window.AIT.version === 'function') return;      /* APK 有原生版本 */
var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
var KEY = 'ait.wcap';
var DEF = {lang: 'auto', eng: 'none', where: 'pip', font: 'sans', size: 28, fg: '#ffffff', fg2: '#ffe066', bg: '#000000', op: 70, orig: true, track: false};
var P = Object.assign({}, DEF);
try{ Object.assign(P, JSON.parse(localStorage.getItem(KEY) || '{}')); }catch(e){}
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(P)); }catch(e){} }
var FONTS = {
  sans: ['系統預設黑體', '"Noto Sans TC","Microsoft JhengHei","PingFang TC",system-ui,sans-serif'],
  serif: ['明體／襯線', '"Noto Serif TC","PMingLiU","Songti TC",serif'],
  kai: ['楷體', '"BiauKai","DFKai-SB","Kaiti TC","KaiTi",serif'],
  round: ['圓體', '"Yuanti TC","Microsoft JhengHei UI","Arial Rounded MT Bold",sans-serif'],
  mono: ['等寬', 'ui-monospace,Consolas,Menlo,monospace']
};
var $ = function(id){ return document.getElementById(id); };
var running = false, rec = null, win = null, root = null, lines = [], interim = '', stream = null, seq = 0;

/* ---------- UI ---------- */
var css = document.createElement('style');
css.textContent = '#wcBtn{position:fixed;right:16px;bottom:16px;z-index:900;box-shadow:var(--shadow);border-radius:999px;padding:10px 16px;}' +
 '#wcPanel .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}#wcPanel input[type=range]{width:100%;}#wcPanel input[type=color]{width:100%;height:34px;padding:2px;border:1px solid var(--border-soft);border-radius:var(--radius-sm);background:var(--surface-3);}' +
 '#wcInline{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:950;width:min(92vw,900px);display:none;border-radius:12px;padding:10px 16px;text-align:center;cursor:move;}';
document.head.appendChild(css);

var btn = document.createElement('button');
btn.id = 'wcBtn'; btn.className = 'primary'; btn.textContent = '🎙 即時字幕';
document.body.appendChild(btn);

var mask = document.createElement('div');
mask.className = 'modal-mask'; mask.id = 'wcPanel';
var fontOpts = Object.keys(FONTS).map(function(k){ return '<option value="' + k + '">' + FONTS[k][0] + '</option>'; }).join('');
mask.innerHTML = '<div class="modal-box wide"><h3>🎙 即時字幕（聽到什麼就顯示什麼）</h3>' +
 '<div id="wcUnsup" class="note err" style="display:none;"></div>' +
 '<div class="row2"><div class="field"><label class="lbl">說話的語言</label><select id="wcLang"></select></div>' +
 '<div class="field"><label class="lbl">翻譯方式</label><select id="wcEng"></select></div></div>' +
 '<div class="field"><label class="lbl">字幕顯示在</label><select id="wcWhere"><option value="pip">置頂小視窗（可蓋在其他軟體上方，Chrome／Edge）</option><option value="page">本頁面底部（可拖曳）</option></select></div>' +
 '<div class="row2"><div class="field"><label class="lbl">字型</label><select id="wcFont">' + fontOpts + '</select></div>' +
 '<div class="field"><label class="lbl">字體大小：<span id="wcSizeV"></span> px</label><input type="range" id="wcSize" min="14" max="72" step="1"></div></div>' +
 '<div class="row2" style="grid-template-columns:repeat(3,1fr);"><div class="field"><label class="lbl">原文顏色</label><input type="color" id="wcFg"></div>' +
 '<div class="field"><label class="lbl">譯文顏色</label><input type="color" id="wcFg2"></div>' +
 '<div class="field"><label class="lbl">背景顏色</label><input type="color" id="wcBg"></div></div>' +
 '<div class="field"><label class="lbl">背景不透明度：<span id="wcOpV"></span>%</label><input type="range" id="wcOp" min="0" max="100" step="5"></div>' +
 '<label class="chk-line"><input type="checkbox" id="wcOrig"> 翻譯時同時顯示原文</label>' +
 '<label class="chk-line"><input type="checkbox" id="wcTrack"> 嘗試辨識「分享的分頁／系統聲音」（需新版 Chrome；不支援會自動改用麥克風）</label>' +
 '<div class="field"><div id="wcPrev" style="border-radius:10px;padding:10px 14px;text-align:center;margin-top:6px;">字幕預覽 Subtitle preview</div></div>' +
 '<div class="note">原理：瀏覽器內建語音辨識，預設聽「麥克風」。要翻譯影片／音檔，請用喇叭播放讓麥克風收得到（或勾選上面的分頁聲音選項）；視訊通話建議開喇叭。辨識由瀏覽器供應商（Chrome 為 Google）處理語音。選「不翻譯」就只顯示辨識出的原文。</div>' +
 '<div class="btn-row"><button class="primary" id="wcGo">開始字幕</button><button class="secondary" id="wcClose">關閉視窗</button></div></div>';
document.body.appendChild(mask);

var inl = document.createElement('div');
inl.id = 'wcInline'; document.body.appendChild(inl);

function fill(){
  var ls = $('wcLang'); ls.innerHTML = '';
  var auto = document.createElement('option'); auto.value = 'auto'; auto.textContent = '跟隨瀏覽器語言（' + (navigator.language || 'zh-TW') + '）'; ls.appendChild(auto);
  (window.LANGS || []).forEach(function(l){ if(l.code === 'auto') return; var o = document.createElement('option'); o.value = l.code; o.textContent = l.name; ls.appendChild(o); });
  var es = $('wcEng'); es.innerHTML = '<option value="none">不翻譯（只顯示聽到的原文）</option>';
  Array.prototype.forEach.call(engineSel.options, function(o){ if(o.hidden || o.value === 'sub') return; var n = document.createElement('option'); n.value = o.value; n.textContent = '翻譯：' + o.textContent; es.appendChild(n); });
  $('wcLang').value = P.lang; $('wcEng').value = P.eng; $('wcWhere').value = P.where; $('wcFont').value = P.font;
  if(!$('wcEng').value) $('wcEng').value = 'none';
  $('wcSize').value = P.size; $('wcFg').value = P.fg; $('wcFg2').value = P.fg2; $('wcBg').value = P.bg; $('wcOp').value = P.op;
  $('wcOrig').checked = P.orig; $('wcTrack').checked = P.track;
  var pip = ('documentPictureInPicture' in window);
  if(!pip){ $('wcWhere').value = 'page'; P.where = 'page'; $('wcWhere').options[0].disabled = true; }
  var msg = '';
  if(!SR) msg = '這個瀏覽器沒有語音辨識功能，請改用電腦版 Chrome 或 Edge。';
  else if(window.claude && typeof window.claude.use === 'function') msg = 'Claude.ai 內嵌頁面無法使用麥克風，請下載獨立版 html 或使用線上版網址開啟。';
  $('wcUnsup').style.display = msg ? '' : 'none'; $('wcUnsup').textContent = msg;
  $('wcGo').disabled = !!msg;
  preview();
}
function readUi(){
  P.lang = $('wcLang').value; P.eng = $('wcEng').value; P.where = $('wcWhere').value; P.font = $('wcFont').value;
  P.size = +$('wcSize').value; P.fg = $('wcFg').value; P.fg2 = $('wcFg2').value; P.bg = $('wcBg').value; P.op = +$('wcOp').value;
  P.orig = $('wcOrig').checked; P.track = $('wcTrack').checked; save();
}
function rgba(hex, a){ var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
function styleBox(el){
  el.style.background = rgba(P.bg, P.op / 100); el.style.fontFamily = FONTS[P.font][1];
  el.style.fontSize = P.size + 'px'; el.style.lineHeight = '1.35'; el.style.color = P.fg;
}
function preview(){
  $('wcSizeV').textContent = P.size; $('wcOpV').textContent = P.op;
  var p = $('wcPrev'); styleBox(p); p.style.fontSize = Math.min(P.size, 34) + 'px';
  p.innerHTML = '<div style="color:' + P.fg + '">Hello, this is a subtitle.</div>' + (P.eng !== 'none' ? '<div style="color:' + P.fg2 + '">你好，這是字幕。</div>' : '');
}
['wcLang', 'wcEng', 'wcWhere', 'wcFont', 'wcSize', 'wcFg', 'wcFg2', 'wcBg', 'wcOp', 'wcOrig', 'wcTrack'].forEach(function(id){
  $(id).addEventListener('input', function(){ readUi(); preview(); render(); });
  $(id).addEventListener('change', function(){ readUi(); preview(); render(); });
});
fill();
btn.addEventListener('click', function(){ if(running) return; fill(); mask.classList.add('show'); });
$('wcClose').addEventListener('click', function(){ mask.classList.remove('show'); });
$('wcGo').addEventListener('click', function(){ if(running) stop(); else start(); });

/* ---------- 字幕畫面 ---------- */
function esc(s){ return String(s).replace(/[&<>]/g, function(c){ return {'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]; }); }
function render(){
  var tr = P.eng !== 'none';
  var html = '';
  var shown = lines.slice(-2);
  shown.forEach(function(l){
    if(tr){
      if(P.orig) html += '<div style="color:' + P.fg + ';font-size:' + Math.round(P.size * 0.72) + 'px;opacity:.9">' + esc(l.o) + '</div>';
      html += '<div style="color:' + P.fg2 + '">' + esc(l.t == null ? '…' : l.t) + '</div>';
    } else html += '<div style="color:' + P.fg + '">' + esc(l.o) + '</div>';
  });
  if(interim) html += '<div style="color:' + P.fg + ';opacity:.6;' + (tr ? 'font-size:' + Math.round(P.size * 0.72) + 'px' : '') + '">' + esc(interim) + '</div>';
  if(!html && running) html = '<div style="opacity:.5;font-size:' + Math.round(P.size * 0.6) + 'px;color:' + P.fg + '">（聆聽中…）</div>';
  var el = root || inl;
  if(!running){ inl.style.display = 'none'; return; }
  styleBox(el); el.innerHTML = html;
  if(el === inl) inl.style.display = 'block';
  else inl.style.display = 'none';
}
async function openOut(){
  root = null;
  if(P.where === 'pip' && 'documentPictureInPicture' in window){
    try{
      win = await documentPictureInPicture.requestWindow({width: 620, height: 190});
      win.document.body.style.cssText = 'margin:0;display:flex;align-items:flex-end;height:100vh;background:#111;';
      root = win.document.createElement('div'); root.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 14px;text-align:center;';
      win.document.body.appendChild(root);
      win.addEventListener('pagehide', function(){ if(running) stop(true); });
    }catch(e){ win = null; root = null; toast('無法開啟置頂視窗，改在頁面底部顯示。', true); }
  }
}
(function drag(){
  var sx, sy, ox, oy, on = false;
  inl.addEventListener('pointerdown', function(e){ on = true; sx = e.clientX; sy = e.clientY; var r = inl.getBoundingClientRect(); ox = r.left; oy = r.top; inl.setPointerCapture(e.pointerId); });
  inl.addEventListener('pointermove', function(e){ if(!on) return; inl.style.transform = 'none'; inl.style.left = (ox + e.clientX - sx) + 'px'; inl.style.top = (oy + e.clientY - sy) + 'px'; inl.style.bottom = 'auto'; });
  inl.addEventListener('pointerup', function(){ on = false; });
})();

/* ---------- 辨識 ---------- */
function recLang(){
  if(P.lang === 'auto') return navigator.language || 'zh-TW';
  var m = {'zh-TW': 'zh-TW', 'zh-CN': 'zh-CN', 'zh': 'zh-TW', 'en': 'en-US', 'ja': 'ja-JP', 'ko': 'ko-KR', 'es': 'es-ES', 'fr': 'fr-FR', 'de': 'de-DE', 'pt': 'pt-BR', 'ru': 'ru-RU', 'it': 'it-IT', 'th': 'th-TH', 'vi': 'vi-VN', 'id': 'id-ID', 'ar': 'ar-SA', 'hi': 'hi-IN'};
  return m[P.lang] || P.lang;
}
async function translateLine(l){
  var my = ++seq;
  try{
    var r = await translateBatch([l.o], {sourceLang: P.lang === 'auto' ? 'auto' : P.lang, targetLang: tgtSel.value});
    l.t = (r && r[0]) || l.o;
  }catch(e){ l.t = l.o; }
  render();
}
function startRec(){
  rec = new SR();
  rec.continuous = true; rec.interimResults = true; rec.lang = recLang();
  rec.onresult = function(ev){
    var fin = '';
    interim = '';
    for(var i = ev.resultIndex; i < ev.results.length; i++){
      var t = ev.results[i][0].transcript;
      if(ev.results[i].isFinal) fin += t; else interim += t;
    }
    if(fin.trim()){
      var l = {o: fin.trim(), t: P.eng === 'none' ? undefined : null};
      lines.push(l); if(lines.length > 6) lines.shift();
      interim = '';
      if(P.eng !== 'none') translateLine(l);
    }
    render();
  };
  rec.onerror = function(e){
    if(e.error === 'not-allowed' || e.error === 'service-not-allowed'){ toast('麥克風權限被拒絕，請在網址列允許使用麥克風。', true); stop(true); }
    else if(e.error === 'audio-capture'){ toast('找不到麥克風。', true); stop(true); }
  };
  rec.onend = function(){ if(running){ try{ rec.lang = recLang(); startOne(); }catch(e){ setTimeout(function(){ if(running) startOne(); }, 400); } } };
  startOne();
}
function startOne(){
  if(stream){
    var tr = stream.getAudioTracks()[0];
    try{ rec.start(tr); return; }catch(e){ stream = null; toast('此瀏覽器不能直接辨識分享的聲音，已改用麥克風（請用喇叭播放）。', true); }
  }
  rec.start();
}
async function start(){
  readUi();
  if(P.eng !== 'none'){
    engineSel.value = P.eng; try{ engineSel.dispatchEvent(new Event('change')); }catch(e){}
    if(window.ENX && ENX.missingKey && ENX.missingKey(P.eng)){ toast('這個翻譯引擎尚未設定金鑰，請先到「設定」填寫，或選「不翻譯」。', true); return; }
  }
  lines = []; interim = ''; running = true;
  if(P.track){
    try{ stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true}); if(!stream.getAudioTracks().length){ stream.getTracks().forEach(function(t){ t.stop(); }); stream = null; toast('沒有取得分享的聲音（分享時請勾選「同時分享分頁音訊」），改用麥克風。', true); } }
    catch(e){ stream = null; }
  }
  await openOut();
  mask.classList.remove('show');
  $('wcGo').textContent = '停止字幕'; btn.textContent = '⏹ 停止字幕'; btn.classList.add('danger');
  render();
  try{ startRec(); }catch(e){ toast('無法啟動語音辨識：' + (e && e.message || e), true); stop(true); }
}
function stop(silent){
  running = false;
  try{ rec && (rec.onend = null, rec.stop()); }catch(e){}
  rec = null;
  if(stream){ stream.getTracks().forEach(function(t){ t.stop(); }); stream = null; }
  if(win){ try{ win.close(); }catch(e){} win = null; }
  root = null; inl.style.display = 'none';
  $('wcGo').textContent = '開始字幕'; btn.textContent = '🎙 即時字幕'; btn.classList.remove('danger');
}
btn.addEventListener('click', function(){ if(running){ stop(); mask.classList.remove('show'); } });
window.WCAP = {open: function(){ if(running) return; fill(); mask.classList.add('show'); }, start: start, stop: stop, running: function(){ return running; }};
})();
