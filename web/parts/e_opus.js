/* ============================================================
   Opus-MT 離線開源翻譯（免金鑰）：transformers.js ＋ Helsinki-NLP Opus-MT（ONNX 量化版）
   - 函式庫：jsDelivr（只需下載一次，瀏覽器會快取）
   - 模型：託管在本專案 GitHub 的 models 分支（raw.githubusercontent.com），第一次使用才下載，之後快取
   - 中文：模型輸出簡體 → OpenCC 轉成台灣繁體；輸入的繁體先轉簡體再餵給模型
   - 沒有直接語言對時，以英文當中繼（例：日→英→中）
   ============================================================ */
(function(){
var REPO = 'IanLin1120/ai-translator', BRANCH = 'models';
var BASE = 'https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/';
var TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0/dist/transformers.min.js';
var tjs = null, manifest = null, pipes = {}, pipeP = {};
var ST = {text: '', pct: -1};
function status(t, pct){ ST.text = t; ST.pct = pct == null ? -1 : pct; var el = document.getElementById('x2opusSt'); if(el) el.textContent = t; }
function baseLang(c){
  if(!c || c === 'auto') return 'auto';
  var l = c.toLowerCase(); if(l.indexOf('zh') === 0) return 'zh';
  return l.split('-')[0];
}
function detect(t){
  if(/[぀-ヿ]/.test(t)) return 'ja';
  if(/[가-힯]/.test(t)) return 'ko';
  if(/[一-鿿]/.test(t)) return 'zh';
  if(/[Ѐ-ӿ]/.test(t)) return 'ru';
  if(/[฀-๿]/.test(t)) return 'th';
  if(/[à-ÿ]/.test(t) && /\b(el|la|los|las|de|que|y|por|con|una?)\b/i.test(t)) return 'es';
  if(/[à-ÿ]/.test(t) && /\b(le|les|des|est|une?|et|pour|avec)\b/i.test(t)) return 'fr';
  if(/\b(der|die|das|und|nicht|ist|mit|ein|eine)\b/i.test(t)) return 'de';
  return 'en';
}
async function loadManifest(){
  if(manifest) return manifest;
  var r = await fetch(BASE + 'manifest.json', {cache: 'no-cache'});
  if(!r.ok) throw new Error('找不到 GitHub 上的離線模型清單（models 分支尚未建立或網路不通，HTTP ' + r.status + '）');
  manifest = await r.json(); return manifest;
}
async function loadLib(){
  if(tjs) return tjs;
  status('載入 AI 函式庫…（只需第一次，約 1MB）');
  try{ tjs = await import(TJS); }
  catch(e){ throw new Error('無法載入 AI 函式庫（需要網路，第一次使用時下載）：' + (e && e.message || e)); }
  var env = tjs.env;
  env.allowLocalModels = false; env.allowRemoteModels = true;
  env.remoteHost = BASE; env.remotePathTemplate = '{model}/';
  try{ env.backends.onnx.wasm.proxy = false; }catch(e){}
  return tjs;
}
async function getPipe(key){
  if(pipes[key]) return pipes[key];
  if(pipeP[key]) return pipeP[key];
  pipeP[key] = (async function(){
    var m = await loadManifest(), info = m.pairs && m.pairs[key];
    if(!info) throw new Error('離線模型沒有提供「' + key + '」這組語言');
    var lib = await loadLib(), files = {};
    status('下載模型 ' + key + '…（第一次約 70–100MB，之後不用再下載）', 0);
    var p = await lib.pipeline('translation', info.id || info, {dtype: 'q8', device: 'wasm', progress_callback: function(x){
      if(x && x.status === 'progress' && x.file){
        files[x.file] = x; var tot = 0, got = 0;
        Object.keys(files).forEach(function(k){ tot += files[k].total || 0; got += files[k].loaded || 0; });
        if(tot) status('下載模型 ' + key + '… ' + Math.round(got / tot * 100) + '%（' + Math.round(got / 1048576) + ' / ' + Math.round(tot / 1048576) + ' MB）', got / tot * 100);
      }
    }});
    status('模型 ' + key + ' 已就緒（已快取，之後離線可用）', 100);
    pipes[key] = {p: p, prefix: (info && info.prefix) || ''}; return pipes[key];
  })();
  try{ return await pipeP[key]; }finally{ delete pipeP[key]; }
}
/* 長文切句：模型一次吃不下太長的句子 */
function splitText(t){
  var out = [];
  t.split(/\n/).forEach(function(line, li){
    if(li) out.push({nl: true});
    if(!line.trim()){ out.push({raw: line}); return; }
    var parts = line.match(/[^。！？!?；;.…]+[。！？!?；;.…]*\s*/g) || [line];
    var cur = '';
    parts.forEach(function(s){
      if((cur + s).length > 280 && cur){ out.push({t: cur}); cur = s; } else cur += s;
    });
    if(cur) out.push({t: cur});
  });
  return out;
}
async function runPair(texts, a, b){
  var info = await getPipe(a + '-' + b), pre = info.prefix;
  var uniq = [], idx = new Map(), segs = texts.map(function(t){
    var sp = splitText(a === 'zh' && window.S2T ? S2T.toCN(t) : t);
    sp.forEach(function(x){ if(x.t != null && !idx.has(x.t)){ idx.set(x.t, uniq.length); uniq.push(x.t); } });
    return sp;
  });
  var res = [];
  for(var i = 0; i < uniq.length; i += 8){
    var batch = uniq.slice(i, i + 8).map(function(s){ return pre + s; });
    var o = await info.p(batch, {max_new_tokens: 400});
    (Array.isArray(o) ? o : [o]).forEach(function(x){ res.push((x && x.translation_text) || ''); });
  }
  var cjk = b === 'zh' || b === 'jap' || b === 'ja';
  return segs.map(function(sp){
    return sp.map(function(x){
      if(x.nl) return '\n'; if(x.raw != null) return x.raw;
      var r = res[idx.get(x.t)] || x.t;
      return cjk ? r : r + ' ';
    }).join('').replace(/[ \t]+\n/g, '\n').replace(/[ \t]+$/, '');
  });
}
var OUTCODE = {ja: 'jap'};
async function run(texts, sl, tl){
  var m = await loadManifest(), pairs = m.pairs || {};
  var tgt = baseLang(tl), src0 = baseLang(sl), out = new Array(texts.length);
  var groups = {};
  texts.forEach(function(t, i){ var s = src0 === 'auto' ? detect(t) : src0; (groups[s] = groups[s] || []).push(i); });
  for(var s in groups){
    var ids = groups[s], arr = ids.map(function(i){ return texts[i]; }), res;
    if(s === tgt){ res = arr; }
    else{
      var tcode = OUTCODE[tgt] || tgt;
      if(pairs[s + '-' + tcode]) res = await runPair(arr, s, tcode);
      else if(pairs[s + '-en'] && pairs['en-' + tcode]){
        var mid = s === 'en' ? arr : await runPair(arr, s, 'en');
        res = await runPair(mid, 'en', tcode);
      }
      else if(s === 'en' && pairs['en-' + tcode]) res = await runPair(arr, 'en', tcode);
      else throw new Error('離線模型尚未支援「' + s + ' → ' + tgt + '」。目前可用語言對：' + Object.keys(pairs).join('、'));
    }
    ids.forEach(function(i, k){ out[i] = res[k]; });
  }
  return out;
}
window.OPUS = {
  run: run, status: function(){ return ST; },
  pairs: async function(){ return (await loadManifest()).pairs || {}; },
  prefetch: async function(sl, tl){
    var m = await loadManifest(), pairs = m.pairs || {}, a = baseLang(sl) === 'auto' ? 'en' : baseLang(sl), b = OUTCODE[baseLang(tl)] || baseLang(tl);
    var need = pairs[a + '-' + b] ? [a + '-' + b] : (pairs[a + '-en'] && pairs['en-' + b] ? [a + '-en', 'en-' + b] : []);
    if(!need.length) throw new Error('沒有「' + a + ' → ' + b + '」的離線模型');
    for(var i = 0; i < need.length; i++) await getPipe(need[i]);
    return need;
  }
};
})();
