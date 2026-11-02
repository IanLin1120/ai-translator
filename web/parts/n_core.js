
/* ============================================================
   2. CORE: utilities, settings, AI engine, Google engine, export
   ============================================================ */
function $(id){ return document.getElementById(id); }
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
var SAMPLE_ERR = {
  not_granted: '尚未允許此頁面使用 Claude',
  rate_limited: '呼叫過於頻繁或已達用量上限，請稍後再試',
  sampling_disabled: '此帳號目前無法使用 Claude',
  images_unavailable: '此環境未開放圖片辨識',
  image_rejected: '圖片格式或大小不符',
  invalid_json: 'AI 回傳格式不正確，請重試',
  upstream_error: '連線不穩，請重試',
  session_expired: '登入已逾時，請重新整理頁面'
};
function errMsg(e){
  if(!e) return '未知錯誤';
  if(typeof e === 'string') return e;
  if(e.code && SAMPLE_ERR[e.code]) return SAMPLE_ERR[e.code];
  return String(e.message || e.code || e);
}
var toastTimer = null;
function toast(msg, warn){
  var el = $('toast');
  if(!el){ console.log(msg); return; }
  el.textContent = msg;
  el.className = 'toast show' + (warn ? ' warn' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.className = 'toast'; }, warn ? 8000 : 4500);
}

/* ---------- environment + settings ---------- */
var IN_CLAUDE = !!(window.claude && typeof window.claude.use === 'function');
var CFG = {anthropicKey: '', model: 'claude-sonnet-5-5', gKey: '', autoFallback: true, remember: false};
(function loadCfg(){
  try{
    var j = JSON.parse(localStorage.getItem('ai-translator-cfg') || '{}');
    if(j && typeof j === 'object'){
      ['anthropicKey', 'model', 'gKey'].forEach(function(k){ if(typeof j[k] === 'string' && j[k]) CFG[k] = j[k]; });
      if(typeof j.autoFallback === 'boolean') CFG.autoFallback = j.autoFallback;
      CFG.remember = !!(j.anthropicKey || j.gKey);
    }
    var legacy = localStorage.getItem('ai-translator-api-key');   /* key saved by the earlier offline version */
    if(legacy && !CFG.anthropicKey){ CFG.anthropicKey = legacy; CFG.remember = true; }
  }catch(e){}
})();
function saveCfg(){
  try{
    var o = {model: CFG.model, autoFallback: CFG.autoFallback};
    if(CFG.remember){ o.anthropicKey = CFG.anthropicKey; o.gKey = CFG.gKey; }
    localStorage.setItem('ai-translator-cfg', JSON.stringify(o));
    if(!CFG.remember) localStorage.removeItem('ai-translator-api-key');
  }catch(e){}
}

var engineSel = $('engineSel');
var enginePill = $('engineStatus');
var sampleFn = null, sampleImages = false, downloadsFn = null;

function aiAvailable(){ return IN_CLAUDE ? !!sampleFn : !!CFG.anthropicKey; }
function aiImagesAvailable(){ return IN_CLAUDE ? (!!sampleFn && sampleImages) : !!CFG.anthropicKey; }
function textEngineReady(){ return engineSel.value === 'google' || aiAvailable(); }
function engineNotReady(){
  if(IN_CLAUDE){
    toast('AI 引擎目前不可用（需允許此頁面使用 Claude），可先改選 Google 翻譯。', true);
  } else {
    openSettings();
    toast('請先設定 Anthropic API 金鑰，或改選 Google 翻譯。', true);
  }
}
function updateEnginePill(){
  var ready, txt;
  if(engineSel.value === 'google'){
    ready = true;
    txt = CFG.gKey ? 'Google 翻譯（官方 API）' : 'Google 翻譯（免費）';
  } else if(IN_CLAUDE){
    ready = !!sampleFn;
    txt = ready ? 'AI 翻譯引擎已就緒' : 'AI 引擎不可用';
  } else {
    ready = !!CFG.anthropicKey;
    txt = ready ? ('AI 翻譯引擎已就緒（' + CFG.model.replace('claude-', '') + '）') : '尚未設定 API 金鑰';
  }
  enginePill.textContent = txt;
  enginePill.className = 'status-pill ' + (ready ? 'ok' : 'bad');
}
engineSel.addEventListener('change', updateEnginePill);

