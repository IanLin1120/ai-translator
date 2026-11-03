/* ============================================================
   9. PDF TAB  (pdf.js render page -> image background + overlay translated text -> html)
   ============================================================ */
if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc = window.PDF_WORKER_URL || 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}
var pdfState = {file:null, outBlob:null};
wireDropzone('dzPdf','filePdf', function(file){
  pdfState.file = file;
  showChip('pdfChip', file.name, function(){
    pdfState.file=null;
    document.getElementById('pdfChip').innerHTML='';
    document.getElementById('btnTransPdf').disabled = true;
    document.getElementById('btnDlPdf').disabled = true;
  });
  document.getElementById('btnTransPdf').disabled = false;
  document.getElementById('btnDlPdf').disabled = true;
});
/* 同時產生「版面一致的 HTML 複本」的選項（會多花一倍翻譯量，所以預設不勾） */
(function(){
  var b = document.getElementById('btnTransPdf');
  if(!b || document.getElementById('pdfOverlay')) return;
  var lab = document.createElement('label');
  lab.className = 'chk-line'; lab.style.margin = '8px 0 0';
  lab.innerHTML = '<input type="checkbox" id="pdfOverlay"> 同時產生「版面一致的 HTML 複本」（原頁面圖片上疊譯文；翻譯量約多一倍）';
  var row = b.closest('.btn-row') || b.parentNode;
  row.parentNode.insertBefore(lab, row.nextSibling);
})();
document.getElementById('btnTransPdf').addEventListener('click', async function(){
  if(!textEngineReady()){ engineNotReady(); return; }
  var btn = this; btn.disabled = true;
  try{
    var wantHtml = !!(document.getElementById('pdfOverlay') && document.getElementById('pdfOverlay').checked);
    var buf = await pdfState.file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({data: buf}).promise;
    var pageData = [], pages = [], itemTexts = [], first = null;
    progress('Pdf', 0, pdf.numPages, '讀取頁面中');
    for(var p = 1; p <= pdf.numPages; p++){
      var page = await pdf.getPage(p);
      var vp1 = page.getViewport({scale: 1});
      if(!first) first = {w: vp1.width, h: vp1.height};
      var textContent = await page.getTextContent();
      var raw = textContent.items.filter(function(it){ return it.str && it.str.trim(); }).map(function(it){
        var tx = it.transform, size = Math.hypot(tx[0], tx[1]);
        var st = textContent.styles && textContent.styles[it.fontName], ff = (st && st.fontFamily || '') + ' ' + (it.fontName || '');
        return {str: it.str, x: tx[4], y: vp1.height - tx[5] - size, size: Math.max(size, 6), w: it.width, bold: /bold|black|heavy/i.test(ff)};
      });
      var paras = XMLF.groupPdfItems(raw);
      var sizes = paras.map(function(q){ return q.size; }).sort(function(a, b){ return a - b; }), med = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 10;
      paras.forEach(function(q){ if(q.size > med * 1.25) q.bold = true; });
      pages.push({paras: paras});
      if(wantHtml){
        var viewport = page.getViewport({scale: 1.6});
        var canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({canvasContext: canvas.getContext('2d'), viewport: viewport}).promise;
        var items = raw.map(function(r){ return {str: r.str, x: r.x * 1.6, y: r.y * 1.6, fontSize: Math.max(r.size * 1.6, 8), width: r.w * 1.6}; });
        items.forEach(function(it){ itemTexts.push(it.str); });
        pageData.push({w: viewport.width, h: viewport.height, img: canvas.toDataURL('image/jpeg', 0.85), items: items});
      }
      progress('Pdf', p, pdf.numPages, '讀取頁面中');
    }
    var paraTexts = [];
    pages.forEach(function(pg){ pg.paras.forEach(function(q){ if(XMLF.worth(q.text)) paraTexts.push(q.text); }); });
    if(!paraTexts.length){ toast('未能從此 PDF 擷取到文字（可能為掃描圖片檔）', true); btn.disabled = false; return; }
    var uniq = Array.from(new Set(paraTexts));
    var out = await translateBatch(uniq, {sourceLang: srcSel.value, targetLang: tgtSel.value, onProgress: function(d, t){ progress('Pdf', d, t, '翻譯內容中'); }});
    var tr = {}; uniq.forEach(function(t, i){ tr[t] = out[i] || t; });
    var files = {
      trans: await XMLF.buildDocxFromParas(pages, first, 'trans', tr),
      both: await XMLF.buildDocxFromParas(pages, first, 'both', tr)
    };
    pdfState.outFiles = files;
    pdfState.outBlob = null;
    if(wantHtml){
      var translated = await translateBatch(itemTexts, {sourceLang: srcSel.value, targetLang: tgtSel.value, onProgress: function(d, t){ progress('Pdf', d, t, '翻譯版面文字中'); }});
      var cursor = 0;
      pageData.forEach(function(pg){ pg.items.forEach(function(it){ it.translated = translated[cursor++]; }); });
      var pagesHtml = pageData.map(function(pg){
        var overlays = pg.items.map(function(it){
          return '<div style="position:absolute;left:' + it.x.toFixed(1) + 'px;top:' + (it.y - it.fontSize * 0.15).toFixed(1) + 'px;font-size:' + it.fontSize.toFixed(1) + 'px;line-height:1.1;color:#a8471f;background:rgba(251,241,228,0.92);white-space:nowrap;">' + escapeXml(it.translated || it.str) + '</div>';
        }).join('');
        return '<div class="page" style="position:relative;width:' + pg.w + 'px;height:' + pg.h + 'px;margin:0 auto 24px;box-shadow:0 2px 10px rgba(0,0,0,.25);"><img src="' + pg.img + '" style="width:100%;height:100%;display:block;">' + overlays + '</div>';
      }).join('');
      var htmlDoc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + escapeXml(outName(pdfState.file.name, '')) + '</title><style>body{background:#DCCFAE;margin:0;padding:24px 0;font-family:"Noto Sans TC",sans-serif;} @media print{body{background:#fff;padding:0;} .page{box-shadow:none;margin:0;}}</style></head><body>' + pagesHtml + '</body></html>';
      pdfState.outBlob = new Blob([htmlDoc], {type: 'text/html'});
    }
    document.getElementById('btnDlPdf').disabled = false;
    progressDone('Pdf', '翻譯完成，共 ' + pdf.numPages + ' 頁、' + paraTexts.length + ' 個段落');
  }catch(e){
    console.error(e);
    toast('處理失敗：' + errMsg(e), true);
    progressDone('Pdf', '發生錯誤');
  }
  btn.disabled = false;
});
document.getElementById('btnDlPdf').addEventListener('click', async function(){
  if(!pdfState.outFiles) return;
  var base = baseName(pdfState.file.name), mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var formats = [{ext: '.docx', label: 'Word 可編輯檔 (.docx)，可再用 Word 另存 PDF', modes: ['trans', 'both'],
    modeLabels: {trans: '僅翻譯版（只有譯文）', both: '中英夾雜版（一段原文＋下方一段譯文）'},
    blobs: {trans: new Blob([pdfState.outFiles.trans], {type: mime}), both: new Blob([pdfState.outFiles.both], {type: mime})}}];
  if(pdfState.outBlob) formats.push({ext: '.html', label: '版面一致的網頁檔 (.html)，開啟後可「列印→另存為 PDF」', blob: pdfState.outBlob});
  openExport({title: '匯出 PDF 翻譯', names: {trans: base + '-' + langFile(tgtSel.value), both: base + '-中英對照'}, formats: formats});
});
