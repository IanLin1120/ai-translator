
/* ============================================================
   4. SHARED RESULT HELPERS
   ============================================================ */
/* short language label for file names, e.g. 客戶文件-中文 */
function langFile(code){
  if(code === 'zh-TW') return '中文';
  if(code === 'zh-CN') return '簡體中文';
  var f = LANGS.find(function(l){ return l.code === code; });
  if(!f) return code;
  var parts = f.name.split(/\s+/);
  return parts[1] || parts[0];
}
function renderPairs(box, lines, showOrig){
  box.style.display = 'block';
  box.textContent = '';
  if(!lines || !lines.length){
    var d = document.createElement('div'); d.className = 'note'; d.textContent = '未偵測到文字。'; box.appendChild(d);
    return;
  }
  lines.forEach(function(L){
    (L.pairs || []).forEach(function(p){
      var row = document.createElement('div'); row.className = 'row' + (showOrig === false ? ' one' : '');
      if(showOrig !== false){
        var o = document.createElement('div'); o.className = 'orig'; o.textContent = p.o; row.appendChild(o);
      }
      var t = document.createElement('div'); t.className = 'trans'; t.textContent = p.t; row.appendChild(t);
      box.appendChild(row);
    });
  });
}
function imagesNotAvailable(){
  if(IN_CLAUDE) toast('此環境未開放圖片辨識。請改用下載的獨立版（需設定 Anthropic API 金鑰）。', true);
  else { openSettings(); toast('圖片辨識需要 Anthropic API 金鑰，請先到「設定」填入。', true); }
}

/* ============================================================
   4a. TEXT TAB  (sentence-level translation)
   ============================================================ */
var textState = {segs: null};
$('btnTransText').addEventListener('click', async function(){
  if(!textEngineReady()){ engineNotReady(); return; }
  var input = $('textIn').value;
  if(!input.trim()){ toast('請先輸入要翻譯的文字', true); return; }
  var segs = segmentText(input), flat = [];
  segs.forEach(function(s){ s.sents.forEach(function(x){ flat.push(x); }); });
  var btn = this; btn.disabled = true;
  try{
    var out = await translateBatch(flat, {
      sourceLang: srcSel.value, targetLang: tgtSel.value,
      onProgress: function(d, t){ progress('Text', d, t); }
    });
    var k = 0;
    segs.forEach(function(s){ s.pairs = s.sents.map(function(x){ return {o: x, t: out[k++]}; }); });
    textState.segs = segs;
    $('textOut').value = buildTxt(segs, 'trans', {}, tgtSel.value);
    progressDone('Text', '翻譯完成');
  }catch(e){
    toast('翻譯失敗：' + errMsg(e), true);
    progressDone('Text', '發生錯誤');
  }
  btn.disabled = false;
});
async function copyText(v){
  try{ await navigator.clipboard.writeText(v); return true; }catch(e){}
  try{
    var ta = document.createElement('textarea'); ta.value = v; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); return ok;
  }catch(e){ return false; }
}
$('btnCopyText').addEventListener('click', async function(){
  var v = $('textOut').value;
  if(!v.trim()){ toast('尚無翻譯結果', true); return; }
  toast(await copyText(v) ? '已複製翻譯結果' : '複製失敗，請手動選取文字', false);
});
$('btnCopyBoth').addEventListener('click', async function(){
  if(!textState.segs){ toast('尚無翻譯結果', true); return; }
  var p = exPrefs();
  var v = buildTxt(textState.segs, 'both', {layout: p.layout || 'stack', blank: p.blank !== false, prefix: p.prefix || ''}, tgtSel.value);
  toast(await copyText(v) ? '已複製雙語對照' : '複製失敗，請改用「匯出」', false);
});
$('btnDlText').addEventListener('click', function(){
  if(!textState.segs){ toast('尚無翻譯結果，請先按「開始翻譯」', true); return; }
  openExport({title: '匯出文字翻譯', names: nameSet('翻譯文字'), formats: [txtFormat(textState.segs)]});
});

