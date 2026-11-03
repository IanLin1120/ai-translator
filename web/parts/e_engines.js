/* ============================================================
   其他翻譯引擎：Gemini（免費金鑰）、OpenAI 相容（Groq／OpenRouter／Ollama…）、DeepL、
   Chrome 內建離線 AI、手機離線翻譯（ML Kit）。所有翻譯功能（文字／Excel／Word／PDF／郵件／圖片／螢幕）共用。
   ============================================================ */
(function(){
var APP = !!(window.AIT && typeof window.AIT.version === 'function');
var HAS_MT = APP && typeof window.AIT.mtTranslate === 'function';
var KEY = 'ait.eng2';
var DEF = {gemKey: '', gemModel: 'gemini-2.5-flash', oaiPreset: 'groq', oaiBase: 'https://api.groq.com/openai/v1', oaiKey: '', oaiModel: 'openai/gpt-oss-120b', oaiVision: false, deeplKey: ''};
var C = Object.assign({}, DEF);
var RETIRED = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b', 'meta-llama/llama-4-scout-17b-16e-instruct'];
try{ var j0 = JSON.parse(localStorage.getItem(KEY) || '{}'); Object.keys(DEF).forEach(function(k){ if(j0[k] !== undefined) C[k] = j0[k]; }); }catch(e){}
if(/groq\.com/i.test(C.oaiBase) && RETIRED.indexOf(C.oaiModel) >= 0) C.oaiModel = DEF.oaiModel;
function persist(){
  try{
    var o = Object.assign({}, C);
    if(!APP && !(window.CFG && CFG.remember)){ o.gemKey = ''; o.oaiKey = ''; o.deeplKey = ''; }
    localStorage.setItem(KEY, JSON.stringify(o));
  }catch(e){}
}
var LABEL = {
  gemini: 'Gemini（免費金鑰・品質高）',
  openai: 'OpenAI 相容（Groq／OpenRouter／Ollama）',
  deepl: 'DeepL（免費金鑰・僅 APK）',
  chrome: 'Chrome 內建離線 AI 翻譯',
  mlkit: '手機離線翻譯（免費・免網路・僅 APK）'
};
var IDS = ['gemini', 'openai', 'deepl', 'chrome', 'mlkit'];
function isLocal(u){ return /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u || ''); }
function avail(e){
  if(e === 'deepl') return APP;
  if(e === 'mlkit') return HAS_MT;
  if(e === 'chrome') return !APP && ('Translator' in self);
  return true;
}
function ready(e){
  if(e === 'gemini') return !!C.gemKey;
  if(e === 'openai') return !!(C.oaiBase && C.oaiModel && (C.oaiKey || isLocal(C.oaiBase)));
  if(e === 'deepl') return APP && !!C.deeplKey;
  if(e === 'chrome') return ('Translator' in self);
  if(e === 'mlkit') return HAS_MT;
  return false;
}
var eng = function(){ return engineSel.value; };
var isX = function(e){ return IDS.indexOf(e) >= 0; };

/* ---------- 引擎下拉選單 ---------- */
function addOptions(sel, ids, extra){
  ids.forEach(function(id){
    if(!avail(id) || Array.prototype.some.call(sel.options, function(o){ return o.value === id; })) return;
    var o = document.createElement('option'); o.value = id; o.textContent = LABEL[id]; sel.appendChild(o);
  });
  (extra || []).forEach(function(x){
    if(Array.prototype.some.call(sel.options, function(o){ return o.value === x[0]; })) return;
    var o = document.createElement('option'); o.value = x[0]; o.textContent = x[1]; sel.appendChild(o);
  });
}
addOptions(engineSel, IDS);
try{
  var se = localStorage.getItem('ait.engine'); try{ se = JSON.parse(se); }catch(e){}
  if(se && Array.prototype.some.call(engineSel.options, function(o){ return o.value === se && !o.hidden && o.value !== 'sub'; })) engineSel.value = se;
}catch(e){}
engineSel.addEventListener('change', function(){ try{ localStorage.setItem('ait.engine', JSON.stringify(engineSel.value)); }catch(e){} });

/* ---------- LLM 呼叫（回傳解析好的 JSON） ---------- */
/* ---------- Groq 用量：從回應標頭（若瀏覽器可讀）＋本機累計 ---------- */
var GQ = {h: null, at: 0, req: 0, tok: 0, day: '', retry: 0};
try{ var _g = JSON.parse(localStorage.getItem('ait.gq') || '{}'); if(_g.day === new Date().toISOString().slice(0, 10)) GQ = Object.assign(GQ, _g); }catch(e){}
function gqSave(){ try{ GQ.day = new Date().toISOString().slice(0, 10); localStorage.setItem('ait.gq', JSON.stringify({h: GQ.h, at: GQ.at, req: GQ.req, tok: GQ.tok, day: GQ.day})); }catch(e){} }
function isGroqUrl(u){ return /api\.groq\.com/i.test(u || ''); }
function gqHeaders(r){
  var g = function(k){ return r.headers.get(k); }, h = {};
  ['limit-requests', 'remaining-requests', 'reset-requests', 'limit-tokens', 'remaining-tokens', 'reset-tokens'].forEach(function(k){ var v = g('x-ratelimit-' + k); if(v != null) h[k] = v; });
  var ra = g('retry-after'); if(ra) h.retry = ra;
  return Object.keys(h).length ? h : null;
}
async function httpJson(url, opt){
  var r = await fetch(url, opt), t = await r.text();
  if(isGroqUrl(url)){
    var h = gqHeaders(r); if(h){ GQ.h = h; GQ.at = Date.now(); }
    GQ.req++;
    try{ var u = JSON.parse(t).usage; if(u && u.total_tokens) GQ.tok += u.total_tokens; }catch(e){}
    gqSave(); gqRender();
  }
  if(!r.ok){
    var e = new Error('HTTP ' + r.status + ' ' + t.slice(0, 240)); e.status = r.status;
    if(r.status === 429 && isGroqUrl(url)){
      var ra = r.headers.get('retry-after'); e.retryAfter = ra ? parseFloat(ra) : 0;
      e.message = 'Groq 已達流量上限（429）' + (e.retryAfter ? '，請等約 ' + Math.ceil(e.retryAfter) + ' 秒再試' : '，請稍後再試') + '。每日額度用完要等隔天重置。';
    }
    throw e;
  }
  return JSON.parse(t);
}
function gqRender(){
  var box = document.getElementById('x2quota'), chip = document.getElementById('gqChip');
  var h = GQ.h, lines = [];
  if(h && h['limit-requests']){
    var lr = +h['limit-requests'], rr = +h['remaining-requests'];
    lines.push('今日請求：剩 <b>' + rr + '</b> / ' + lr + ' 次（重置：' + (h['reset-requests'] || '—') + '）');
  }
  if(h && h['limit-tokens']){
    lines.push('每分鐘字數(tokens)：剩 <b>' + h['remaining-tokens'] + '</b> / ' + h['limit-tokens'] + '（重置：' + (h['reset-tokens'] || '—') + '）');
  }
  lines.push('本機累計（今天，此瀏覽器）：' + GQ.req + ' 次請求、約 ' + GQ.tok + ' tokens');
  if(!h) lines.push('<span style="opacity:.75">尚未取得伺服器回報的剩餘額度（按下方「更新剩餘額度」；若瀏覽器不開放讀取標頭，只會顯示本機累計。Groq 免費版 gpt-oss 約為 每分鐘 30 次／8K tokens、每天 1,000 次／20 萬 tokens）</span>');
  if(box) box.innerHTML = lines.join('<br>');
  if(chip){
    var show = engineSel.value === 'openai' && (C.oaiPreset === 'groq' || /groq/i.test(C.oaiBase || ''));
    chip.style.display = show ? '' : 'none';
    chip.textContent = 'Groq ' + (h && h['remaining-requests'] != null ? '剩 ' + h['remaining-requests'] + ' 次' : '今日 ' + GQ.req + ' 次');
  }
}
async function gqRefresh(){
  var base = (C.oaiBase || '').replace(/\/+$/, '');
  if(!isGroqUrl(base) || !C.oaiKey){ toast('請先在上方填 Groq 網址與金鑰', true); return; }
  try{
    await httpJson(base + '/chat/completions', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + C.oaiKey}, body: JSON.stringify({model: C.oaiModel, max_tokens: 1, messages: [{role: 'user', content: 'hi'}]})});
    if(!GQ.h) toast('已連線，但瀏覽器沒有開放讀取剩餘額度標頭，只顯示本機累計', true);
  }catch(e){ toast('更新失敗：' + (e.message || e), true); }
  gqRender();
}
async function geminiJson(prompt, imgs){
  if(!C.gemKey) throw new Error('尚未設定 Gemini API 金鑰');
  var parts = [];
  (imgs || []).forEach(function(x){ parts.push({inline_data: {mime_type: x.mime, data: x.b64}}); });
  parts.push({text: prompt});
  var j;
  try{
    j = await httpJson('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(C.gemModel) + ':generateContent?key=' + encodeURIComponent(C.gemKey), {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({contents: [{role: 'user', parts: parts}], generationConfig: {temperature: 0.2, responseMimeType: 'application/json'}})
    });
  }catch(e){
    if(e.status === 429) throw new Error('Gemini 免費額度或速率已達上限（狀態碼 429），稍後再試，或把模型改成 flash-lite');
    if(e.status === 400 && /API key/i.test(e.message)) throw new Error('Gemini 金鑰無效（狀態碼 400）');
    if(e.status === 403) throw new Error('Gemini 金鑰沒有權限或所在地區不支援（狀態碼 403）');
    throw e;
  }
  var c = j.candidates && j.candidates[0];
  if(!c || !c.content || !c.content.parts) throw new Error('Gemini 沒有回應內容（可能被安全過濾）');
  return parseJsonLoose(c.content.parts.map(function(p){ return p.text || ''; }).join(''));
}
async function openaiJson(prompt, imgs){
  var base = (C.oaiBase || '').replace(/\/+$/, '');
  if(!base) throw new Error('尚未設定 OpenAI 相容 API 網址');
  var content = prompt;
  if(imgs && imgs.length) content = [{type: 'text', text: prompt}].concat(imgs.map(function(x){ return {type: 'image_url', image_url: {url: 'data:' + x.mime + ';base64,' + x.b64}}; }));
  var h = {'content-type': 'application/json'}; if(C.oaiKey) h.authorization = 'Bearer ' + C.oaiKey;
  var j;
  try{ j = await httpJson(base + '/chat/completions', {method: 'POST', headers: h, body: JSON.stringify({model: C.oaiModel, temperature: 0.2, messages: [{role: 'user', content: content}]})}); }
  catch(e){
    if(e.status === 401) throw new Error('金鑰無效（狀態碼 401）');
    if(e.status === 429) throw new Error('已達用量或速率限制（狀態碼 429），稍後再試');
    if(e.status === 404) throw new Error('找不到模型或網址不對（狀態碼 404），請檢查「模型」與「網址」');
    throw e;
  }
  var m = j.choices && j.choices[0] && j.choices[0].message;
  if(!m) throw new Error('模型沒有回應內容');
  return parseJsonLoose(typeof m.content === 'string' ? m.content : (m.content || []).map(function(p){ return p.text || ''; }).join(''));
}

