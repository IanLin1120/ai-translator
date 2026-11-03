/* ============================================================
   直接修改檔案內部 XML 的翻譯引擎（Excel .xlsx／Word .docx）：
   只替換文字，其餘（格式、表格、圖表、樞紐分析、圖片、頁首頁尾…）原封不動。
   mode: 'trans' 只翻譯　'both' 中英夾雜（一段原文＋一段譯文）
   ============================================================ */
var XMLF = (function(){
var LET = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-ۿऀ-෿฀-๿ᄀ-ᇿ぀-ヿ㄰-㆏㐀-鿿가-힯]/;
function unesc(s){
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function(m, g){
    if(g === 'amp') return '&'; if(g === 'lt') return '<'; if(g === 'gt') return '>'; if(g === 'quot') return '"'; if(g === 'apos') return "'";
    var n = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    try{ return String.fromCodePoint(n); }catch(e){ return m; }
  }).replace(/_x([0-9A-Fa-f]{4})_/g, function(m, h){ return String.fromCharCode(parseInt(h, 16)); });
}
function esc(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function worth(t){
  t = (t || '').trim();
  if(!t || !LET.test(t)) return false;
  if(/^(https?:\/\/|www\.)\S+$/i.test(t) || /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t)) return false;
  if(/^[A-Za-z]{1,3}\d{0,3}$/.test(t) && t.length <= 2) return false;     /* 單一代號：A、B2… */
  return true;
}
async function readStr(zip, p){ var f = zip.file(p); return f ? await f.async('string') : null; }
function colNum(s){ var n = 0; for(var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
function splitRef(r){ var m = /^\$?([A-Z]+)\$?(\d+)$/.exec(r); return m ? {c: colNum(m[1]), r: +m[2]} : null; }
function rangeOf(ref){
  var p = String(ref).replace(/\$/g, '').split(':'), a = splitRef(p[0]), b = splitRef(p[1] || p[0]);
  return (a && b) ? {c1: Math.min(a.c, b.c), r1: Math.min(a.r, b.r), c2: Math.max(a.c, b.c), r2: Math.max(a.r, b.r)} : null;
}
function inR(R, c, r){ return c >= R.c1 && c <= R.c2 && r >= R.r1 && r <= R.r2; }
function attr(s, n){ var m = new RegExp('\\b' + n + '="([^"]*)"').exec(s); return m ? m[1] : null; }
function resolveTarget(base, t){
  if(t.charAt(0) === '/') return t.slice(1);
  var parts = base.split('/'); parts.pop();
  t.split('/').forEach(function(x){ if(x === '..') parts.pop(); else if(x && x !== '.') parts.push(x); });
  return parts.join('/');
}
function relsOf(path){ var i = path.lastIndexOf('/'); return path.slice(0, i + 1) + '_rels/' + path.slice(i + 1) + '.rels'; }
async function relMap(zip, path){
  var x = await readStr(zip, relsOf(path)), out = [];
  if(!x) return out;
  x.replace(/<Relationship\b[^>]*>/g, function(m){ out.push({id: attr(m, 'Id'), type: attr(m, 'Type') || '', target: resolveTarget(path, attr(m, 'Target') || '')}); return m; });
  return out;
}
function same(a, b){ return String(a).trim() === String(b).trim(); }
function langLines(t){ return String(t).split('\n'); }

/* ---------- 逐段翻譯（去重、略過不需翻的） ---------- */
async function runTranslate(items, fn, onProgress){
  var uniq = [], idx = {};
  items.forEach(function(t){ if(!(t in idx)){ idx[t] = uniq.length; uniq.push(t); } });
  var out = uniq.length ? await fn(uniq, onProgress) : [];
  var map = {};
  uniq.forEach(function(t, i){ map[t] = (out[i] == null || out[i] === '') ? t : String(out[i]); });
  return map;
}

/* =====================  EXCEL  ===================== */
async function xlsx(data, translateFn, modes, onProgress){
  var zip = await JSZip.loadAsync(data);
  var wbX = await readStr(zip, 'xl/workbook.xml');
  if(!wbX) throw new Error('不是有效的 .xlsx 檔案');
  var wbRels = await relMap(zip, 'xl/workbook.xml');
  var sheets = [];
  wbX.replace(/<sheet\b[^>]*>/g, function(m){
    var rid = attr(m, 'r:id'), r = wbRels.filter(function(x){ return x.id === rid; })[0];
    if(r) sheets.push({name: unesc(attr(m, 'name') || ''), path: r.target});
    return m;
  });
  var byName = {}; sheets.forEach(function(s){ byName[s.name] = s; });
  var skipR = {}, lits = {};                       /* skipR[path] = [range]；lits = 公式裡用到的文字常數 */
  sheets.forEach(function(s){ skipR[s.path] = []; });
  function addSkip(sheetName, ref, fallbackPath){
    var sh = sheetName ? byName[sheetName] : null, p = sh ? sh.path : fallbackPath, R = rangeOf(ref);
    if(p && R && skipR[p]) skipR[p].push(R);
  }
  function scanFormula(f, curPath, names){
    var s = unesc(f);
    s.replace(/"((?:[^"]|"")*)"/g, function(m, g){
      g.replace(/""/g, '"').split(',').forEach(function(x){ x = x.trim().toLowerCase(); if(x) lits[x] = 1; });
      lits[g.replace(/""/g, '"').trim().toLowerCase()] = 1; return m;
    });
    s.replace(/(?:'((?:[^']|'')+)'|([A-Za-z0-9_一-鿿.]+))?!?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g, function(m, q, u, ref){
      if(m.indexOf('!') >= 0) addSkip((q || u || '').replace(/''/g, "'"), ref, curPath);
      return m;
    });
    var nm = /^[A-Za-z_][\w.]*$/.exec(s.trim());
    if(nm && names[nm[0]]) scanFormula(names[nm[0]], curPath, {});
  }
  var names = {};
  wbX.replace(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g, function(m, a, v){ names[attr(a, 'name')] = v; return m; });
  /* 讀各工作表 */
  var sheetXml = {};
  for(var i = 0; i < sheets.length; i++){
    var sx = await readStr(zip, sheets[i].path); sheetXml[sheets[i].path] = sx || '';
    (sx || '').replace(/<f\b[^>]*>([\s\S]*?)<\/f>/g, function(m, g){ scanFormula(g, sheets[i].path, names); return m; });
    (sx || '').replace(/<(?:x14:|xm:)?(?:formula1|formula2|f)>([\s\S]*?)<\/(?:x14:|xm:)?(?:formula1|formula2|f)>/g, function(m, g){ scanFormula(g.replace(/<[^>]+>/g, ''), sheets[i].path, names); return m; });
    (sx || '').replace(/<cfRule\b[\s\S]*?<\/cfRule>/g, function(m){ m.replace(/<formula>([\s\S]*?)<\/formula>/g, function(q, g){ scanFormula(g, sheets[i].path, names); return q; }); return m; });
    var rl = await relMap(zip, sheets[i].path);                    /* 表格標題列：不能改，否則 Excel 會要求修復 */
    for(var k = 0; k < rl.length; k++){
      if(/\/table$/.test(rl[k].type)){
        var tx = await readStr(zip, rl[k].target);
        if(tx){
          var ref = attr(tx.match(/<table\b[^>]*>/)[0], 'ref'), hr = attr(tx.match(/<table\b[^>]*>/)[0], 'headerRowCount');
          var R = rangeOf(ref);
          if(R && hr !== '0'){ R.r2 = R.r1; skipR[sheets[i].path].push(R); }
        }
      }
    }
  }
  /* 樞紐分析來源：不動 */
  var pcs = Object.keys(zip.files).filter(function(p){ return /^xl\/pivotCache\/pivotCacheDefinition\d*\.xml$/.test(p); });
  for(var q = 0; q < pcs.length; q++){
    var px = await readStr(zip, pcs[q]), ws = px && px.match(/<worksheetSource\b[^>]*>/);
    if(ws){ var rf = attr(ws[0], 'ref'); if(rf) addSkip(unesc(attr(ws[0], 'sheet') || ''), rf, null); }
  }
  /* 共用文字 */
  var ssPath = 'xl/sharedStrings.xml', ssX = await readStr(zip, ssPath) || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"></sst>';
  var siList = [];
  ssX.replace(/<si>([\s\S]*?)<\/si>|<si\/>/g, function(m, g){ siList.push(g || ''); return m; });
  function siText(inner){
    var t = '', c = inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    c.replace(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\/>/g, function(m, g){ t += g || ''; return m; });
    return unesc(t);
  }
  function firstRpr(inner){ var m = /<r>\s*(<rPr>[\s\S]*?<\/rPr>)/.exec(inner); return m ? m[1] : ''; }
  var siTxt = siList.map(siText);
  /* 找出每個儲存格用到哪個文字 */
  var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cells = [];   /* {path, ref, c, r, s, idx} */
  var inl = [];                                                         /* 內嵌文字儲存格 */
  sheets.forEach(function(sh){
    var sx2 = sheetXml[sh.path], m;
    cellRe.lastIndex = 0;
    while((m = cellRe.exec(sx2))){
      var a = m[1], t = attr(a, 't'), ref = attr(a, 'r'), sp = ref && splitRef(ref);
      if(!sp) continue;
      var skip = skipR[sh.path].some(function(R){ return inR(R, sp.c, sp.r); });
      if(t === 's'){
        var v = /<v>(\d+)<\/v>/.exec(m[2] || '');
        if(v) cells.push({path: sh.path, ref: ref, c: sp.c, r: sp.r, s: attr(a, 's'), idx: +v[1], skip: skip});
      } else if(t === 'inlineStr'){
        var tt = siText((/<is>([\s\S]*?)<\/is>/.exec(m[2] || '') || [0, ''])[1]);
        inl.push({path: sh.path, ref: ref, c: sp.c, r: sp.r, s: attr(a, 's'), text: tt, skip: skip});
      }
    }
  });
  function ok(t){ return worth(t) && !lits[t.trim().toLowerCase()]; }
  var need = [];
  cells.forEach(function(c){ c.text = siTxt[c.idx] || ''; c.ok = !c.skip && ok(c.text); if(c.ok) need.push(c.text); });
  inl.forEach(function(c){ c.ok = !c.skip && ok(c.text); if(c.ok) need.push(c.text); });
  /* 繪圖文字方塊、圖表標題、註解 */
  var xmlParts = Object.keys(zip.files).filter(function(p){ return /^xl\/(drawings\/drawing\d+|charts\/chart\d+|comments\d*)\.xml$/.test(p); });
  var partX = {};
  function aParas(x){ var o = []; x.replace(/<a:p\b[^>]*>(?:(?!<a:p[\s>])[\s\S])*?<\/a:p>/g, function(m, off){ o.push({m: m, off: off}); return m; }); return o; }
  function aText(p){ var t = '', f = false; p.replace(/<a:t>([\s\S]*?)<\/a:t>|<a:t\/>/g, function(m, g){ t += unesc(g || ''); return m; }); return t; }
  for(var pi = 0; pi < xmlParts.length; pi++){
    var xx = await readStr(zip, xmlParts[pi]); partX[xmlParts[pi]] = xx;
    if(/comments/.test(xmlParts[pi])){
      xx.replace(/<text>([\s\S]*?)<\/text>/g, function(m, g){ var tt = siText(g); if(ok(tt)) need.push(tt); return m; });
    } else aParas(xx).forEach(function(p){ var tt = aText(p.m); if(ok(tt)) need.push(tt); });
  }
  var map = await runTranslate(need, translateFn, onProgress);
  /* 輸出 */
  var results = {}, stats = {cells: need.length, skippedHeaders: cells.filter(function(c){ return c.skip && worth(c.text); }).length};
  var stylesX = await readStr(zip, 'xl/styles.xml');
  for(var mi = 0; mi < modes.length; mi++){
    var mode = modes[mi], z = await JSZip.loadAsync(data);
    var newSi = [], siIdx = {};
    function addSi(orig, tr, origIdx){
      var key = mode + '|' + origIdx + '|' + tr;
      if(key in siIdx) return siIdx[key];
      var inner = origIdx >= 0 ? siList[origIdx] : '', rpr = firstRpr(inner), body;
      if(mode === 'trans') body = '<si>' + (rpr ? '<r>' + rpr + '<t xml:space="preserve">' + esc(tr) + '</t></r>' : '<t xml:space="preserve">' + esc(tr) + '</t>') + '</si>';
      else {
        var cleaned = inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<phoneticPr\b[^>]*\/>/g, '');
        var runs = /<r>/.test(cleaned) ? cleaned : '<r><t xml:space="preserve">' + esc(orig) + '</t></r>';
        body = '<si>' + runs + '<r>' + rpr + '<t xml:space="preserve">\n' + esc(tr) + '</t></r></si>';
      }
      newSi.push(body); siIdx[key] = siList.length + newSi.length - 1; return siIdx[key];
    }
    /* 夾雜版：需要自動換行的樣式 */
    var xfs = [], xfBlock = null, newXfs = [], xfMap = {};
    if(mode === 'both' && stylesX){
      var cb = /<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/.exec(stylesX);
      if(cb){ xfBlock = cb; cb[2].replace(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g, function(m){ xfs.push(m); return m; }); }
    }
    function wrapStyle(s){
      s = s == null ? 0 : +s;
      if(!xfBlock) return s;
      if(s in xfMap) return xfMap[s];
      var xf = xfs[s] || xfs[0] || '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', nx;
      var open = /^<xf\b[^>]*?(\/?)>/.exec(xf), head = open[0], self = open[1] === '/', rest = self ? '' : xf.slice(head.length, xf.length - 5);
      if(!/applyAlignment=/.test(head)) head = head.replace(/^<xf\b/, '<xf applyAlignment="1"'); else head = head.replace(/applyAlignment="0"/, 'applyAlignment="1"');
      if(self) head = head.replace(/\/>$/, '>');
      var al = /<alignment\b[^>]*?\/>/.exec(rest);
      if(al){
        var a2 = al[0]; if(!/wrapText=/.test(a2)) a2 = a2.replace('<alignment', '<alignment wrapText="1"'); else a2 = a2.replace(/wrapText="0"/, 'wrapText="1"');
        if(!/vertical=/.test(a2)) a2 = a2.replace('<alignment', '<alignment vertical="top"');
        rest = rest.replace(al[0], a2);
      } else rest = '<alignment vertical="top" wrapText="1"/>' + rest;
      nx = head + rest + '</xf>';
      newXfs.push(nx); xfMap[s] = xfs.length + newXfs.length - 1; return xfMap[s];
    }
    var rowNeed = {};                                   /* path → {row: 高度(pt)} */
    function noteRow(sh, c, r, text, merges, cols, defW){
      var w = 0, mg = merges.filter(function(R){ return R.c1 === c && R.r1 === r; })[0], c2 = mg ? mg.c2 : c;
      if(mg && mg.r2 > mg.r1) return;
      for(var k2 = c; k2 <= c2; k2++) w += cols[k2] || defW;
      w = Math.max(w - 1, 4);
      var lines = 0;
      langLines(text).forEach(function(ln){
        var u = 0; for(var x2 = 0; x2 < ln.length; x2++) u += ln.charCodeAt(x2) > 0x2E7F ? 2 : 1.05;
        lines += Math.max(1, Math.ceil(u / w));
      });
      var h = Math.min(409, lines * 15 + 3);
      var o = rowNeed[sh.path] || (rowNeed[sh.path] = {}); if(!o[r] || o[r] < h) o[r] = h;
    }
    var sheetOut = {};
    sheets.forEach(function(sh){
      var sx3 = sheetXml[sh.path];
      var merges = [], cols = {}, defW = 8.43;
      sx3.replace(/<mergeCell\b[^>]*>/g, function(m){ var R = rangeOf(attr(m, 'ref') || ''); if(R) merges.push(R); return m; });
      var dw = /<sheetFormatPr\b[^>]*>/.exec(sx3); if(dw){ var dcw = attr(dw[0], 'defaultColWidth'); if(dcw) defW = +dcw; }
      sx3.replace(/<col\b[^>]*>/g, function(m){ var mn = +attr(m, 'min'), mx = +attr(m, 'max'), w = +attr(m, 'width'); for(var k3 = mn; k3 <= Math.min(mx, mn + 400); k3++) cols[k3] = w; return m; });
      sheetOut[sh.path] = {x: sx3, merges: merges, cols: cols, defW: defW};
    });
    var edits = {};                                      /* path → [{from,to}] 以 cellRe 重掃替換 */
    sheets.forEach(function(sh){
      var o = sheetOut[sh.path], x4 = o.x;
      x4 = x4.replace(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g, function(m, a, tail, body){
        var t = attr(a, 't'), ref = attr(a, 'r'), sp = ref && splitRef(ref);
        if(!sp || (t !== 's' && t !== 'inlineStr')) return m;
        var skip = skipR[sh.path].some(function(R){ return inR(R, sp.c, sp.r); });
        if(skip) return m;
        if(t === 's'){
          var v = /<v>(\d+)<\/v>/.exec(body || ''); if(!v) return m;
          var oi = +v[1], tx = siTxt[oi] || '';
          if(!ok(tx) || !(tx in map) || same(tx, map[tx])) return m;
          var tr = map[tx], ni = addSi(tx, tr, oi), na = a;
          if(mode === 'both'){
            var ns = wrapStyle(attr(a, 's'));
            na = /\bs="/.test(a) ? a.replace(/\bs="\d*"/, 's="' + ns + '"') : a + ' s="' + ns + '"';
            noteRow(sh, sp.c, sp.r, tx + '\n' + tr, o.merges, o.cols, o.defW);
          }
          return '<c' + na + '>' + body.replace(/<v>\d+<\/v>/, '<v>' + ni + '</v>') + '</c>';
        }
        var isb = /<is>([\s\S]*?)<\/is>/.exec(body || ''); if(!isb) return m;
        var t2 = siText(isb[1]); if(!ok(t2) || !(t2 in map) || same(t2, map[t2])) return m;
        var tr2 = map[t2], na2 = a;
        var txt = mode === 'both' ? t2 + '\n' + tr2 : tr2;
        if(mode === 'both'){
          var ns2 = wrapStyle(attr(a, 's'));
          na2 = /\bs="/.test(a) ? a.replace(/\bs="\d*"/, 's="' + ns2 + '"') : a + ' s="' + ns2 + '"';
          noteRow(sh, sp.c, sp.r, txt, o.merges, o.cols, o.defW);
        }
        return '<c' + na2 + '><is><t xml:space="preserve">' + esc(txt) + '</t></is></c>';
      });
      /* 列高 */
      var rn = rowNeed[sh.path];
      if(rn) x4 = x4.replace(/<row\b([^>]*)>/g, function(m, a){
        var r = +attr(a, 'r'); if(!rn[r]) return m;
        var ht = attr(a, 'ht'), cur = ht ? +ht : 15; if(rn[r] <= cur + 0.5) return m;
        var a2 = ht ? a.replace(/\bht="[^"]*"/, 'ht="' + rn[r].toFixed(1) + '"') : a + ' ht="' + rn[r].toFixed(1) + '"';
        a2 = /customHeight=/.test(a2) ? a2.replace(/customHeight="\d"/, 'customHeight="1"') : a2 + ' customHeight="1"';
        return '<row' + a2 + '>';
      });
      z.file(sh.path, x4, {createFolders: false});
    });
    /* 文字方塊／圖表／註解 */
    xmlParts.forEach(function(pp){
      var x5 = partX[pp];
      if(/comments/.test(pp)){
        x5 = x5.replace(/<text>([\s\S]*?)<\/text>/g, function(m, g){
          var tt = siText(g); if(!ok(tt) || !(tt in map) || same(tt, map[tt])) return m;
          return '<text><r><t xml:space="preserve">' + esc(mode === 'both' ? tt + '\n' + map[tt] : map[tt]) + '</t></r></text>';
        });
      } else {
        x5 = x5.replace(/<a:p\b[^>]*>(?:(?!<a:p[\s>])[\s\S])*?<\/a:p>/g, function(m){
          var tt = aText(m); if(!ok(tt) || !(tt in map) || same(tt, map[tt])) return m;
          var tr3 = map[tt], done = false;
          var rep = m.replace(/<a:r>([\s\S]*?)<\/a:r>/g, function(rm, rin){
            if(done) return '';
            done = true; return rm.replace(/<a:t>[\s\S]*?<\/a:t>|<a:t\/>/, '<a:t>' + esc(tr3) + '</a:t>');
          });
          if(mode === 'both') return m + rep;
          return rep;
        });
      }
      z.file(pp, x5, {createFolders: false});
    });
    /* 寫回共用文字與樣式 */
    var total = siList.length + newSi.length;
    var sst = ssX.replace(/<\/sst>\s*$/, newSi.join('') + '</sst>').replace(/<sst\b([^>]*)>/, function(m, a){
      a = a.replace(/\buniqueCount="\d+"/, 'uniqueCount="' + total + '"');
      if(!/uniqueCount=/.test(a)) a += ' uniqueCount="' + total + '"';
      return '<sst' + a + '>';
    });
    z.file(ssPath, sst, {createFolders: false});
    if(mode === 'both' && xfBlock && newXfs.length){
      var cnt = xfs.length + newXfs.length;
      var st2 = stylesX.replace(xfBlock[0], '<cellXfs' + xfBlock[1].replace(/count="\d+"/, 'count="' + cnt + '"') + '>' + xfBlock[2] + newXfs.join('') + '</cellXfs>');
      z.file('xl/styles.xml', st2, {createFolders: false});
    }
    /* 計算鏈與快取不影響；移除 calcChain 以外不動 */
    results[mode] = await z.generateAsync({type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  return {files: results, stats: stats, count: need.length};
}

/* =====================  WORD  ===================== */
var COLOR_AFTER = ['spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
function colorRpr(rpr, color){
  rpr = (rpr || '').replace(/<w:color\b[^>]*\/>/g, '');
  var tag = '<w:color w:val="' + color + '"/>';
  if(!rpr) return '<w:rPr>' + tag + '</w:rPr>';
  var best = -1;
  COLOR_AFTER.forEach(function(n){ var i = rpr.indexOf('<w:' + n); if(i >= 0 && (best < 0 || i < best)) best = i; });
  if(best >= 0) return rpr.slice(0, best) + tag + rpr.slice(best);
  return rpr.replace('</w:rPr>', tag + '</w:rPr>');
}
function wtext(inner){
  var out = '';
  inner.replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:t\/>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>/g, function(m, g){
    if(m.indexOf('<w:tab') === 0) out += '\t';
    else if(m.indexOf('<w:br') === 0){ if(!/w:type="(page|column)"/.test(m)) out += '\n'; }
    else if(m.indexOf('<w:cr') === 0) out += '\n';
    else out += unesc(g || '');
    return m;
  });
  return out;
}
function wxml(text){
  return text.split('\n').map(function(line){
    return line.split('\t').map(function(seg){ return seg ? '<w:t xml:space="preserve">' + esc(seg) + '</w:t>' : ''; }).join('<w:tab/>');
  }).join('<w:br/>');
}
var PARA = /<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g;
var RUN = /<w:r(?:\s[^>]*)?>(?:(?!<w:r[\s>])[\s\S])*?<\/w:r>/g;
function paraInfo(p){
  if(/<w:(fldChar|instrText|fldSimple)\b/.test(p)) return null;
  var text = '';
  p.replace(RUN, function(r){ text += wtext(r); return r; });
  return worth(text) ? text : null;
}
async function docx(data, translateFn, modes, onProgress){
  var zip = await JSZip.loadAsync(data);
  if(!zip.file('word/document.xml')) throw new Error('不是有效的 .docx 檔案');
  var parts = Object.keys(zip.files).filter(function(p){ return /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(p); });
  var xs = {}, need = [];
  for(var i = 0; i < parts.length; i++){
    xs[parts[i]] = await readStr(zip, parts[i]);
    xs[parts[i]].replace(PARA, function(p){ var t = paraInfo(p); if(t) need.push(t); return p; });
  }
  var map = await runTranslate(need, translateFn, onProgress);
  var results = {};
  for(var mi = 0; mi < modes.length; mi++){
    var mode = modes[mi], z = await JSZip.loadAsync(data);
    parts.forEach(function(pp){
      var out = xs[pp].replace(PARA, function(p){
        var t = paraInfo(p); if(!t || !(t in map) || same(t, map[t])) return p;
        var tr = map[t];
        var firstRpr = '', first = true;
        p.replace(RUN, function(r){ if(first && /<w:t\b/.test(r)){ var m = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r); firstRpr = m ? m[0] : ''; first = false; } return r; });
        if(mode === 'both'){
          var ppr = (/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p) || [''])[0];
          var hadNum = /<w:numPr>/.test(ppr);
          ppr = ppr.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/g, '').replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, '').replace(/<w:pageBreakBefore\b[^>]*\/>/g, '').replace(/<w:rPr>[\s\S]*?<\/w:rPr>\s*(?=<\/w:pPr>)/, '');
          if(hadNum || /<w:pStyle\b[^>]*w:val="[^"]*(List|清單|編號|項目)/i.test(ppr)){
            var np = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>', pos = -1;
            ['pStyle', 'keepNext', 'keepLines', 'framePr', 'widowControl'].forEach(function(n){
              var mm = new RegExp('<w:' + n + '\\b[^>]*?(?:/>|>[\\s\\S]*?</w:' + n + '>)').exec(ppr);
              if(mm) pos = Math.max(pos, mm.index + mm[0].length);
            });
            if(!ppr) ppr = '<w:pPr>' + np + '</w:pPr>';
            else if(pos >= 0) ppr = ppr.slice(0, pos) + np + ppr.slice(pos);
            else ppr = ppr.replace('<w:pPr>', '<w:pPr>' + np);
          }
          if(ppr === '<w:pPr></w:pPr>') ppr = '';
          var pOpen = /^<w:p(?:\s[^>]*)?>/.exec(p)[0].replace(/\sw:rsid\w*="[^"]*"/g, '');
          return p + pOpen + ppr + '<w:r>' + colorRpr(firstRpr, '1F4E79') + wxml(tr) + '</w:r></w:p>';
        }
        var done = false;
        return p.replace(RUN, function(r){
          if(!/<w:(t|tab|br|cr)\b/.test(r)) return r;
          var keep = /<w:(drawing|pict|object|footnoteReference|endnoteReference|commentReference|sym)\b/.test(r);
          if(done || !/<w:t\b/.test(r)){
            if(keep) return r.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:t\/>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>/g, '');
            return done || /<w:t\b/.test(r) ? '' : r;
          }
          done = true;
          var rpr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r) || [''])[0], open = /^<w:r(?:\s[^>]*)?>/.exec(r)[0];
          var extra = (r.match(/<w:(?:drawing|pict|object)\b[\s\S]*?<\/w:(?:drawing|pict|object)>/g) || []).join('');
          return open + rpr + extra + wxml(tr) + '</w:r>';
        });
      });
      z.file(pp, out, {createFolders: false});
    });
    results[mode] = await z.generateAsync({type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  }
  return {files: results, count: need.length};
}

