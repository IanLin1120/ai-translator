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
/* 新引擎：直接改 .xlsx 內部 XML，保留全部格式／表格／圖表／樞紐分析；同時產生「僅翻譯版」與「中英夾雜版」 */
function xmlTranslateFn(tag){
  return function(texts, onProgress){
    return translateBatch(texts, {sourceLang: srcSel.value, targetLang: tgtSel.value, onProgress: function(d, t){ progress(tag, d, t, '翻譯內容中'); }});
  };
}
function twoModeExport(title, ext, label, file, files, stats){
  var mk = function(u8, mime){ return new Blob([u8], {type: mime}); };
  var mime = ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var base = baseName(file.name);
  openExport({
    title: title,
    names: {trans: base + '-' + langFile(tgtSel.value), both: base + '-中英對照'},
    formats: [{ext: ext, label: label, modes: ['trans', 'both'],
      modeLabels: {trans: '僅翻譯版（內容全部換成譯文）', both: '中英夾雜版（一段原文＋下方一段譯文）'},
      blobs: {trans: mk(files.trans, mime), both: mk(files.both, mime)}}]
  });
}
document.getElementById('btnTransExcel').addEventListener('click', async function(){
  if(!textEngineReady()){ engineNotReady(); return; }
  var btn = this; btn.disabled = true;
  try{
    var buf = await excelState.file.arrayBuffer();
    if(!/\.(xlsx|xlsm)$/i.test(excelState.file.name)){ toast('目前只支援 .xlsx／.xlsm，請先用 Excel 另存為 .xlsx', true); btn.disabled = false; return; }
    progress('Excel', 0, 1, '分析檔案中');
    var r = await XMLF.xlsx(buf, xmlTranslateFn('Excel'), ['trans', 'both']);
    if(!r.count){ toast('此檔案中沒有可翻譯的文字內容', true); progressDone('Excel', '沒有可翻譯的文字'); btn.disabled = false; return; }
    excelState.outFiles = r.files; excelState.stats = r.stats;
    document.getElementById('btnDlExcel').disabled = false;
    progressDone('Excel', '翻譯完成，共處理 ' + r.count + ' 個儲存格／文字' + (r.stats.skippedHeaders ? '（' + r.stats.skippedHeaders + ' 個表格標題列／下拉選單來源依設計保持原文，避免破壞公式與樞紐分析）' : ''));
  }catch(e){
    console.error(e);
    toast('處理失敗：' + errMsg(e), true);
    progressDone('Excel', '發生錯誤');
  }
  btn.disabled = false;
});
document.getElementById('btnDlExcel').addEventListener('click', async function(){
  if(!excelState.outFiles) return;
  twoModeExport('匯出 Excel', '.xlsx', 'Excel 活頁簿 (.xlsx)，保留原始格式', excelState.file, excelState.outFiles);
});