/* ---------- DeepL／離線：一次翻一批（回傳字串陣列） ---------- */
function deeplCode(c, target){
  if(!c || c === 'auto') return null;
  var l = c.toLowerCase();
  if(l === 'zh-tw' || l === 'zh-hant') return target ? 'ZH-HANT' : 'ZH';
  if(l.indexOf('zh') === 0) return target ? 'ZH-HANS' : 'ZH';
  var b = l.split('-')[0].toUpperCase();
  if(target && b === 'EN') return 'EN-US';
  if(target && b === 'PT') return 'PT-BR';
  return b;
}
async function deeplRun(texts, sl, tl){
  var host = /:fx$/.test(C.deeplKey) ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  var body = {text: texts, target_lang: deeplCode(tl, true)}; var s = deeplCode(sl, false); if(s) body.source_lang = s;
  var j;
  try{ j = await httpJson(host + '/v2/translate', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'DeepL-Auth-Key ' + C.deeplKey}, body: JSON.stringify(body)}); }
  catch(e){
    if(e.status === 403) throw new Error('DeepL 金鑰無效（狀態碼 403）');
    if(e.status === 456) throw new Error('DeepL 本月免費額度已用完（狀態碼 456）');
    throw e;
  }
  return j.translations.map(function(t){ return t.text; });
}
var mtWait = {};
function mtRun(texts, sl, tl){
  return new Promise(function(res, rej){
    var id = 'm' + Date.now() + Math.random().toString(36).slice(2, 6);
    mtWait[id] = {res: res, rej: rej};
    window.AIT.mtTranslate(id, JSON.stringify({src: sl, tgt: tl, texts: texts}));
    setTimeout(function(){ if(mtWait[id]){ delete mtWait[id]; rej(new Error('離線翻譯逾時（第一次使用要下載語言包，請確認網路後重試）')); } }, 20 * 60e3);
  });
}
function onMt(d){
  d = typeof d === 'string' ? JSON.parse(d) : d;
  var w = mtWait[d.id]; if(!w) return; delete mtWait[d.id];
  if(d.ok) w.res(d.out || []); else w.rej(new Error(d.err || '離線翻譯失敗'));
}
var chromeCache = {};
function chromeLang(c){ if(!c) return c; var l = c.toLowerCase(); if(l === 'zh-tw' || l === 'zh-hant') return 'zh-Hant'; if(l.indexOf('zh') === 0) return 'zh'; return l.split('-')[0]; }
async function chromeRun(texts, sl, tl){
  var s = sl;
  if(!s || s === 'auto'){
    if(!('LanguageDetector' in self)) throw new Error('Chrome 的離線翻譯需要手動選擇原文語言（這個瀏覽器沒有語言偵測）');
    var det = await LanguageDetector.create(), r = await det.detect(texts.join(' ').slice(0, 600));
    s = r && r[0] && r[0].detectedLanguage; if(!s || s === 'und') throw new Error('無法判斷原文語言，請手動選擇');
  }
  var o = {sourceLanguage: chromeLang(s), targetLanguage: chromeLang(tl)};
  if(o.sourceLanguage === o.targetLanguage) return texts.slice();
  var k = o.sourceLanguage + '>' + o.targetLanguage, t = chromeCache[k];
  if(!t){
    var av = await Translator.availability(o);
    if(av === 'unavailable') throw new Error('Chrome 內建翻譯不支援這個語言組合（' + o.sourceLanguage + ' → ' + o.targetLanguage + '）');
    if(av !== 'available') toast('正在下載 Chrome 離線翻譯語言包，第一次需要一點時間…');
    t = await Translator.create(Object.assign({monitor: function(m){ m.addEventListener('downloadprogress', function(e){ if(e.total) toast('下載語言包 ' + Math.round(e.loaded / e.total * 100) + '%'); }); }}, o));
    chromeCache[k] = t;
  }
  var out = [];
  for(var i = 0; i < texts.length; i++) out.push(await t.translate(texts[i]));
  return out;
}
async function plainBatch(e, texts, opts){
  opts = opts || {};
  var sl = opts.sourceLang || 'auto', tl = opts.targetLang;
  var out = texts.slice(), need = [], map = new Map(), total = 0;
  texts.forEach(function(t, i){
    if(!needsTranslate(t)) return;
    total++;
    if(!map.has(t)){ map.set(t, []); need.push(t); }
    map.get(t).push(i);
  });
  var failed = 0, lastErr = null, done = 0, CH = e === 'chrome' ? 10 : 40;
  for(var p = 0; p < need.length; p += CH){
    var chunk = need.slice(p, p + CH), res = null;
    try{ res = e === 'deepl' ? await deeplRun(chunk, sl, tl) : e === 'mlkit' ? await mtRun(chunk, sl, tl) : await chromeRun(chunk, sl, tl); }
    catch(err){ lastErr = err; }
    chunk.forEach(function(t, k){
      var r = res && res[k], ids = map.get(t);
      if(typeof r === 'string' && r.length) ids.forEach(function(i){ out[i] = r; }); else failed += ids.length;
      done += ids.length;
    });
    if(opts.onProgress) opts.onProgress(Math.min(done, texts.length), texts.length);
  }
  aiTranslateBatch.lastFailed = failed; aiTranslateBatch.lastNeeded = total; aiTranslateBatch.lastError = lastErr;
  return out;
}

