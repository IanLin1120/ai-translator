/* ============================================================
   網頁版（離線 html／線上 artifact／GitHub Pages）適配：介面與 APK 相同，
   原生才有的功能改用瀏覽器能做到的替代方案。APK 內不執行。
   ============================================================ */
(function(){
if(isApp) return;
var ws = function(id){ return document.getElementById(id); };
/* 懸浮即時翻譯：改用「截圖翻譯卡」的擷取畫面＋置頂小視窗 */
var fw = ws('flWebOnly');
if(fw){
  fw.className = 'note';
  fw.innerHTML = '🪟 <b>網頁版懸浮翻譯</b>：到下方「截圖翻譯」按 <b>開始擷取畫面</b>，選要翻譯的視窗，再按 <b>開啟懸浮即時翻譯</b>，結果會顯示在可蓋在其他軟體上方的置頂小視窗（Chrome／Edge 電腦版）。手機請安裝 APK 版。';
}
var capb = ws('btnCapture'); if(capb){ capb.classList.remove('hide'); capb.textContent = '🖥 開始擷取畫面（電腦）'; }
['btnFloat', 'btnStopCap', 'liveOpts'].forEach(function(id){ var e = ws(id); if(e) e.classList.remove('hide'); });
/* 即時字幕：改用瀏覽器語音辨識 */
var cw = ws('capWebOnly');
if(cw){
  cw.className = 'note';
  cw.innerHTML = '🎙 <b>網頁版即時字幕</b>：使用瀏覽器內建語音辨識（Chrome／Edge），可只顯示原文不翻譯，字型、大小、顏色、背景都能調。要翻譯影片請讓喇叭播放給麥克風收音，或在面板勾選「分享分頁聲音」。<div class="btn-row" style="margin-top:8px"><button class="primary" id="btnWcOpen">開啟即時字幕設定</button></div>';
  var ob = ws('btnWcOpen'); if(ob) ob.addEventListener('click', function(){ if(window.WCAP && WCAP.open) WCAP.open(); else toast('此瀏覽器無法使用語音辨識', true); });
}
/* 手機版面已有導覽列，隱藏浮動的字幕鈕（改由卡片開啟） */
var wb = ws('wcBtn'); if(wb && ws('nav')) wb.style.display = 'none';
/* Claude 訂閱說明 */
var cc = ws('cardClaude');
if(cc){
  var d = cc.querySelector('.desc');
  if(d && IN_CLAUDE) d.innerHTML = '✅ 你正在 Claude.ai 裡：把「翻譯引擎」選成 <b>AI 翻譯（Claude）</b>，就會用你的 Claude 月訂閱額度翻譯，不需 API 金鑰（第一次按「允許」）。Groq／Gemini 等外部服務在這裡會被 Claude.ai 的安全政策擋住，要用請開 GitHub 網頁版或離線檔。';
  else if(d) d.innerHTML = '用 <b>Claude 月訂閱</b>翻譯（不用 API 金鑰）：在「翻譯引擎」選 <b>Claude 月訂閱（複製貼上橋接）</b>。網頁不能像 APK 一樣在背景自動開線上版（瀏覽器安全限制），所以改成：本頁產生任務 → 貼到 Claude 線上版的「橋接接收區」→ 複製結果貼回來。文字、Excel、Word、PDF、郵件都能用，任務會合併成較大的段落，來回次數很少。';
}
})();