(async function initEnvironment(){
  if(IN_CLAUDE){
    try{
      sampleFn = await window.claude.use('sample');
      if(sampleFn){
        try{ var lim = await sampleFn.limits(); sampleImages = !!(lim && lim.images); }catch(e){}
      }
    }catch(e){ sampleFn = null; }
    try{ downloadsFn = await window.claude.use('downloads'); }catch(e){ downloadsFn = null; }
  }
  updateEnginePill();
})();

/* ---------- settings dialog ---------- */
function openSettings(){
  $('rowAnthropic').style.display = IN_CLAUDE ? 'none' : '';
  $('setAnthropicKey').value = CFG.anthropicKey;
  var sm = $('setModel');
  sm.value = CFG.model;
  if(sm.value !== CFG.model) sm.value = 'claude-sonnet-5-5';
  $('setGKey').value = CFG.gKey;
  $('setRemember').checked = CFG.remember;
  $('setFallback').checked = CFG.autoFallback;
  $('setModal').classList.add('show');
}
function closeSettings(){
  $('setModal').classList.remove('show');
  try{ localStorage.setItem('ai-translator-seen', '1'); }catch(e){}
}
$('btnSettings').addEventListener('click', openSettings);
$('btnSetClose').addEventListener('click', closeSettings);
$('btnSetSave').addEventListener('click', function(){
  CFG.anthropicKey = $('setAnthropicKey').value.trim();
  CFG.model = $('setModel').value;
  CFG.gKey = $('setGKey').value.trim();
  CFG.remember = $('setRemember').checked;
  CFG.autoFallback = $('setFallback').checked;
  saveCfg();
  closeSettings();
  updateEnginePill();
  toast('設定已儲存');
});
(function firstRun(){
  if(IN_CLAUDE) return;
  if(!CFG.anthropicKey){
    engineSel.value = 'google';            /* no key yet: Google works out of the box */
    var seen = false; try{ seen = !!localStorage.getItem('ai-translator-seen'); }catch(e){}
    if(!seen){ try{ localStorage.setItem('ai-translator-seen','1'); }catch(e){} toast('目前使用免費的 Google 翻譯；想用 AI 翻譯可到右上角「設定」填入自己的 API 金鑰'); }
  }
  updateEnginePill();
})();

/* ---------- AI engine (Claude) ---------- */
async function callAIJson(prompt, imgs){
  imgs = imgs || [];
  if(IN_CLAUDE){
    if(!sampleFn) throw new Error('AI 引擎尚未就緒');
    var o = {modelTier: 'default'};
    if(imgs.length) o.images = imgs.map(function(x){ return x.blob; });
    return await sampleFn.json(prompt, o);
  }
  if(!CFG.anthropicKey){ openSettings(); throw new Error('尚未設定 Anthropic API 金鑰'); }
  var content = [];
  imgs.forEach(function(x){ content.push({type: 'image', source: {type: 'base64', media_type: x.mime, data: x.b64}}); });
  content.push({type: 'text', text: prompt});
  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': CFG.anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({model: CFG.model, max_tokens: 8192, messages: [{role: 'user', content: content}]})
  });
  if(!resp.ok){
    var t = await resp.text().catch(function(){ return ''; });
    var hint = resp.status === 401 ? '（金鑰無效）' : resp.status === 404 ? '（找不到模型，請到「設定」改選模型）' : resp.status === 429 ? '（用量或速率限制）' : '';
    throw new Error('API 呼叫失敗，狀態碼 ' + resp.status + hint + ' ' + t.slice(0, 160));
  }
  var data = await resp.json();
  var text = (data.content || []).filter(function(b){ return b.type === 'text'; }).map(function(b){ return b.text; }).join('\n');
  return parseJsonLoose(text);
}