/* ---------- 掛進共用翻譯流程 ---------- */
var _aiAvailable = aiAvailable, _aiImagesAvailable = aiImagesAvailable, _callAIJson = callAIJson, _translateBatch = translateBatch,
    _updateEnginePill = updateEnginePill, _engineNotReady = engineNotReady;
aiAvailable = function(){ var e = eng(); return isX(e) ? ready(e) : _aiAvailable(); };
aiImagesAvailable = function(){
  var e = eng();
  if(e === 'gemini') return !!C.gemKey;
  if(e === 'openai') return ready('openai') && !!C.oaiVision;
  if(e === 'deepl' || e === 'chrome' || e === 'mlkit') return false;
  return _aiImagesAvailable();
};
callAIJson = async function(prompt, imgs){
  var e = eng();
  if(e === 'gemini') return geminiJson(prompt, imgs);
  if(e === 'openai') return openaiJson(prompt, imgs);
  return _callAIJson(prompt, imgs);
};
translateBatch = async function(texts, opts){
  var e = eng();
  if(e === 'deepl' || e === 'chrome' || e === 'mlkit'){
    var r = await plainBatch(e, texts, opts);
    if(aiTranslateBatch.lastNeeded && aiTranslateBatch.lastFailed >= aiTranslateBatch.lastNeeded && aiTranslateBatch.lastError) throw aiTranslateBatch.lastError;
    if(aiTranslateBatch.lastFailed) toast('有 ' + aiTranslateBatch.lastFailed + ' 句翻譯失敗，已保留原文，可再按一次重試。', true);
    return r;
  }
  return _translateBatch(texts, opts);
};
engineNotReady = function(){
  var e = eng();
  if(!isX(e)) return _engineNotReady();
  openSettings();
  toast(e === 'gemini' ? '請先在「設定」填入 Gemini 金鑰（免費申請）。' : e === 'openai' ? '請先在「設定」填好 OpenAI 相容 API 的網址、模型與金鑰。' : e === 'deepl' ? '請先在「設定」填入 DeepL 金鑰。' : '這個引擎目前不可用。', true);
};
updateEnginePill = function(){
  _updateEnginePill();
  var e = eng(); if(!isX(e)) return;
  var ok = ready(e), name = LABEL[e].replace(/（.*$/, '');
  var txt = ok ? name + ' 已就緒' : (e === 'chrome' ? '此瀏覽器不支援' : '尚未設定金鑰');
  if(e === 'gemini' && ok) txt = 'Gemini 已就緒（' + C.gemModel.replace('gemini-', '') + '）';
  if(e === 'openai' && ok) txt = 'OpenAI 相容 已就緒（' + C.oaiModel.split('/').pop() + '）';
  enginePill.textContent = txt; enginePill.className = 'status-pill ' + (ok ? 'ok' : 'bad');
};
engineSel.addEventListener('change', function(){ updateEnginePill(); });

