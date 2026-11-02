/* ============================================================
   0. THEME
   ============================================================ */
(function(){
  var root = document.documentElement;
  var saved = null;
  try{ saved = localStorage.getItem('ai-translator-theme'); }catch(e){}
  if(saved) root.setAttribute('data-theme', saved);
  document.getElementById('themeToggle').addEventListener('click', function(){
    var cur = root.getAttribute('data-theme');
    var isDark;
    if(cur){ isDark = cur === 'dark'; }
    else { isDark = window.matchMedia('(prefers-color-scheme: dark)').matches; }
    var next = isDark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try{ localStorage.setItem('ai-translator-theme', next); }catch(e){}
  });
})();

/* ============================================================
   1. LANGUAGES
   ============================================================ */
var LANGS = [
  {code:'auto', name:'自動偵測'},
  {code:'zh-TW', name:'繁體中文'},
  {code:'zh-CN', name:'簡體中文'},
  {code:'en', name:'English 英文'},
  {code:'ja', name:'日本語 日文'},
  {code:'ko', name:'한국어 韓文'},
  {code:'vi', name:'Tiếng Việt 越南文'},
  {code:'th', name:'ภาษาไทย 泰文'},
  {code:'id', name:'Bahasa Indonesia 印尼文'},
  {code:'fr', name:'Français 法文'},
  {code:'de', name:'Deutsch 德文'},
  {code:'es', name:'Español 西班牙文'},
  {code:'pt', name:'Português 葡萄牙文'},
  {code:'it', name:'Italiano 義大利文'},
  {code:'ru', name:'Русский 俄文'},
  {code:'ar', name:'العربية 阿拉伯文'}
];
function fillLangSelect(sel, includeAuto){
  sel.innerHTML = '';
  LANGS.forEach(function(l){
    if(l.code==='auto' && !includeAuto) return;
    var o = document.createElement('option');
    o.value = l.code; o.textContent = l.name;
    sel.appendChild(o);
  });
}
var srcSel = document.getElementById('srcLang');
var tgtSel = document.getElementById('tgtLang');
fillLangSelect(srcSel, true);
fillLangSelect(tgtSel, false);
srcSel.value = 'auto';
tgtSel.value = 'zh-TW';
document.getElementById('swapLang').addEventListener('click', function(){
  if(srcSel.value === 'auto') return;
  var a = srcSel.value, b = tgtSel.value;
  srcSel.value = b; tgtSel.value = a;
});
function langName(code){
  var f = LANGS.find(function(l){return l.code===code;});
  return f ? f.name.replace(/\s.*$/,'') : code;
}

