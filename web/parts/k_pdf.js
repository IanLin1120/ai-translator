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
document.getElementById('btnTransPdf').addEventListener('click', async function(){
  if(!textEngineReady()){ engineNotReady(); return; }
  var btn = this; btn.disabled = true;
  try{
    var buf = await pdfState.file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({data: buf}).promise;
    var allTexts = [];
    var pageData = [];
    progress('Pdf', 0, pdf.numPages, '讀取頁面中');
    for(var p=1; p<=pdf.numPages; p++){
      var page = await pdf.getPage(p);
      var viewport = page.getViewport({scale: 1.6});
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      var ctx = canvas.getContext('2d');
      await page.render({canvasContext: ctx, viewport: viewport}).promise;
      var imgData = canvas.toDataURL('image/jpeg', 0.85);

      var textContent = await page.getTextContent();
      var items = textContent.items.map(function(it){
        var tx = it.transform;
        var scale = viewport.scale;
        var x = tx[4]*scale;
        var yTop = viewport.height - (tx[5]*scale) - (Math.hypot(tx[2],tx[3])*scale);
        var fontSize = Math.hypot(tx[0],tx[1]) * scale;
        return {str: it.str, x:x, y:yTop, fontSize: Math.max(fontSize,8), width: it.width*scale};
      }).filter(function(it){ return it.str && it.str.trim(); });

      items.forEach(function(it){ allTexts.push(it.str); });
      pageData.push({w: viewport.width, h: viewport.height, img: imgData, items: items});
      progress('Pdf', p, pdf.numPages, '讀取頁面中');
    }
    if(!allTexts.length){
      toast('未能從此 PDF 擷取到文字（可能為掃描圖片檔）', true);
      btn.disabled = false; return;
    }
    var translated = await translateBatch(allTexts, {
      sourceLang: srcSel.value, targetLang: tgtSel.value,
      onProgress: function(d,t){ progress('Pdf', d, t, '翻譯內容中'); }
    });
    var cursor = 0;
    pageData.forEach(function(pg){
      pg.items.forEach(function(it){ it.translated = translated[cursor++]; });
    });

    var pagesHtml = pageData.map(function(pg, idx){
      var overlays = pg.items.map(function(it){
        return '<div style="position:absolute;left:'+it.x.toFixed(1)+'px;top:'+(it.y - it.fontSize*0.15).toFixed(1)+'px;font-size:'+it.fontSize.toFixed(1)+'px;line-height:1.1;color:#a8471f;background:rgba(251,241,228,0.92);padding:0 2px;white-space:nowrap;max-width:'+(it.width>0?(it.width*1.6):400).toFixed(0)+'px;overflow:hidden;text-overflow:ellipsis;">'+escapeXml(it.translated)+'</div>';
      }).join('');
      return '<div class="page" style="position:relative;width:'+pg.w+'px;height:'+pg.h+'px;margin:0 auto 24px;box-shadow:0 2px 10px rgba(0,0,0,.25);">'+
        '<img src="'+pg.img+'" style="width:100%;height:100%;display:block;">'+
        overlays+'</div>';
    }).join('');

    var htmlDoc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+escapeXml(outName(pdfState.file.name,''))+'</title>'+
      '<style>body{background:#DCCFAE;margin:0;padding:24px 0;font-family:"Noto Sans TC",sans-serif;} @media print{body{background:#fff;padding:0;} .page{box-shadow:none;margin:0;}}</style>'+
      '</head><body>'+pagesHtml+'</body></html>';

    pdfState.outBlob = new Blob([htmlDoc], {type:'text/html'});
    document.getElementById('btnDlPdf').disabled = false;
    progressDone('Pdf', '翻譯完成，共 '+pdf.numPages+' 頁、'+allTexts.length+' 個文字區塊');
  }catch(e){
    console.error(e);
    toast('處理失敗：'+errMsg(e), true);
    progressDone('Pdf','發生錯誤');
  }
  btn.disabled = false;
});
document.getElementById('btnDlPdf').addEventListener('click', async function(){
  if(!pdfState.outBlob) return;
  openExport({
    title:'匯出 PDF 翻譯（版面一致的 HTML）',
    names:{trans: baseName(pdfState.file.name)+'-'+langFile(tgtSel.value)},
    formats:[{ext:'.html', label:'網頁檔 (.html)，開啟後可「列印→另存為 PDF」', blob: pdfState.outBlob}]
  });
});