/* ---------- 設定畫面 ---------- */
var PRESETS = {
  groq: {base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b'},
  openrouter: {base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free'},
  ollama: {base: 'http://localhost:11434/v1', model: 'qwen2.5:7b'}
};
function el(html){ var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
function link(u, t){ return '<a class="ext" href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>'; }
var UI = el(
 '<div class="x2box" id="x2box">' +
 '<h3 class="x2h">🧠 更多翻譯引擎（全部翻譯功能都能選）</h3>' +
 '<p class="help">到「翻譯引擎」下拉選單選用。金鑰只存在這台裝置，只會直接送到各家服務。</p>' +
 '<div class="field"><label class="lbl">Gemini API 金鑰（Google AI Studio，免費）</label>' +
 '<input type="password" id="x2gemKey" placeholder="AIza..." autocomplete="off">' +
 '<select id="x2gemModel"><option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite（最快、免費額度最多）</option><option value="gemini-2.5-flash">gemini-2.5-flash（建議，品質與速度平衡）</option><option value="gemini-2.5-pro">gemini-2.5-pro（最準、免費額度很少）</option></select>' +
 '<div class="help">免費申請：' + link('https://aistudio.google.com/apikey', 'aistudio.google.com/apikey') + '（Google 帳號登入 → Create API key，免綁信用卡）。免費層有每分鐘／每天次數上限。可翻譯文字，也能看圖片；即時字幕還能直接聽音檔。</div>' +
 '<div class="btn-row"><button class="secondary" id="x2testGem">測試 Gemini</button></div></div>' +

 '<div class="field"><label class="lbl">OpenAI 相容 API（Groq、OpenRouter 免費模型、Ollama 本機、其他）</label>' +
 '<select id="x2oaiPreset"><option value="groq">Groq（免費額度、速度很快）</option><option value="openrouter">OpenRouter（有多個免費模型）</option><option value="ollama">Ollama（自己電腦／伺服器跑的模型）</option><option value="custom">自訂</option></select>' +
 '<input type="text" id="x2oaiBase" placeholder="API 網址，例如 https://api.groq.com/openai/v1" autocomplete="off">' +
 '<input type="password" id="x2oaiKey" placeholder="API 金鑰（Ollama 可留空）" autocomplete="off">' +
 '<input type="text" id="x2oaiModel" placeholder="模型名稱" autocomplete="off" list="x2models"><datalist id="x2models"></datalist>' +
 '<label class="chk-line"><input type="checkbox" id="x2oaiVision"> 這個模型支援看圖（圖片／螢幕翻譯用）</label>' +
 '<div class="help">免費金鑰：' + link('https://console.groq.com/keys', 'Groq') + '、' + link('https://openrouter.ai/keys', 'OpenRouter') + '（模型名稱結尾是 :free 的免費）。Ollama 請填電腦的網址（例如 http://192.168.1.10:11434/v1），電腦要允許區域網路連線。</div>' +
 '<div class="btn-row"><button class="secondary" id="x2listOai">取得可用模型清單</button><button class="secondary" id="x2testOai">測試這個 API</button></div><div class="help" id="x2listOut"></div>'+
 '<div class="note" id="x2quotaWrap"><b>📊 Groq 用量</b><div id="x2quota" style="margin-top:4px;line-height:1.7"></div><div class="btn-row" style="margin-top:6px"><button class="secondary" id="x2quotaBtn">更新剩餘額度</button></div></div></div>' +

 '<div class="field" id="x2deeplRow"><label class="lbl">DeepL API 金鑰（免費版每月 50 萬字，僅 APK 版可用）</label>' +
 '<input type="password" id="x2deeplKey" placeholder="xxxxxxxx-xxxx-...:fx" autocomplete="off">' +
 '<div class="help">免費申請：' + link('https://www.deepl.com/pro-api', 'deepl.com/pro-api') + '（選 DeepL API Free，需要註冊並驗證；金鑰結尾是 :fx）。網頁版受瀏覽器限制無法直接呼叫 DeepL。</div></div>' +

 '<div class="field" id="x2offRow"><label class="lbl">離線翻譯</label>' +
 '<div class="help" id="x2offHelp"></div>' +
 '<div class="btn-row" id="x2preRow"><button class="secondary" id="x2prefetch">預先下載目前「原文→目標」語言包</button></div></div>' +
 '</div>');
function $x(id){ return UI.querySelector('#' + id); }
function mount(){
  var host = document.getElementById('cardClaude');
  if(host){ var card = document.createElement('div'); card.className = 'card glass'; card.appendChild(UI); host.parentNode.insertBefore(card, host.nextSibling); return; }
  var box = document.querySelector('#setModal .modal-box'), row = box && box.querySelector('.btn-row:last-of-type');
  if(box && row) box.insertBefore(UI, row);
}
mount();
UI.querySelectorAll('select,input[type=text],input[type=password]').forEach(function(x){ x.style.marginTop = '6px'; });
function fill(){
  $x('x2gemKey').value = C.gemKey; $x('x2gemModel').value = C.gemModel; $x('x2oaiPreset').value = C.oaiPreset; $x('x2oaiBase').value = C.oaiBase;
  $x('x2oaiKey').value = C.oaiKey; $x('x2oaiModel').value = C.oaiModel; $x('x2oaiVision').checked = !!C.oaiVision; $x('x2deeplKey').value = C.deeplKey;
  $x('x2deeplRow').style.display = APP ? '' : 'none';
  $x('x2preRow').style.display = HAS_MT ? '' : 'none';
  $x('x2offHelp').innerHTML = APP ? '「手機離線翻譯」用 Google ML Kit：免費、不用網路、不用金鑰，每個語言第一次使用時下載約 30 MB 語言包（非英文語言之間會經由英文轉譯，要多下載英文包）。品質比 AI 翻譯樸素，但速度快、隱私好。原文語言請手動選擇可省去偵測。'
    : ('Chrome 內建離線 AI 翻譯：Chrome 138 以上的桌面版支援，語言包下載一次後完全離線、免費。' + ('Translator' in self ? '這個瀏覽器可以使用。' : '這個瀏覽器目前不支援。'));
}
fill();
function save(){
  C.gemKey = $x('x2gemKey').value.trim(); C.gemModel = $x('x2gemModel').value; C.oaiPreset = $x('x2oaiPreset').value; C.oaiBase = $x('x2oaiBase').value.trim();
  C.oaiKey = $x('x2oaiKey').value.trim(); C.oaiModel = $x('x2oaiModel').value.trim(); C.oaiVision = $x('x2oaiVision').checked; C.deeplKey = $x('x2deeplKey').value.trim();
  persist(); updateEnginePill();
}
UI.addEventListener('input', save); UI.addEventListener('change', save);
$x('x2oaiPreset').addEventListener('change', function(){
  var p = PRESETS[this.value]; if(p){ $x('x2oaiBase').value = p.base; $x('x2oaiModel').value = p.model; save(); }
});
UI.addEventListener('click', function(ev){
  var a = ev.target.closest && ev.target.closest('a.ext'); if(!a) return;
  if(APP && window.AIT.openUrl){ ev.preventDefault(); window.AIT.openUrl(a.href); }
});
var btnSave = document.getElementById('btnSetSave'); if(btnSave) btnSave.addEventListener('click', persist);
async function testEngine(kind){
  var prev = engineSel.value; save();
  try{
    toast('測試中…');
    var r = await (kind === 'gem' ? geminiJson : openaiJson)('Translate "Good morning" into Traditional Chinese. Reply only with a JSON array containing one string.', []);
    toast('✓ 連線成功：' + (Array.isArray(r) ? r[0] : JSON.stringify(r)).toString().slice(0, 40));
  }catch(e){ toast('測試失敗：' + (e.message || e), true); }
  engineSel.value = prev;
}
$x('x2testGem').addEventListener('click', function(){ testEngine('gem'); });
$x('x2testOai').addEventListener('click', function(){ testEngine('oai'); });
$x('x2quotaBtn').addEventListener('click', gqRefresh);
(function(){
  var chip = document.createElement('span'); chip.id = 'gqChip'; chip.className = 'status-pill ok'; chip.style.cssText = 'display:none;margin-left:6px;cursor:pointer';
  chip.title = '點一下查看／更新 Groq 剩餘額度'; var pill = document.getElementById('engineStatus');
  if(pill && pill.parentNode) pill.parentNode.insertBefore(chip, pill.nextSibling);
  chip.addEventListener('click', function(){ if(typeof openSettings === 'function') openSettings(); var b = document.getElementById('x2quotaWrap'); if(b) setTimeout(function(){ b.scrollIntoView({block: 'center'}); }, 150); });
  engineSel.addEventListener('change', gqRender); gqRender();
})();
$x('x2listOai').addEventListener('click', async function(){
  var out = $x('x2listOut'); save();
  var base = (C.oaiBase || '').replace(/\/+$/, '');
  if(!base){ out.textContent = '請先填 API 網址'; return; }
  out.textContent = '查詢中…';
  try{
    var h = C.oaiKey ? {authorization: 'Bearer ' + C.oaiKey} : {};
    var j = await httpJson(base + '/models', {headers: h});
    var ids = (j.data || []).map(function(m){ return m.id; }).filter(function(id){ return !/whisper|tts|orpheus|guard|embed|moderation/i.test(id); }).sort();
    $x('x2models').innerHTML = ids.map(function(id){ return '<option value="' + id + '">'; }).join('');
    out.textContent = '共 ' + ids.length + ' 個可用：' + ids.slice(0, 40).join('、') + '。點上面「模型名稱」欄位可從清單選。';
  }catch(e){ out.textContent = '查詢失敗：' + (e.message || e) + '（金鑰或網址可能不對）'; }
});
$x('x2prefetch').addEventListener('click', async function(){
  try{
    var s = srcSel.value, t = tgtSel.value;
    if(s === 'auto'){ toast('請先在「原文語言」選一個語言（離線翻譯下載語言包時無法自動偵測）', true); return; }
    toast('下載語言包中…完成會提示');
    await new Promise(function(res, rej){
      var id = 'p' + Date.now(); mtWait[id] = {res: res, rej: rej};
      window.AIT.mtTranslate(id, JSON.stringify({prefetch: true, src: s, tgt: t}));
    });
    toast('✓ 離線語言包已下載，之後不需要網路');
  }catch(e){ toast('下載失敗：' + (e.message || e), true); }
});
window.ENX = {
  cfg: function(){ return C; }, ids: IDS, labels: LABEL, avail: avail, ready: ready, addOptions: addOptions, onMt: onMt, fill: fill,
  nativeCfg: function(){ return {gemKey: C.gemKey, gemModel: C.gemModel, oaiBase: C.oaiBase, oaiKey: C.oaiKey, oaiModel: C.oaiModel, deeplKey: C.deeplKey}; },
  missingKey: function(e){
    if(e === 'gemini' && !C.gemKey) return '請先到「設定」填入 Gemini 金鑰（免費申請）';
    if(e === 'openai' && !ready('openai')) return '請先到「設定」填好 OpenAI 相容 API 的網址、模型與金鑰';
    if(e === 'deepl' && !C.deeplKey) return '請先到「設定」填入 DeepL 金鑰';
    return '';
  }
};
updateEnginePill();
})();