/* =====================  PDF → Word（可編輯重建版）  ===================== */
function buildDocxFromParas(pages, pageSize, mode, tr){
  /* pages: [{paras:[{text,size,bold}]}]；tr: 對照表 */
  var body = '';
  pages.forEach(function(pg, pi){
    pg.paras.forEach(function(p, k){
      var txt = tr[p.text] || p.text, sz = Math.max(16, Math.min(72, Math.round(p.size * 2)));
      var brk = (pi > 0 && k === 0) ? '<w:pageBreakBefore/>' : '';
      var rpr = function(color){ return '<w:rPr>' + (p.bold ? '<w:b/>' : '') + (color ? '<w:color w:val="' + color + '"/>' : '') + '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>'; };
      if(mode === 'both' && tr[p.text] && worth(p.text)){
        body += '<w:p><w:pPr>' + brk + '<w:spacing w:after="0"/></w:pPr><w:r>' + rpr('') + wxml(p.text) + '</w:r></w:p>';
        body += '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r>' + rpr('1F4E79') + wxml(tr[p.text]) + '</w:r></w:p>';
      } else {
        body += '<w:p><w:pPr>' + brk + '<w:spacing w:after="120"/></w:pPr><w:r>' + rpr('') + wxml(mode === 'both' ? p.text : txt) + '</w:r></w:p>';
      }
    });
    if(!pg.paras.length) body += '<w:p>' + (pi > 0 ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : '') + '</w:p>';
  });
  var W = Math.round(pageSize.w * 20), H = Math.round(pageSize.h * 20);
  var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
    '<w:sectPr><w:pgSz w:w="' + W + '" w:h="' + H + '"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>';
  var z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', {createFolders: false});
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', {createFolders: false});
  z.file('word/document.xml', doc, {createFolders: false});
  return z.generateAsync({type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
/* 把 pdf.js 的文字片段組成「行」再組成「段落」 */
function groupPdfItems(items){
  /* items: {str,x,y,size,w,bold}；y 為由上而下。先組成「行」，行內相隔很遠的欄位切成獨立片段，再依對齊與行距組成段落 */
  var lines = [];
  items.slice().sort(function(a, b){ return a.y - b.y || a.x - b.x; }).forEach(function(it){
    var L = lines[lines.length - 1];
    if(L && Math.abs(L.y - it.y) <= Math.max(2, it.size * 0.45)){ L.items.push(it); L.size = Math.max(L.size, it.size); }
    else lines.push({y: it.y, size: it.size, items: [it]});
  });
  var segs = [];
  lines.forEach(function(L){
    L.items.sort(function(a, b){ return a.x - b.x; });
    var cur = null, prev = null;
    L.items.forEach(function(it){
      var gap = prev ? it.x - (prev.x + prev.w) : 0;
      if(!cur || gap > Math.max(it.size, prev.size) * 2.2){ cur = {y: L.y, size: it.size, x: it.x, s: '', items: [], bold: 0}; segs.push(cur); }
      else if(gap > it.size * 0.15 || (/[A-Za-z0-9]$/.test(cur.s) && /^[A-Za-z0-9]/.test(it.str) && gap > 0.5)) cur.s += ' ';
      cur.s += it.str; cur.items.push(it); if(it.bold) cur.bold++; cur.size = Math.max(cur.size, it.size);
      prev = it;
    });
  });
  segs.forEach(function(g){ g.text = g.s.replace(/\s+/g, ' ').trim(); g.isBold = g.bold > g.items.length / 2; });
  var paras = [], cur2 = null, BUL = /^([•●▪◦·\-\*–—]|\(?\d{1,3}[.)]|\(?[A-Za-z][.)])\s/;
  segs.forEach(function(g){
    if(!g.text) return;
    var cont = cur2 && Math.abs(g.size - cur2.size) < 1.5 && (g.y - cur2.lastY) < g.size * 1.45 && (g.y - cur2.lastY) > 0 && Math.abs(g.x - cur2.lastX) < g.size * 1.5 && !BUL.test(g.text);
    if(cont){
      cur2.text += (/[\u3400-\u9FFF]$/.test(cur2.text) ? '' : ' ') + g.text; cur2.lastY = g.y; cur2.lastX = g.x;
    } else { cur2 = {text: g.text, size: g.size, bold: g.isBold, x: g.x, lastY: g.y, lastX: g.x}; paras.push(cur2); }
  });
  return paras;
}
return {xlsx: xlsx, docx: docx, buildDocxFromParas: buildDocxFromParas, groupPdfItems: groupPdfItems, worth: worth};
})();
if(typeof module !== 'undefined' && module.exports) module.exports = XMLF;