/* texts -> translated texts (same order). Failed chunks keep the original text. */
async function aiTranslateBatch(texts, opts){
  opts = opts || {};
  var srcName = opts.sourceLang === 'auto' ? '（請自動偵測原文語言，原文可能夾雜多種語言）' : langName(opts.sourceLang);
  var tgtName = langName(opts.targetLang);
  var out = new Array(texts.length), failed = 0, needed = 0, lastErr = null;
  var CHUNK = 40, CHARS = 4000, chunks = [], cur = [], curLen = 0, i;
  for(i = 0; i < texts.length; i++){
    var t = texts[i] || '';
    if(cur.length >= CHUNK || (curLen + t.length) > CHARS){
      if(cur.length){ chunks.push(cur); cur = []; curLen = 0; }
    }
    cur.push(i); curLen += t.length;
  }
  if(cur.length) chunks.push(cur);

  var done = 0;
  for(var c = 0; c < chunks.length; c++){
    var idxs = chunks[c];
    var items = idxs.map(function(k){ return {i: k, t: texts[k]}; });
    var toSend = items.filter(function(it){ return needsTranslate(it.t); });
    items.forEach(function(it){ if(!needsTranslate(it.t)) out[it.i] = it.t; });
    if(toSend.length){
      needed += toSend.length;
      var prompt = '你是專業的多語言翻譯引擎。把下列 JSON 陣列中每個項目的 "t" 從' + srcName + '翻譯成' + tgtName + '。\n' +
        '規則：\n1) 每個項目通常是一句話，請依前後項目的上下文做自然、專業、符合語境的翻譯；\n' +
        '2) 數字、型號、代碼、網址、單位、專有名詞與縮寫保持原樣；\n3) 不要加解釋、不要合併或拆分項目；\n' +
        '4) 回傳陣列的長度與每個 "i" 必須與輸入完全一致；\n5) 只回傳 JSON，不要任何前後說明或 markdown。\n\n輸入：\n' +
        JSON.stringify(toSend) + '\n\n回傳格式：[{"i":數字,"t":"翻譯後文字"}, ...]';
      var res = null;
      for(var attempt = 0; attempt < 2 && !res; attempt++){
        try{ res = await callAIJson(prompt); }
        catch(e){
          lastErr = e;
          var m = errMsg(e);
          if((e && (e.code === 'not_granted' || e.code === 'rate_limited' || e.code === 'sampling_disabled')) || /狀態碼 (401|403|404|429)/.test(m)) break;
          await sleep(700);
        }
      }
      var arr = Array.isArray(res) ? res : (res && res.items) || null;
      if(arr){
        var by = {};
        arr.forEach(function(r){ if(r && typeof r.i !== 'undefined') by[r.i] = r.t; });
        toSend.forEach(function(it){
          if(typeof by[it.i] === 'string' && by[it.i].length){ out[it.i] = by[it.i]; }
          else { out[it.i] = it.t; failed++; }
        });
      } else {
        toSend.forEach(function(it){ out[it.i] = it.t; });
        failed += toSend.length;
      }
    }
    done += idxs.length;
    if(opts.onProgress) opts.onProgress(done, texts.length);
  }
  aiTranslateBatch.lastFailed = failed;
  aiTranslateBatch.lastNeeded = needed;
  aiTranslateBatch.lastError = lastErr;
  return out;
}

/* ---------- images ---------- */
function loadImageToCanvas(file, maxSide){
  return new Promise(function(resolve, reject){
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function(){
      var w = img.naturalWidth, h = img.naturalHeight;
      var s = Math.min(1, (maxSide || 3200) / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
      var x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('無法讀取這張圖片（格式不支援，請改用 JPG / PNG / WEBP）')); };
    img.src = url;
  });
}
/* canvas -> {blob, b64, mime}; small crops stay PNG (crisp text), big ones become JPEG */
function canvasToPrepared(canvas, maxSide){
  return new Promise(function(resolve, reject){
    var s = Math.min(1, (maxSide || 1800) / Math.max(canvas.width, canvas.height));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * s)); c.height = Math.max(1, Math.round(canvas.height * s));
    var x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(canvas, 0, 0, c.width, c.height);
    var png = (c.width * c.height) < 1500000;
    var mime = png ? 'image/png' : 'image/jpeg';
    var b64 = c.toDataURL(mime, 0.92).split(',')[1];
    c.toBlob(function(b){ b ? resolve({blob: b, b64: b64, mime: mime}) : reject(new Error('圖片轉換失敗')); }, mime, 0.92);
  });
}
/* OCR + translate; returns lines [{orig, pairs:[{o,t}]}] one sentence / label per pair */
async function aiTranslateImage(prepared, sourceLang, targetLang){
  var srcName = sourceLang === 'auto' ? '自動偵測' : langName(sourceLang);
  var tgtName = langName(targetLang);
  var prompt = '請辨識這張圖片中的所有文字（依閱讀順序：由上到下、由左到右），來源語言：' + srcName + '，並翻譯成' + tgtName + '。' +
    '請「每一句話或每一個獨立的文字標籤」各拆成一個項目，不要把多句話合併在同一項。' +
    '格式：[{"original":"原文一句","translated":"對應的一句譯文"}]。只回傳 JSON 陣列，不要任何說明；若圖片中沒有文字，回傳 []。';
  var res = await callAIJson(prompt, [prepared]);
  return linesFromBlocks(Array.isArray(res) ? res : (res && res.items) || []);
}

