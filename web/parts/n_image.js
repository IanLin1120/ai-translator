
/* ============================================================
   6. IMAGE TAB  (OCR + translation, one pair per sentence / label)
   ============================================================ */
var imageState = {file: null, lines: null};
wireDropzone('dzImage', 'fileImage', function(file){
  imageState.file = file; imageState.lines = null;
  var url = URL.createObjectURL(file);
  $('imagePreviewWrap').innerHTML = '<img src="' + url + '" style="max-width:100%;max-height:280px;border-radius:10px;border:1px solid var(--border-soft);margin-top:10px;">';
  $('btnTransImage').disabled = false;
  $('resImage').style.display = 'none';
  $('btnDlImage').disabled = true;
});
$('btnTransImage').addEventListener('click', async function(){
  if(!aiImagesAvailable()){ imagesNotAvailable(); return; }
  var btn = this; btn.disabled = true;
  progress('Image', 0, 1, '辨識並翻譯圖片中');
  try{
    var canvas = await loadImageToCanvas(imageState.file, 3200);
    var prepared = await canvasToPrepared(canvas, 1800);
    var lines = await aiTranslateImage(prepared, srcSel.value, tgtSel.value);
    imageState.lines = lines;
    renderPairs($('resImage'), lines, true);
    $('btnDlImage').disabled = !lines.length;
    progressDone('Image', '完成');
  }catch(e){
    console.error(e);
    toast('圖片翻譯失敗：' + errMsg(e), true);
    progressDone('Image', '發生錯誤');
  }
  btn.disabled = false;
});
$('btnDlImage').addEventListener('click', function(){
  if(!imageState.lines || !imageState.lines.length) return;
  openExport({title: '匯出圖片翻譯', names: nameSet(baseName(imageState.file.name)), formats: [txtFormat(imageState.lines)]});
});
