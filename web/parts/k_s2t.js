/* ============================================================
   簡體→繁體（台灣用語）保險：目標語言是繁體中文時，所有引擎的翻譯結果都再過一次 OpenCC，
   避免模型偶爾輸出簡體字。原文不動，只轉換「有被翻譯」的結果。
   ============================================================ */
(function(){
var OC = window.OpenCC;
if(!OC) return;
var toTW = OC.Converter({from: 'cn', to: 'twp'});
var toCN = OC.Converter({from: 'twp', to: 'cn'});
var isTrad = function(c){ return /^zh-(TW|Hant)/i.test(c || ''); };
function conv(s){ try{ return toTW(s); }catch(e){ return s; } }
function deep(v){
  if(typeof v === 'string') return conv(v);
  if(Array.isArray(v)) return v.map(deep);
  if(v && typeof v === 'object'){ var o = {}; Object.keys(v).forEach(function(k){ o[k] = deep(v[k]); }); return o; }
  return v;
}
var _tb = translateBatch, _cj = callAIJson;
translateBatch = async function(texts, opts){
  var out = await _tb(texts, opts);
  var tl = (opts && opts.targetLang) || tgtSel.value;
  if(!isTrad(tl) || !Array.isArray(out)) return out;
  return out.map(function(s, i){ return (typeof s === 'string' && s !== texts[i]) ? conv(s) : s; });
};
callAIJson = async function(prompt, imgs){
  var r = await _cj(prompt, imgs);
  return isTrad(tgtSel.value) ? deep(r) : r;
};
window.S2T = {toTW: conv, toCN: function(s){ try{ return toCN(s); }catch(e){ return s; } }, isTrad: isTrad};
})();
