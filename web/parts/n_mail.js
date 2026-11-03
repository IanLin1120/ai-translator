
/* ============================================================
   10. OUTLOOK MAIL TAB  (.eml fully decoded; .msg best effort)
   ============================================================ */
var mailState = {file: null, res: null};
wireDropzone('dzMail', 'fileMail', function(file){
  mailState.file = file; mailState.res = null;
  showChip('mailChip', file.name, function(){
    mailState.file = null; mailState.res = null;
    $('mailChip').innerHTML = '';
    $('btnTransMail').disabled = true;
    $('btnDlMail').disabled = true;
    $('resMail').style.display = 'none';
  });
  $('btnTransMail').disabled = false;
  $('btnDlMail').disabled = true;
});
$('btnTransMail').addEventListener('click', async function(){
  if(!textEngineReady()){ engineNotReady(); return; }
  var btn = this; btn.disabled = true;
  try{
    var isMsg = /\.msg$/i.test(mailState.file.name);
    var headers = {from: '', to: '', cc: '', date: '', subject: ''}, body = '';
    if(isMsg){
      try{
        var mm = MSGX.parse(await mailState.file.arrayBuffer()), fa = function(a){ return a ? (a.name && a.email ? a.name + ' <' + a.email + '>' : (a.email || a.name || '')) : ''; };
        headers = {from: fa(mm.from), to: mm.to.map(fa).join(', ') || mm.toDisplay, cc: mm.cc.map(fa).join(', ') || mm.ccDisplay, date: mm.date ? mm.date.toString() : '', subject: mm.subject};
        body = mm.text || (mm.html || '').replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
      }catch(e){ body = msgBestEffort(await mailState.file.arrayBuffer()); }
    }
    else { var p = parseEmlFull(await mailState.file.text()); headers = p.headers; body = p.text; }
    if(!body.trim() && !headers.subject.trim()){ toast('無法從此檔案讀出郵件內容', true); btn.disabled = false; return; }

    var segs = segmentText(body), flat = [], hasSubj = !!headers.subject.trim();
    if(hasSubj) flat.push(headers.subject.trim());
    segs.forEach(function(s){ s.sents.forEach(function(x){ flat.push(x); }); });
    var out = await translateBatch(flat, {
      sourceLang: srcSel.value, targetLang: tgtSel.value,
      onProgress: function(d, t){ progress('Mail', d, t); }
    });
    var k = 0, subjT = hasSubj ? out[k++] : '';
    segs.forEach(function(s){ s.pairs = s.sents.map(function(x){ return {o: x, t: out[k++]}; }); });

    var lines = [];
    function hdr(label, v){ if(v) lines.push({orig: label + v, keep: true, pairs: []}); }
    hdr('From: ', headers.from); hdr('To: ', headers.to); hdr('Cc: ', headers.cc); hdr('Date: ', headers.date);
    if(lines.length) lines.push({orig: '', keep: true, pairs: []});
    if(hasSubj){
      lines.push({orig: '[Subject] ' + headers.subject.trim(), pairs: [{o: '[Subject] ' + headers.subject.trim(), t: '[Subject] ' + subjT}]});
      lines.push({orig: '', pairs: []});
    }
    segs.forEach(function(s){ lines.push(s); });
    mailState.res = {lines: lines, headers: headers, subjT: subjT, segs: segs, isMsg: isMsg};

    var box = $('resMail');
    box.style.display = 'block';
    box.textContent = buildTxt(lines, 'trans', {}, tgtSel.value);
    $('btnDlMail').disabled = false;
    progressDone('Mail', '翻譯完成');
  }catch(e){
    console.error(e);
    toast('處理失敗：' + errMsg(e), true);
    progressDone('Mail', '發生錯誤');
  }
  btn.disabled = false;
});
$('btnDlMail').addEventListener('click', function(){
  var r = mailState.res;
  if(!r) return;
  var formats = [txtFormat(r.lines)];
  if(!IN_CLAUDE){
    formats.push({
      ext: '.eml', label: '郵件檔 (.eml)（僅譯文，可直接用 Outlook 開啟）', mime: 'message/rfc822',
      text: function(){ return buildEml(r.headers, r.subjT, buildTxt(r.segs, 'trans', {}, tgtSel.value)); }
    });
  }
  openExport({title: '匯出郵件翻譯', names: nameSet(baseName(mailState.file.name)), formats: formats});
});
