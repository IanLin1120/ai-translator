/* ============================================================
   7. EXCEL TAB
   ============================================================ */
var excelState = {file:null, wb:null, outBlob:null};
wireDropzone('dzExcel','fileExcel', function(file){
  excelState.file = file;
  showChip('excelChip', file.name, function(){
    excelState.file=null; excelState.wb=null;
    document.getElementById('excelChip').innerHTML='';
    document.getElementById('btnTransExcel').disabled = true;
    document.getElementById('btnDlExcel').disabled = true;
  });
  document.getElementById('btnTransExcel').disabled = false;
  document.getElementById('btnDlExcel').disabled = true;
});
document.getElementById('btnTransExcel').addEventListener('click', async function(){
  if(!textEngineReady()){ engineNotReady(); return; }
  var btn = this; btn.disabled = true;
  try{
    var buf = await excelState.file.arrayBuffer();
    var wb = XLSX.read(buf, {type:'array', cellStyles:true, bookVBA:true});
    var texts = [];
    var refs = [];
    wb.SheetNames.forEach(function(sn){
      var ws = wb.Sheets[sn];
      Object.keys(ws).forEach(function(cellRef){
        if(cellRef[0]==='!') return;
        var cell = ws[cellRef];
        if(cell && cell.t === 's' && typeof cell.v === 'string' && cell.v.trim()){
          texts.push(cell.v);
          refs.push({sheet:sn, ref:cellRef});
        }
      });
    });
    if(!texts.length){
      toast('此檔案中沒有可翻譯的文字內容', true);
      btn.disabled = false; return;
    }
    var out = await translateBatch(texts, {
      sourceLang: srcSel.value, targetLang: tgtSel.value,
      onProgress: function(d,t){ progress('Excel', d, t); }
    });
    refs.forEach(function(r, idx){
      var cell = wb.Sheets[r.sheet][r.ref];
      cell.v = out[idx];
      if(cell.w) cell.w = out[idx];
    });
    var wbout = XLSX.write(wb, {bookType:'xlsx', type:'array', cellStyles:true});
    excelState.outBlob = new Blob([wbout], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    document.getElementById('btnDlExcel').disabled = false;
    progressDone('Excel','翻譯完成，共處理 '+texts.length+' 個儲存格');
  }catch(e){
    console.error(e);
    toast('處理失敗：'+errMsg(e), true);
    progressDone('Excel','發生錯誤');
  }
  btn.disabled = false;
});
document.getElementById('btnDlExcel').addEventListener('click', async function(){
  if(!excelState.outBlob) return;
  openExport({
    title:'匯出 Excel',
    names:{trans: baseName(excelState.file.name)+'-'+langFile(tgtSel.value)},
    formats:[{ext:'.xlsx', label:'Excel 活頁簿 (.xlsx)', blob: excelState.outBlob}]
  });
});

