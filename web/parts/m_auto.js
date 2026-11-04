/* ============================================================
   自動辨識「能不能在背景用 Claude 月訂閱」並自動選引擎：
   · APK：背景網頁版翻譯器（cengReq）→ 自動選「Claude 訂閱」，所有翻譯（文字／Excel／Word／PDF／郵件／圖片）都在背景跑
   · Claude.ai 裡的線上版：直接用 sample → 自動選「AI 翻譯（Claude）」
   · 離線 HTML／GitHub 網頁版：瀏覽器限制，無法背景使用月訂閱 → 維持原本引擎（可選「複製貼上橋接」）
   使用者手動換引擎後會自動關閉「自動選擇」，避免每次被改回去。
   ============================================================ */
(function(){
var mode = isApp ? (subSupported() ? 'apk' : 'apk-old') : (IN_CLAUDE ? 'claude' : 'web');
var on = lsGet('ait.autoEng', true);
function setEngine(v){
  if(!Array.prototype.some.call(engineSel.options, function(o){ return o.value === v && !o.hidden; })) return false;
  if(engineSel.value !== v){ engineSel.value = v; engineSel.dispatchEvent(new Event('change')); }
  return true;
}
var NAMES = {apk: 'APK（背景網頁版翻譯器）', claude: 'Claude.ai 線上版（直接使用訂閱）', web: '離線 HTML／GitHub 網頁版', 'apk-old': 'APK（舊版原生）'};
function describe(){
  var bg = mode === 'apk' || mode === 'claude';
  var t = '目前環境：<b>' + NAMES[mode] + '</b>　背景使用月訂閱：<b style="color:' + (bg ? 'var(--success,#3E5C1F)' : 'var(--danger,#8C2A20)') + '">' + (bg ? '可以' : '不行') + '</b>';
  if(mode === 'web') t += '<br>瀏覽器安全限制：一般網頁無法在背景連到 Claude 月訂閱。想背景自動翻譯請改用 APK 或 Claude.ai 線上版；在這裡可用「Gemini／Groq 免費金鑰」或「Opus-MT 離線」在背景翻譯，月訂閱只能用「複製貼上橋接」。';
  if(mode === 'apk') t += '<br>文字、圖片、Excel、Word、PDF、郵件都會在背景自動翻譯。第一次需登入 claude.ai 並授權一次。';
  if(mode === 'claude') t += '<br>文字、Excel、Word、PDF、郵件都直接用月訂閱翻譯（請讓這個分頁保持開著）。';
  return t;
}
var host = document.getElementById('cardClaude');
if(host){
  var box = document.createElement('div');
  box.innerHTML = '<label class="chk-line" style="margin-top:8px"><input type="checkbox" id="autoEng"> 自動選擇最佳引擎（偵測到可背景使用月訂閱時自動切換）</label><div class="note" id="autoEngSt" style="line-height:1.7"></div>';
  host.appendChild(box);
  var cb = box.querySelector('#autoEng'), st = box.querySelector('#autoEngSt');
  cb.checked = !!on; st.innerHTML = describe();
  cb.addEventListener('change', function(){ on = cb.checked; lsSet('ait.autoEng', on); if(on) pick(); });
}
engineSel.addEventListener('change', function(e){
  if(e.isTrusted && on){ on = false; lsSet('ait.autoEng', false); var c = document.getElementById('autoEng'); if(c) c.checked = false; }
});
function pick(){
  if(!on) return;
  if(mode === 'apk'){ if(setEngine('sub')) NAT.call('cengStart', claudeUrl()); }
  else if(mode === 'claude'){
    var t0 = Date.now();
    (function wait(){ if(!on) return; if(typeof sampleFn !== 'undefined' && sampleFn){ setEngine('ai'); } else if(Date.now() - t0 < 10000) setTimeout(wait, 250); })();
  }
}
pick();
})();