/* ---------- Google engine ---------- */
var G = {ep: 0, cache: new Map()};
var G_EPS = [
  {base: 'https://translate.googleapis.com/translate_a/single', params: {client: 'gtx', dt: 't'}},
  {base: 'https://translate.google.com/translate_a/single', params: {client: 'gtx', dt: 't'}},
  {base: 'https://clients5.google.com/translate_a/t', params: {client: 'dict-chrome-ex'}}
];
function gParse(data){
  if(Array.isArray(data)){
    if(Array.isArray(data[0])){
      var first = data[0];
      if(Array.isArray(first[0])) return first.map(function(s){ return (s && s[0]) || ''; }).join('');
      if(typeof first[0] === 'string') return first[0];
    }
    if(typeof data[0] === 'string') return data[0];
  } else if(data && Array.isArray(data.sentences)){
    return data.sentences.map(function(s){ return s.trans || ''; }).join('');
  }
  throw new Error('unexpected-format');
}
async function gFetchOne(ep, text, sl, tl){
  var qs = new URLSearchParams(Object.assign({sl: sl, tl: tl, ie: 'UTF-8', oe: 'UTF-8'}, ep.params)).toString();
  var enc = encodeURIComponent(text), resp;
  if(enc.length < 1800){
    resp = await fetch(ep.base + '?' + qs + '&q=' + enc);
  } else {
    resp = await fetch(ep.base + '?' + qs, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'}, body: 'q=' + enc});
  }
  if(!resp.ok){ var e = new Error('http-' + resp.status); e.status = resp.status; throw e; }
  return gParse(await resp.json());
}
async function gTranslateOne(text, sl, tl){
  var key = sl + '|' + tl + '|' + text;
  if(G.cache.has(key)) return G.cache.get(key);
  var lastErr = null;
  for(var round = 0; round < 2; round++){
    for(var k = 0; k < G_EPS.length; k++){
      var idx = (G.ep + k) % G_EPS.length;
      try{
        var r = await gFetchOne(G_EPS[idx], text, sl, tl);
        G.ep = idx; G.cache.set(key, r);
        return r;
      }catch(e){
        lastErr = e;
        if(e && (e.status === 429 || e.status >= 500)) await sleep(700 + Math.random() * 600);
      }
    }
    await sleep(350);
  }
  throw lastErr || new Error('google-failed');
}
/* Official Cloud Translation API (needs the user's own key; batches up to 100 strings) */
async function gOfficial(texts, sl, tl){
  var out = new Array(texts.length).fill(null), i = 0;
  while(i < texts.length){
    var start = i, group = [], chars = 0;
    while(i < texts.length && group.length < 100 && (group.length === 0 || chars + texts[i].length < 20000)){
      group.push(texts[i]); chars += texts[i].length; i++;
    }
    try{
      var body = {q: group, target: tl, format: 'text'};
      if(sl !== 'auto') body.source = sl;
      var resp = await fetch('https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(CFG.gKey), {
        method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)
      });
      if(!resp.ok) throw new Error('http-' + resp.status);
      var data = await resp.json();
      data.data.translations.forEach(function(t, k){ out[start + k] = t.translatedText; });
    }catch(e){ gOfficial.lastError = e; }
  }
  return out;
}
async function googleBatch(texts, opts){
  var sl = opts.sourceLang || 'auto', tl = opts.targetLang;
  var out = texts.slice(), failed = [], total = texts.length, done = 0;
  var uniq = new Map();
  texts.forEach(function(t, i){
    if(!needsTranslate(t)){ done++; return; }
    if(!uniq.has(t)) uniq.set(t, []);
    uniq.get(t).push(i);
  });
  var pending = Array.from(uniq.keys());
  function tick(n){ done += n; if(opts.onProgress) opts.onProgress(done, total); }
  if(CFG.gKey && pending.length){
    var res = await gOfficial(pending, sl, tl), rest = [];
    pending.forEach(function(k, j){
      if(res[j] != null){ uniq.get(k).forEach(function(i){ out[i] = res[j]; }); tick(uniq.get(k).length); }
      else rest.push(k);
    });
    if(rest.length === pending.length) toast('Google 官方 API 呼叫失敗（金鑰錯誤或尚未啟用 Cloud Translation API？），改用免金鑰端點。', true);
    pending = rest;
  }
  var idx = 0, consecFail = 0, anyOk = false, aborted = false;
  async function worker(){
    while(idx < pending.length){
      var k = pending[idx++];
      var ids = uniq.get(k);
      if(aborted){ ids.forEach(function(i){ failed.push(i); }); tick(ids.length); continue; }
      try{
        var r = await gTranslateOne(k, sl, tl);
        ids.forEach(function(i){ out[i] = r; });
        anyOk = true; consecFail = 0;
      }catch(e){
        ids.forEach(function(i){ failed.push(i); });
        if(++consecFail >= 6 && !anyOk) aborted = true;      /* endpoint blocked: stop hammering it */
      }
      tick(ids.length);
      await sleep(50);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  failed.sort(function(a, b){ return a - b; });
  return {out: out, failed: failed};
}

/* One entry point for every plain-text translation (text / Excel / Word / PDF / mail). */
async function translateBatch(texts, opts){
  opts = opts || {};
  if(engineSel.value === 'google'){
    var g = await googleBatch(texts, opts);
    if(g.failed.length){
      if(CFG.autoFallback && aiAvailable()){
        var sub = g.failed.map(function(i){ return texts[i]; });
        var ai = await aiTranslateBatch(sub, {sourceLang: opts.sourceLang, targetLang: opts.targetLang});
        g.failed.forEach(function(i, k){ g.out[i] = ai[k]; });
        toast('Google 翻譯有 ' + g.failed.length + ' 句失敗，已自動改用 AI 補譯。');
      } else {
        toast('Google 翻譯有 ' + g.failed.length + ' 句失敗，已保留原文。可在「設定」填入 Google Cloud 金鑰、開啟自動補譯，或改選 AI 翻譯。', true);
      }
    }
    return g.out;
  }
  if(!aiAvailable()){ engineNotReady(); throw new Error('AI 引擎尚未就緒'); }
  var r = await aiTranslateBatch(texts, opts);
  if(aiTranslateBatch.lastNeeded && aiTranslateBatch.lastFailed >= aiTranslateBatch.lastNeeded && aiTranslateBatch.lastError){
    throw aiTranslateBatch.lastError;                    /* nothing was translated: tell the user why */
  }
  if(aiTranslateBatch.lastFailed) toast('有 ' + aiTranslateBatch.lastFailed + ' 句翻譯失敗，已保留原文，可再按一次重試。', true);
  return r;
}

/* ---------- saving files ---------- */
async function saveFile(filename, data, mime){
  var blob = (data instanceof Blob) ? data : new Blob([data], {type: mime || 'application/octet-stream'});
  if(downloadsFn){
    try{ await downloadsFn.save({filename: filename, data: blob}); return true; }
    catch(e){
      if(e && e.code === 'declined') return false;       /* viewer said no: not an error */
    }
  }
  try{
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    return true;
  }catch(e){
    toast('下載失敗：' + errMsg(e), true);
    return false;
  }
}

/* ---------- export dialog (output version + custom file name) ---------- */
var EX = {cfg: null, mode: 'trans', fi: 0, touched: false};
var EX_MODES = {trans: '僅翻譯內容', both: '原文＋翻譯（逐句對照）', orig: '僅原文'};
function exPrefs(){ try{ return JSON.parse(localStorage.getItem('ai-translator-exp') || '{}') || {}; }catch(e){ return {}; } }
function exSavePrefs(){
  try{ localStorage.setItem('ai-translator-exp', JSON.stringify({mode: EX.mode, layout: $('exLayout').value, blank: $('exBlank').checked, prefix: $('exPrefix').value})); }catch(e){}
}
function exFmt(){ return EX.cfg.formats[EX.fi]; }
function exOpts(){ return {layout: $('exLayout').value, blank: $('exBlank').checked, prefix: $('exPrefix').value}; }
function nameSet(base){
  return {trans: base + '-' + langFile(tgtSel.value), both: base + '-雙語對照', orig: base + '-原文'};
}
function openExport(cfg){
  EX.cfg = cfg; EX.fi = 0; EX.touched = false;
  var p = exPrefs();
  $('exLayout').value = p.layout || 'stack';
  $('exBlank').checked = p.blank !== false;
  $('exPrefix').value = p.prefix || '';
  EX.mode = p.mode || 'trans';
  $('exTitle').textContent = cfg.title || '匯出翻譯結果';
  var sel = $('exFmt'); sel.textContent = '';
  cfg.formats.forEach(function(f, i){
    var o = document.createElement('option'); o.value = String(i); o.textContent = f.label || f.ext; sel.appendChild(o);
  });
  $('exFmtRow').style.display = cfg.formats.length > 1 ? '' : 'none';
  exRefresh(true);
  $('exModal').classList.add('show');
  setTimeout(function(){ try{ $('exName').focus(); $('exName').select(); }catch(e){} }, 30);
}
function closeExport(){ $('exModal').classList.remove('show'); }
function exRefresh(resetName){
  var f = exFmt(), modes = f.modes || null;
  if(!modes) EX.mode = 'trans';
  else if(modes.indexOf(EX.mode) < 0) EX.mode = modes[0];
  var box = $('exModeBox'); box.textContent = '';
  $('exModeRow').style.display = modes && modes.length > 1 ? '' : 'none';
  if(modes) modes.forEach(function(m){
    var lab = document.createElement('label'); lab.className = 'opt' + (m === EX.mode ? ' on' : '');
    var r = document.createElement('input'); r.type = 'radio'; r.name = 'exMode'; r.value = m; r.checked = (m === EX.mode);
    r.addEventListener('change', function(){ EX.mode = m; exRefresh(!EX.touched); });
    lab.appendChild(r); lab.appendChild(document.createTextNode(' ' + EX_MODES[m]));
    box.appendChild(lab);
  });
  $('exBothOpts').style.display = (modes && EX.mode === 'both') ? '' : 'none';
  $('exExt').textContent = f.ext;
  if(resetName) $('exName').value = EX.cfg.names[EX.mode] || EX.cfg.names.trans || '翻譯結果';
  var pw = $('exPreviewWrap');
  if(f.text){
    pw.style.display = '';
    var t = f.text(EX.mode, exOpts()), ls = t.split('\n');
    var shown = ls.slice(0, 16).join('\n');
    if(shown.length > 1600) shown = shown.slice(0, 1600);
    $('exPreview').textContent = shown + ((ls.length > 16 || t.length > shown.length) ? '\n…（預覽僅顯示開頭）' : '');
    $('exHint').textContent = '';
  } else {
    pw.style.display = 'none';
    $('exHint').textContent = '此格式為二進位檔案，沒有文字預覽。';
  }
}
$('exFmt').addEventListener('change', function(){ EX.fi = parseInt(this.value, 10) || 0; exRefresh(!EX.touched); });
$('exName').addEventListener('input', function(){ EX.touched = true; });
['exLayout', 'exBlank'].forEach(function(id){ $(id).addEventListener('change', function(){ exRefresh(false); }); });
$('exPrefix').addEventListener('input', function(){ exRefresh(false); });
$('exCancel').addEventListener('click', closeExport);
$('exOk').addEventListener('click', async function(){
  var f = exFmt(), name = safeFileName($('exName').value, f.ext), data;
  if(f.blob){ data = f.blob; }
  else {
    var txt = f.text(EX.mode, exOpts());
    data = new Blob([(f.bom ? '﻿' : '') + txt], {type: f.mime || 'text/plain;charset=utf-8'});
  }
  exSavePrefs();
  var ok = await saveFile(name, data);
  if(ok){ closeExport(); toast('已匯出：' + name); }
});
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape'){ closeExport(); $('setModal').classList.remove('show'); }
});
/* txt export helper shared by text / image / screen / mail tabs */
function txtFormat(lines){
  return {
    ext: '.txt', label: '純文字 (.txt)', modes: ['trans', 'both', 'orig'], bom: true, mime: 'text/plain;charset=utf-8',
    text: function(mode, o){ return buildTxt(lines, mode, o, tgtSel.value); }
  };
}
