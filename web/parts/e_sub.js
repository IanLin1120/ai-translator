/* ============================================================
   Claude 月訂閱「複製貼上橋接」（網頁版／離線版用）
   瀏覽器不允許一般網頁直接借用 Claude 月訂閱，所以用最穩的方式：
   本頁把「翻譯任務」打包成一段文字 → 你貼到 Claude（線上版橋接接收區，或一般 claude.ai 對話）→ 把結果貼回來。
   文字、圖片以外的 Excel／Word／PDF／郵件全部都能用，且會自動把任務切成較大的段落減少來回次數。
   在 Claude.ai 裡的線上版另有「橋接接收區」：貼上任務 → 用訂閱翻譯 → 一鍵複製結果。
   ============================================================ */
(function(){
var APK = !!(window.AIT && typeof window.AIT.version === 'function');
if(APK) return;
var $s = function(id){ return document.getElementById(id); };
var ARTIFACT = 'https://claude.ai/artifact/GrGKSNbfMi5K2saoWNStz9';
var HEAD = '【AIT 翻譯任務】請完全照下面的指示處理，只回傳 JSON，不要任何說明、標題或 markdown 標記。\n\n';

function copyText(t){
  return (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).catch(function(){
    var ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;left:-999px'; document.body.appendChild(ta); ta.select();
    var ok = false; try{ ok = document.execCommand('copy'); }catch(e){} ta.remove(); if(!ok) throw new Error('copy');
  });
}

/* ---------- 一般網頁／離線版：橋接對話框 ---------- */
if(!IN_CLAUDE){
  var o = document.createElement('option'); o.value = 'subpaste'; o.textContent = 'Claude 月訂閱（複製貼上橋接）';
  engineSel.appendChild(o);
  window.AIT_LIMITS = function(){ return engineSel.value === 'subpaste' ? {chunk: 120, chars: 9000} : null; };
  var mask = document.createElement('div'); mask.className = 'modal-mask'; mask.id = 'subMask'; mask.style.zIndex = 1200;
  mask.innerHTML = '<div class="modal-box wide"><h3 id="subTitle">🔗 Claude 月訂閱橋接</h3>' +
    '<div class="note" style="line-height:1.7">① 按「複製任務」　② 到 Claude 貼上（<a href="#" id="subOpen">開啟 Claude 線上版橋接區</a> 或直接貼到 claude.ai 一般對話，兩種都行）　③ 把 Claude 回的結果複製回來貼在下面，按「套用結果」。</div>' +
    '<div class="field"><label class="lbl">任務（要貼給 Claude）<span id="subSize" style="opacity:.7"></span></label><textarea id="subJob" readonly rows="4" style="width:100%"></textarea></div>' +
    '<div class="btn-row"><button class="primary" id="subCopy">📋 複製任務</button><button class="secondary" id="subOpen2">☁ 開啟 Claude</button></div>' +
    '<div class="field"><label class="lbl">Claude 回傳的結果（貼在這裡，貼上後會自動套用）</label><textarea id="subRes" rows="5" style="width:100%" placeholder="貼上 Claude 的回覆（JSON）…"></textarea></div>' +
    '<div id="subErr" class="note err" style="display:none"></div>' +
    '<div class="btn-row"><button class="olive" id="subApply">✅ 套用結果</button><button class="secondary" id="subPaste">📋 從剪貼簿貼上</button><button class="secondary" id="subCancel">取消</button></div></div>';
  document.body.appendChild(mask);
  var cur = null, seq = 0, total = 0;
  function openClaude(){ var u = (typeof lsGet === 'function' && lsGet('ait.claudeUrl', '')) || ARTIFACT; if(!/^https:\/\/claude\.ai\//.test(u)) u = ARTIFACT; window.open(u, '_blank', 'noopener'); }
  $s('subOpen').addEventListener('click', function(e){ e.preventDefault(); openClaude(); });
  $s('subOpen2').addEventListener('click', openClaude);
  $s('subCopy').addEventListener('click', function(){ copyText($s('subJob').value).then(function(){ toast('✓ 已複製任務，到 Claude 貼上'); }).catch(function(){ $s('subJob').select(); toast('請手動全選複製', true); }); });
  function tryApply(){
    if(!cur) return;
    var t = $s('subRes').value.trim(); if(!t) return;
    try{ var v = parseJsonLoose(t); if(v == null) throw new Error('empty'); var c = cur; cur = null; mask.classList.remove('show'); c.ok(v); }
    catch(e){ var er = $s('subErr'); er.style.display = 'block'; er.textContent = '這段內容不是有效的 JSON，請確認有完整複製 Claude 的整段回覆（含最前面的 [ 到最後面的 ]）。'; }
  }
  $s('subApply').addEventListener('click', tryApply);
  $s('subRes').addEventListener('paste', function(){ setTimeout(tryApply, 60); });
  $s('subPaste').addEventListener('click', function(){
    if(!(navigator.clipboard && navigator.clipboard.readText)){ toast('此瀏覽器不能自動讀剪貼簿，請在欄位內長按／Ctrl+V 貼上', true); return; }
    navigator.clipboard.readText().then(function(t){ $s('subRes').value = t; tryApply(); }).catch(function(){ toast('沒有讀取剪貼簿的權限，請直接在欄位內貼上', true); });
  });
  $s('subCancel').addEventListener('click', function(){ if(!cur) return; var c = cur; cur = null; mask.classList.remove('show'); var e = new Error('已取消橋接翻譯'); e.code = 'cancel'; c.no(e); });
  window.subBridge = function(prompt){
    return new Promise(function(ok, no){
      seq++; cur = {ok: ok, no: no};
      var job = HEAD + prompt;
      $s('subTitle').textContent = '🔗 Claude 月訂閱橋接（第 ' + seq + ' 段）';
      $s('subJob').value = job; $s('subSize').textContent = '　約 ' + job.length + ' 字';
      $s('subRes').value = ''; $s('subErr').style.display = 'none'; mask.classList.add('show');
    });
  };
  var _aa = aiAvailable, _ai = aiImagesAvailable, _cj = callAIJson, _up = updateEnginePill, _tb = translateBatch;
  aiAvailable = function(){ return engineSel.value === 'subpaste' ? true : _aa(); };
  aiImagesAvailable = function(){ return engineSel.value === 'subpaste' ? false : _ai(); };
  callAIJson = function(prompt, imgs){ return engineSel.value === 'subpaste' ? window.subBridge(prompt) : _cj(prompt, imgs); };
  translateBatch = async function(texts, opts){ if(engineSel.value === 'subpaste') seq = 0; return _tb(texts, opts); };
  updateEnginePill = function(){
    if(engineSel.value === 'subpaste'){ enginePill.textContent = 'Claude 月訂閱（貼上橋接）'; enginePill.className = 'status-pill ok'; return; }
    _up();
  };
  engineSel.addEventListener('change', updateEnginePill);
  updateEnginePill();
}

/* ---------- Claude.ai 線上版：橋接接收區 ---------- */
if(IN_CLAUDE){
  var host = document.getElementById('p-trans') || document.querySelector('.page');
  if(host){
    var card = document.createElement('div'); card.className = 'card glass'; card.id = 'cardBridge';
    card.innerHTML = '<h3>🔗 橋接接收區（用 Claude 月訂閱翻譯別處貼來的任務）</h3>' +
      '<p class="desc">離線版／GitHub 網頁版選「Claude 月訂閱（複製貼上橋接）」會產生任務文字，貼在這裡，用你的月訂閱額度翻譯，再一鍵複製結果貼回去。</p>' +
      '<textarea id="brJob" rows="4" style="width:100%" placeholder="貼上任務文字…"></textarea>' +
      '<div class="btn-row"><button class="primary" id="brRun">▶ 用 Claude 訂閱翻譯</button><button class="secondary" id="brClear">清除</button></div>' +
      '<div class="progress-label" id="brSt" style="margin:6px 0"></div>' +
      '<textarea id="brRes" rows="4" style="width:100%" readonly placeholder="翻譯結果（JSON）會顯示在這裡"></textarea>' +
      '<div class="btn-row"><button class="olive" id="brCopy" disabled>📋 複製結果</button></div>';
    host.insertBefore(card, host.firstChild);
    $s('brClear').addEventListener('click', function(){ $s('brJob').value = ''; $s('brRes').value = ''; $s('brSt').textContent = ''; $s('brCopy').disabled = true; });
    $s('brRun').addEventListener('click', async function(){
      var job = $s('brJob').value.trim();
      if(!job){ toast('請先貼上任務文字', true); return; }
      if(!sampleFn){ toast('這個頁面尚未取得使用 Claude 的授權（請按允許）', true); return; }
      var b = this; b.disabled = true; $s('brSt').textContent = '翻譯中…'; $s('brCopy').disabled = true; $s('brRes').value = '';
      try{
        var v = await sampleFn.json(job.replace(/^【AIT 翻譯任務】[^\n]*\n+/, ''), {modelTier: 'default'});
        $s('brRes').value = JSON.stringify(v); $s('brSt').textContent = '完成，按「複製結果」後回到原本的頁面貼上。'; $s('brCopy').disabled = false;
      }catch(e){
        var m = (e && e.message) ? e.message : String(e);
        if(e && e.code === 'rate_limited') m = '已達 Claude 訂閱用量或速率限制，請稍後再試。';
        $s('brSt').textContent = '失敗：' + m;
      }
      b.disabled = false;
    });
    $s('brCopy').addEventListener('click', function(){ copyText($s('brRes').value).then(function(){ toast('✓ 已複製結果'); }).catch(function(){ $s('brRes').select(); toast('請手動全選複製', true); }); });
  }
}
})();
