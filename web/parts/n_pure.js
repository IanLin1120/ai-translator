/* ============================================================
   PURE HELPERS (no DOM) — sentence splitting, txt builders,
   JSON parsing, filename cleanup, .eml parsing / writing
   ============================================================ */
/*PURE-START*/
var ABBR_RE = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|No|Fig|Inc|Ltd|Co|Corp|approx|est)\.$/i;

/* Split one line of text into sentences (CJK and Latin punctuation aware). */
function splitSentences(line){
  var s = String(line == null ? '' : line).trim();
  if(!s) return [];
  var out = [], buf = '', i = 0, ch = Array.from(s);
  var CJK_END = /[。！？‼⁇⁈]/, LAT_END = /[.!?…]/;
  var TAIL = /[。！？….!?"'”’）)\]」』】》]/;
  while(i < ch.length){
    var c = ch[i]; buf += c; i++;
    var cjk = CJK_END.test(c), lat = LAT_END.test(c);
    if(!cjk && !lat) continue;
    while(i < ch.length && TAIL.test(ch[i])){ buf += ch[i]; i++; }
    if(!cjk){
      /* Latin terminator: split only before whitespace / end of line,
         and not after abbreviations, decimals or list numbers like "1." */
      if(i < ch.length && !/\s/.test(ch[i])) continue;
      var t = buf.trim();
      if(ABBR_RE.test(t) || /^\(?(?:\d{1,3}|[A-Za-z])[.)]$/.test(t)) continue;
    }
    out.push(buf.trim()); buf = '';
    while(i < ch.length && /\s/.test(ch[i])) i++;
  }
  if(buf.trim()) out.push(buf.trim());
  return out;
}

/* Text -> [{orig, sents}] per line (blank lines kept with sents = []). */
function segmentText(text){
  return String(text == null ? '' : text).split(/\r\n|\r|\n/).map(function(l){
    return {orig: l, sents: splitSentences(l)};
  });
}

/* Join translated sentences of one line (no space for Chinese / Japanese). */
function joinSents(arr, tgt){
  var nospace = /^(zh|ja)/i.test(tgt || '');
  return arr.join(nospace ? '' : ' ');
}

/* Strings that are only digits / punctuation are passed through untouched. */
function needsTranslate(t){ return !!(t && /[^\s\d.,%\-+:\/()]/.test(t)); }

/* lines: [{orig, pairs:[{o,t}], keep?}]
   mode: 'trans' | 'both' | 'orig'
   o: {layout:'stack'|'inline', blank:boolean, prefix:string} */
function buildTxt(lines, mode, o, tgt){
  o = o || {};
  var out = [];
  function pairLines(p){
    var tt = (o.prefix || '') + p.t;
    return o.layout === 'inline' ? [p.o + '  ｜  ' + tt] : [p.o, tt];
  }
  lines.forEach(function(L){
    if(L.keep){ out.push(L.orig); return; }
    var pairs = L.pairs || [];
    if(mode === 'orig'){ out.push(L.orig); return; }
    if(mode === 'trans'){
      out.push(pairs.length ? joinSents(pairs.map(function(p){ return p.t; }), tgt) : '');
      return;
    }
    if(!pairs.length){ if(!o.blank) out.push(''); return; }
    pairs.forEach(function(p){
      pairLines(p).forEach(function(x){ out.push(x); });
      if(o.blank) out.push('');
    });
  });
  while(out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/* Tolerant JSON reader for AI replies (fenced / surrounded by prose). */
function parseJsonLoose(text){
  var t = String(text == null ? '' : text).trim();
  try{ return JSON.parse(t); }catch(e){}
  var f = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(f){ try{ return JSON.parse(f[1].trim()); }catch(e){} }
  var a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
  if(a >= 0 && b > a){ try{ return JSON.parse(t.slice(a, b + 1)); }catch(e){} }
  throw new Error('AI 回傳的內容不是有效的 JSON');
}

/* One OCR block {original, translated} -> line with per-sentence pairs when
   both sides split into the same number of sentences. */
function expandBlock(r){
  var o = String(r && r.original != null ? r.original : '').trim();
  var t = String(r && r.translated != null ? r.translated : '').trim();
  if(!o && !t) return null;
  var so = splitSentences(o), st = splitSentences(t);
  var pairs = (so.length > 1 && so.length === st.length)
    ? so.map(function(s, i){ return {o: s, t: st[i]}; })
    : [{o: o, t: t}];
  return {orig: o, pairs: pairs};
}
function linesFromBlocks(arr){
  return (Array.isArray(arr) ? arr : []).map(expandBlock).filter(Boolean);
}

/* Clean a user-typed file name and make sure it ends with ext. */
function safeFileName(name, ext){
  var s = String(name || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if(ext && s.toLowerCase().slice(-ext.length) === ext.toLowerCase()){
    s = s.slice(0, -ext.length).replace(/[. ]+$/, '');
  }
  if(!s) s = '翻譯結果';
  if(/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = '_' + s;
  return s + (ext || '');
}

/* ---------- e-mail (.eml) ---------- */
function b64ToBytes(s){
  var bin = atob(String(s).replace(/[^A-Za-z0-9+\/=]/g, ''));
  var u = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function bytesToB64(u){
  var s = '';
  for(var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function qpToBytes(s, isHeader){
  s = String(s);
  s = isHeader ? s.replace(/_/g, ' ') : s.replace(/=\r?\n/g, '');
  var out = [], enc = new TextEncoder();
  for(var i = 0; i < s.length; i++){
    var c = s.charAt(i);
    if(c === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))){
      out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2;
    } else {
      var cp = s.codePointAt(i);
      if(cp < 128) out.push(cp);
      else {
        var b = enc.encode(String.fromCodePoint(cp));
        for(var k = 0; k < b.length; k++) out.push(b[k]);
        if(cp > 0xffff) i++;
      }
    }
  }
  return new Uint8Array(out);
}
function decodeBytes(bytes, charset){
  try{ return new TextDecoder(String(charset || 'utf-8').toLowerCase()).decode(bytes); }
  catch(e){ return new TextDecoder('utf-8').decode(bytes); }
}
function decodeMimeWords(s){
  s = String(s || '').replace(/(\?=)\s+(=\?)/g, '$1$2');
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, function(_, cs, enc, txt){
    try{ return decodeBytes(/b/i.test(enc) ? b64ToBytes(txt) : qpToBytes(txt, true), cs); }
    catch(e){ return txt; }
  });
}
function parseHeaders(block){
  var h = {};
  String(block || '').replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(function(line){
    var m = line.match(/^([A-Za-z][A-Za-z0-9\-]*):\s*(.*)$/);
    if(m){ var k = m[1].toLowerCase(); if(!(k in h)) h[k] = m[2]; }
  });
  return h;
}
function splitHeaderBody(raw){
  var m = String(raw).match(/\r?\n\r?\n/);
  if(!m) return [String(raw), ''];
  return [raw.slice(0, m.index), raw.slice(m.index + m[0].length)];
}
function decodeBody(body, h){
  var cte = String(h['content-transfer-encoding'] || '').toLowerCase().trim();
  var cs = ((h['content-type'] || '').match(/charset="?([^";\s]+)/i) || [])[1] || 'utf-8';
  var bytes;
  if(cte === 'base64') bytes = b64ToBytes(body);
  else if(cte === 'quoted-printable') bytes = qpToBytes(body, false);
  else bytes = new TextEncoder().encode(body);
  return decodeBytes(bytes, cs);
}
function htmlToText(h){
  return String(h || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function walkMime(raw){
  var hb = splitHeaderBody(raw), h = parseHeaders(hb[0]), body = hb[1];
  var ct = h['content-type'] || 'text/plain';
  var res = {plain: '', html: ''};
  if(/^multipart\//i.test(ct)){
    var bm = ct.match(/boundary="?([^";\s]+)"?/i);
    if(!bm) return res;
    body.split('--' + bm[1]).forEach(function(p){
      if(!p.trim() || /^--/.test(p)) return;
      var r = walkMime(p.replace(/^\r?\n/, ''));
      if(!res.plain && r.plain) res.plain = r.plain;
      if(!res.html && r.html) res.html = r.html;
    });
    return res;
  }
  if(/attachment/i.test(h['content-disposition'] || '')) return res;
  if(/^text\/plain/i.test(ct)) res.plain = decodeBody(body, h);
  else if(/^text\/html/i.test(ct)) res.html = decodeBody(body, h);
  return res;
}
function parseEmlFull(raw){
  raw = String(raw);
  var h = parseHeaders(splitHeaderBody(raw)[0]);
  var m = walkMime(raw);
  var text = m.plain || htmlToText(m.html) || '';
  function dh(k){ return decodeMimeWords(h[k] || ''); }
  return {
    headers: {from: dh('from'), to: dh('to'), cc: dh('cc'), date: h['date'] || '', subject: dh('subject')},
    text: text.replace(/\r\n?/g, '\n')
  };
}
function encodeHeaderValue(s){
  s = String(s || '');
  if(/^[\x20-\x7e]*$/.test(s)) return s;
  var enc = new TextEncoder(), words = [], cur = [];
  Array.from(s).forEach(function(c){
    var b = enc.encode(c);
    if(cur.length + b.length > 45){ words.push(cur); cur = []; }
    for(var i = 0; i < b.length; i++) cur.push(b[i]);
  });
  if(cur.length) words.push(cur);
  return words.map(function(w){ return '=?UTF-8?B?' + bytesToB64(new Uint8Array(w)) + '?='; }).join('\r\n ');
}
function buildEml(h, subjectT, bodyText){
  var L = [];
  if(h.from) L.push('From: ' + h.from);
  if(h.to) L.push('To: ' + h.to);
  if(h.cc) L.push('Cc: ' + h.cc);
  if(h.date) L.push('Date: ' + h.date);
  L.push('Subject: ' + encodeHeaderValue(subjectT));
  L.push('MIME-Version: 1.0');
  L.push('Content-Type: text/plain; charset=UTF-8');
  L.push('Content-Transfer-Encoding: 8bit');
  return L.join('\r\n') + '\r\n\r\n' + String(bodyText).replace(/\r?\n/g, '\r\n');
}
/* Outlook .msg is a binary OLE file: pull out the readable UTF-16 text runs. */
function msgBestEffort(buf){
  var txt = new TextDecoder('utf-16le').decode(buf);
  var runs = txt.match(/[\t\n\r -~ -퟿]{6,}/g) || [];
  return runs
    .filter(function(r){ return !/__substg1\.0_|Root Entry|__properties_|__recip_|__attach_|__nameid_/i.test(r); })
    .map(function(r){ return r.trim(); }).filter(Boolean).join('\n');
}
/*PURE-END*/
