/* ============================================================
   3. TABS
   ============================================================ */
/* (tab switching lives in m_glue.js) */

/* progress helpers */
function progress(prefix, done, total, label){
  var pw = document.getElementById('pw'+prefix);
  var pb = document.getElementById('pb'+prefix);
  var pl = document.getElementById('pl'+prefix);
  pw.classList.add('show');
  var pct = total ? Math.round(done/total*100) : 0;
  pb.style.width = pct+'%';
  pl.textContent = (label||'翻譯中…') + ' ('+done+'/'+total+')';
}
function progressDone(prefix, label){
  var pw = document.getElementById('pw'+prefix);
  var pb = document.getElementById('pb'+prefix);
  var pl = document.getElementById('pl'+prefix);
  pb.style.width='100%';
  pl.textContent = label || '完成';
  setTimeout(function(){pw.classList.remove('show');}, 1600);
}
function baseName(filename){
  var idx = filename.lastIndexOf('.');
  return idx>0 ? filename.slice(0,idx) : filename;
}
function extName(filename){
  var idx = filename.lastIndexOf('.');
  return idx>0 ? filename.slice(idx) : '';
}
function outName(filename, ext){
  return baseName(filename)+'-'+langName(tgtSel.value)+(ext||extName(filename));
}
function escapeXml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

