/* ============================================================
   8. WORD TAB  (mammoth -> html -> translate text nodes -> minimal docx writer)
   ============================================================ */
var wordState = {file:null, outBlob:null};
wireDropzone('dzWord','fileWord', function(file){
  wordState.file = file;
  showChip('wordChip', file.name, function(){
    wordState.file=null;
    document.getElementById('wordChip').innerHTML='';
    document.getElementById('btnTransWord').disabled = true;
    document.getElementById('btnDlWord').disabled = true;
  });
  document.getElementById('btnTransWord').disabled = false;
  document.getElementById('btnDlWord').disabled = true;
});

function collectTextNodes(root){
  var nodes = [];
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  var n;
  while((n = walker.nextNode())){
    if(n.nodeValue && n.nodeValue.trim()) nodes.push(n);
  }
  return nodes;
}

/* Build minimal .docx from a parsed HTML body element */
function buildDocxFromHtml(bodyEl){
  function runsFromInline(node, fmt){
    var runs = [];
    node.childNodes.forEach(function(child){
      if(child.nodeType === 3){
        if(child.nodeValue) runs.push({t: child.nodeValue, b: fmt.b, i: fmt.i, u: fmt.u});
      } else if(child.nodeType === 1){
        var tag = child.tagName.toLowerCase();
        if(tag === 'br'){ runs.push({brk:true}); return; }
        var nf = {b: fmt.b || tag==='b' || tag==='strong', i: fmt.i || tag==='i' || tag==='em', u: fmt.u || tag==='u'};
        runs = runs.concat(runsFromInline(child, nf));
      }
    });
    return runs;
  }
  function runXml(r){
    if(r.brk) return '<w:r><w:br/></w:r>';
    var rpr = '';
    if(r.b || r.i || r.u){
      rpr = '<w:rPr>'+(r.b?'<w:b/>':'')+(r.i?'<w:i/>':'')+(r.u?'<w:u w:val="single"/>':'')+'</w:rPr>';
    }
    return '<w:r>'+rpr+'<w:t xml:space="preserve">'+escapeXml(r.t)+'</w:t></w:r>';
  }
  function paraXml(runs, styleId){
    var ppr = styleId ? '<w:pPr><w:pStyle w:val="'+styleId+'"/></w:pPr>' : '';
    return '<w:p>'+ppr+runs.map(runXml).join('')+'</w:p>';
  }
  var bodyXml = '';
  function walkBlock(el){
    Array.from(el.children).forEach(function(child){
      var tag = child.tagName.toLowerCase();
      if(/^h[1-6]$/.test(tag)){
        var runs = runsFromInline(child, {});
        bodyXml += paraXml(runs.length?runs:[{t:''}], 'Heading'+tag[1]);
      } else if(tag === 'p'){
        var runs2 = runsFromInline(child, {});
        bodyXml += paraXml(runs2.length?runs2:[{t:''}]);
      } else if(tag === 'ul' || tag === 'ol'){
        Array.from(child.children).forEach(function(li, idx){
          var prefix = tag==='ul' ? '• ' : (idx+1)+'. ';
          var runs3 = [{t:prefix}].concat(runsFromInline(li, {}));
          bodyXml += paraXml(runs3);
        });
      } else if(tag === 'table'){
        var rows = Array.from(child.querySelectorAll('tr'));
        var trXml = rows.map(function(tr){
          var cells = Array.from(tr.children).map(function(td){
            var runs4 = runsFromInline(td, {});
            return '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>'+paraXml(runs4.length?runs4:[{t:''}])+'</w:tc>';
          }).join('');
          return '<w:tr>'+cells+'</w:tr>';
        }).join('');
        bodyXml += '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+
          ['top','left','bottom','right','insideH','insideV'].map(function(s){return '<w:'+s+' w:val="single" w:sz="4" w:color="8C7A50"/>';}).join('')+
          '</w:tblBorders></w:tblPr>'+trXml+'</w:tbl>';
      } else if(tag === 'blockquote' || tag === 'div'){
        walkBlock(child);
      } else {
        var runs5 = runsFromInline(child, {});
        if(runs5.length) bodyXml += paraXml(runs5);
      }
    });
  }
  walkBlock(bodyEl);
  if(!bodyXml) bodyXml = '<w:p/>';

  var documentXml =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
'<w:body>'+bodyXml+
'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>'+
'</w:body></w:document>';

  var stylesXml =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
'<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Microsoft JhengHei" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>'+
'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'+
[1,2,3,4,5,6].map(function(n){
  var sz = [36,32,28,24,22,20][n-1];
  return '<w:style w:type="paragraph" w:styleId="Heading'+n+'"><w:name w:val="heading '+n+'"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="'+sz+'"/></w:rPr></w:style>';
}).join('')+
'</w:styles>';

  var contentTypes =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
'<Default Extension="xml" ContentType="application/xml"/>'+
'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
'<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'+
'</Types>';

  var relsRoot =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'+
'</Relationships>';

  var relsDoc =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'+
'</Relationships>';

  var zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', relsRoot);
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', stylesXml);
  zip.file('word/_rels/document.xml.rels', relsDoc);
  return zip.generateAsync({type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

document.getElementById('btnTransWord').addEventListener('click', async function(){
  if(!textEngineReady()){ engineNotReady(); return; }
  var btn = this; btn.disabled = true;
  try{
    var buf = await wordState.file.arrayBuffer();
    var result = await mammoth.convertToHtml({arrayBuffer: buf});
    var container = document.createElement('div');
    container.innerHTML = result.value;
    var textNodes = collectTextNodes(container);
    var texts = textNodes.map(function(n){ return n.nodeValue; });
    if(!texts.length){
      toast('此檔案中沒有可翻譯的文字內容', true);
      btn.disabled = false; return;
    }
    var out = await translateBatch(texts, {
      sourceLang: srcSel.value, targetLang: tgtSel.value,
      onProgress: function(d,t){ progress('Word', d, t); }
    });
    textNodes.forEach(function(n, idx){ n.nodeValue = out[idx]; });
    var blob = await buildDocxFromHtml(container);
    wordState.outBlob = blob;
    document.getElementById('btnDlWord').disabled = false;
    progressDone('Word','翻譯完成，共處理 '+texts.length+' 個段落');
  }catch(e){
    console.error(e);
    toast('處理失敗：'+errMsg(e), true);
    progressDone('Word','發生錯誤');
  }
  btn.disabled = false;
});
document.getElementById('btnDlWord').addEventListener('click', async function(){
  if(!wordState.outBlob) return;
  openExport({
    title:'匯出 Word',
    names:{trans: baseName(wordState.file.name)+'-'+langFile(tgtSel.value)},
    formats:[{ext:'.docx', label:'Word 文件 (.docx)', blob: wordState.outBlob}]
  });
});

