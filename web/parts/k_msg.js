/* ============================================================
   MSG → EML：解析 Outlook .msg（OLE 複合檔）→ 標準 .eml（主旨／寄件者／收件者／副本／日期／
   純文字與 HTML 內文／附件／內嵌圖片）。全部在本機瀏覽器內完成。
   ============================================================ */
/*MSG-START*/
var MSGX = (function(){
var CP = {950: 'big5', 936: 'gbk', 932: 'shift_jis', 949: 'euc-kr', 1252: 'windows-1252', 1251: 'windows-1251', 1250: 'windows-1250', 65001: 'utf-8', 28591: 'iso-8859-1', 20127: 'ascii'};
function td(bytes, cp, fatal){ try{ return new TextDecoder(CP[cp] || 'windows-1252', {fatal: !!fatal}).decode(bytes); }catch(e){ return new TextDecoder('windows-1252').decode(bytes); } }
function stripNul(s){ return s.replace(/\u0000+$/, ''); }
function hex4(n){ return ('0000' + n.toString(16).toUpperCase()).slice(-4); }
function Msg(buf){
  var cfb = XLSX.CFB.read(new Uint8Array(buf), {type: 'array'}), S = {};
  cfb.FullPaths.forEach(function(p, i){
    var e = cfb.FileIndex[i]; if(!e || e.type !== 2) return;
    S[p.replace(/^Root Entry\//, '')] = new Uint8Array(e.content || []);
  });
  this.S = S; this.cp = 1252;
  var top = this.props(''); if(top[0x3FFD] != null) this.cp = top[0x3FFD];
}
Msg.prototype.props = function(prefix){
  var b = this.S[prefix + '__properties_version1.0'], o = {};
  if(!b) return o;
  var start = prefix ? 8 : 32, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for(var p = start; p + 16 <= b.length; p += 16){
    var type = dv.getUint16(p, true), id = dv.getUint16(p + 2, true);
    if(type === 3) o[id] = dv.getInt32(p + 8, true);
    else if(type === 0x40) o[id] = (dv.getUint32(p + 8, true) + dv.getUint32(p + 12, true) * 4294967296) / 1e4 - 11644473600000;
    else if(type === 0xB) o[id] = dv.getUint16(p + 8, true) !== 0;
  }
  return o;
};
Msg.prototype.bin = function(prefix, id){
  var k = prefix + '__substg1.0_' + hex4(id);
  return this.S[k + '0102'] || null;
};
Msg.prototype.str = function(prefix, id){
  var k = prefix + '__substg1.0_' + hex4(id), b;
  if((b = this.S[k + '001F'])) return stripNul(new TextDecoder('utf-16le').decode(b));
  if((b = this.S[k + '001E'])) return stripNul(td(b, this.cp));
  return '';
};
Msg.prototype.prefixes = function(kind){
  var re = new RegExp('^(__' + kind + '_version1\\.0_#[0-9A-Fa-f]{8}/)'), seen = {};
  Object.keys(this.S).forEach(function(p){ var m = re.exec(p); if(m) seen[m[1]] = 1; });
  return Object.keys(seen).sort();
};
/* LZFu（壓縮 RTF）解壓 —— 只在沒有純文字／HTML 時當最後手段 */
function rtfDecompress(b){
  if(!b || b.length < 16) return '';
  var dv = new DataView(b.buffer, b.byteOffset, b.byteLength), comp = dv.getUint32(4, true), raw = dv.getUint32(8, true), sig = dv.getUint32(12, true);
  if(sig === 0x414c454d) return td(b.subarray(16, 16 + raw), 1252);
  if(sig !== 0x75465a4c) return '';
  var dict = new Uint8Array(4096), init = '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx';
  for(var i = 0; i < init.length; i++) dict[i] = init.charCodeAt(i);
  var w = init.length, out = [], p = 16, end = Math.min(b.length, comp + 4);
  while(p < end && out.length < raw){
    var ctl = b[p++];
    for(var bit = 0; bit < 8 && p < end; bit++, ctl >>= 1){
      if(ctl & 1){
        var r = (b[p] << 8) | b[p + 1]; p += 2; var off = r >> 4, len = (r & 15) + 2;
        if(off === (w & 4095)) return td(Uint8Array.from(out), 1252);
        for(var k = 0; k < len; k++){ var c = dict[(off + k) & 4095]; out.push(c); dict[w & 4095] = c; w++; }
      }else{ var c2 = b[p++]; out.push(c2); dict[w & 4095] = c2; w++; }
    }
  }
  return td(Uint8Array.from(out), 1252);
}
function rtfToText(r){
  return r.replace(/\{\\\*[^{}]*\}/g, '').replace(/\\par[d]?/g, '\n').replace(/\\tab/g, '\t').replace(/\\'([0-9a-f]{2})/gi, function(_, h){ return String.fromCharCode(parseInt(h, 16)); })
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
function parse(buf){
  var m = new Msg(buf), top = m.props(''), out = {};
  out.subject = m.str('', 0x37) || '';
  out.from = {name: m.str('', 0xC1A), email: m.str('', 0x5D01) || m.str('', 0xC1F)};
  if(out.from.email && !/@/.test(out.from.email)) out.from.email = '';
  var rec = {1: [], 2: [], 3: []};
  m.prefixes('recip').forEach(function(px){
    var p = m.props(px), email = m.str(px, 0x39FE) || m.str(px, 0x3003);
    if(email && !/@/.test(email)) email = '';
    var name = m.str(px, 0x3001) || m.str(px, 0x3001);
    (rec[p[0xC15]] || rec[1]).push({name: name, email: email});
  });
  out.to = rec[1]; out.cc = rec[2]; out.bcc = rec[3];
  out.toDisplay = m.str('', 0xE04); out.ccDisplay = m.str('', 0xE03);
  out.date = top[0x39] ? new Date(top[0x39]) : (top[0xE06] ? new Date(top[0xE06]) : null);
  if(out.date && isNaN(out.date)) out.date = null;
  out.headersRaw = m.str('', 0x7D);
  var mid = /^Message-ID:\s*(.+)$/mi.exec(out.headersRaw); out.messageId = mid ? mid[1].trim() : '';
  out.text = m.str('', 0x1000);
  var hb = m.bin('', 0x1013); out.html = '';
  if(hb){
    var ic = top[0x3FDE] || top[0x3FFD] || 65001;
    try{ out.html = td(hb, 65001, true); }catch(e){ out.html = td(hb, ic); }
  }else out.html = m.str('', 0x1013);
  if(!out.text && !out.html){ var rb = m.bin('', 0x1009); if(rb) out.text = rtfToText(rtfDecompress(rb)); }
  out.atts = [];
  m.prefixes('attach').forEach(function(px){
    var p = m.props(px), data = m.bin(px, 0x3701);
    if(!data){ if(p[0x3705] === 5) out.atts.push({name: (m.str(px, 0x3707) || m.str(px, 0x3704) || 'embedded') + '.msg', mime: 'application/vnd.ms-outlook', data: null, note: '內嵌的郵件附件（.msg）無法轉換，已略過'}); return; }
    var name = m.str(px, 0x3707) || m.str(px, 0x3704) || m.str(px, 0x3001) || 'attachment';
    out.atts.push({name: name, mime: m.str(px, 0x370E) || guessMime(name), cid: m.str(px, 0x3712), data: data, hidden: !!(p[0x7FFE])});
  });
  return out;
}
function guessMime(n){
  var e = (/\.([a-z0-9]+)$/i.exec(n) || [])[1]; e = (e || '').toLowerCase();
  return ({pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain', csv: 'text/csv', htm: 'text/html', html: 'text/html',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip', ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'})[e] || 'application/octet-stream';
}
/* ---------- 組 EML ---------- */
function b64(u8){
  var s = '', CH = 0x8000;
  for(var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s).replace(/.{76}/g, '$&\r\n').replace(/\r\n$/, '');
}
function utf8(s){ return new TextEncoder().encode(s); }
function encWord(s){
  if(/^[\x20-\x7e]*$/.test(s)) return s;
  var parts = [], cur = '';
  Array.from(s).forEach(function(ch){ if(utf8(cur + ch).length > 36){ parts.push(cur); cur = ch; } else cur += ch; });
  if(cur) parts.push(cur);
  return parts.map(function(x){ return '=?UTF-8?B?' + b64(utf8(x)) + '?='; }).join('\r\n ');
}
function addr(a){
  if(!a || (!a.email && !a.name)) return '';
  if(!a.email) return encWord(a.name);
  if(!a.name || a.name === a.email) return '<' + a.email + '>';
  var n = /^[\x20-\x7e]*$/.test(a.name) ? '"' + a.name.replace(/(["\\])/g, '\\$1') + '"' : encWord(a.name);
  return n + ' <' + a.email + '>';
}
function addrList(l){ return l.map(addr).filter(Boolean).join(',\r\n ');}
function rfcDate(d){ return d.toUTCString().replace('GMT', '+0000'); }
function textPart(type, body){ return 'Content-Type: ' + type + '; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64(utf8(body.replace(/\r?\n/g, '\r\n'))); }
function multipart(kind, parts, bnd){ return {head: 'Content-Type: multipart/' + kind + '; boundary="' + bnd + '"', body: parts.map(function(p){ return '--' + bnd + '\r\n' + p; }).join('\r\n') + '\r\n--' + bnd + '--'}; }
function toEml(m){
  var rnd = Math.random().toString(36).slice(2, 10), L = [];
  var from = addr(m.from); if(from) L.push('From: ' + from);
  var to = addrList(m.to); if(to) L.push('To: ' + to); else if(m.toDisplay) L.push('To: ' + encWord(m.toDisplay));
  var cc = addrList(m.cc); if(cc) L.push('Cc: ' + cc); else if(m.ccDisplay) L.push('Cc: ' + encWord(m.ccDisplay));
  var bcc = addrList(m.bcc); if(bcc) L.push('Bcc: ' + bcc);
  L.push('Subject: ' + encWord((m.subject || '').replace(/[\r\n]+/g, ' ')));
  if(m.date) L.push('Date: ' + rfcDate(m.date));
  if(m.messageId) L.push('Message-ID: ' + m.messageId);
  L.push('MIME-Version: 1.0', 'X-Converted-From: Outlook .msg');
  var regular = [], inline = [];
  (m.atts || []).forEach(function(a){ if(!a.data) return; (a.cid && m.html && m.html.indexOf(a.cid) >= 0 ? inline : regular).push(a); });
  function attPart(a, isInline){
    var nm = encWord(a.name);
    return 'Content-Type: ' + a.mime + '; name="' + nm + '"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: ' + (isInline ? 'inline' : 'attachment') +
      '; filename="' + nm + '"' + (a.cid ? '\r\nContent-ID: <' + a.cid.replace(/^<|>$/g, '') + '>' : '') + '\r\n\r\n' + b64(a.data);
  }
  var body;                                                   /* {head, body} */
  var plain = m.text || (m.html ? m.html.replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : '');
  var htmlPart = null;
  if(m.html){
    var h = {head: 'Content-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: base64', body: b64(utf8(m.html.replace(/\r?\n/g, '\r\n')))};
    if(inline.length){
      var rel = multipart('related', [h.head + '\r\n\r\n' + h.body].concat(inline.map(function(a){ return attPart(a, true); })), '=_rel_' + rnd);
      htmlPart = rel.head + '\r\n\r\n' + rel.body;
    }else htmlPart = h.head + '\r\n\r\n' + h.body;
  }
  if(htmlPart){
    var alt = multipart('alternative', [textPart('text/plain', plain), htmlPart], '=_alt_' + rnd);
    body = alt;
  }else body = {head: textPart('text/plain', plain).split('\r\n\r\n')[0], body: textPart('text/plain', plain).split('\r\n\r\n').slice(1).join('\r\n\r\n')};
  if(regular.length){
    var mix = multipart('mixed', [body.head + '\r\n\r\n' + body.body].concat(regular.map(function(a){ return attPart(a, false); })), '=_mix_' + rnd);
    body = mix;
  }
  return L.join('\r\n') + '\r\n' + body.head + '\r\n\r\n' + body.body + '\r\n';
}
return {parse: parse, toEml: toEml, convert: function(buf){ var m = parse(buf); return {msg: m, eml: toEml(m)}; }};
})();
/*MSG-END*/

/* ---------- 介面：MSG→EML 轉換面板 ---------- */
(function(){
var dz = document.getElementById('dzMsg'); if(!dz) return;
var input = document.getElementById('fileMsg'), list = document.getElementById('msgList'), btnAll = document.getElementById('btnMsgZip');
var done = [];
function emlName(n){ return n.replace(/\.msg$/i, '') + '.eml'; }
async function handle(files){
  list.innerHTML = ''; done = []; btnAll.disabled = true;
  for(var i = 0; i < files.length; i++){
    var f = files[i], row = document.createElement('div'); row.className = 'msg-row';
    row.style.cssText = 'padding:8px 0;border-bottom:1px dashed var(--border-soft,#b3a377);font-size:14px;line-height:1.6';
    list.appendChild(row);
    try{
      if(!/\.msg$/i.test(f.name)) throw new Error('不是 .msg 檔');
      var r = MSGX.convert(await f.arrayBuffer()), m = r.msg;
      var blob = new Blob([r.eml], {type: 'message/rfc822'}), name = emlName(f.name);
      done.push({name: name, blob: blob});
      var skipped = (m.atts || []).filter(function(a){ return !a.data; }).length;
      row.innerHTML = '✅ <b>' + escapeXml(f.name) + '</b> → ' + escapeXml(name) + '<br><span style="opacity:.8">主旨：' + escapeXml(m.subject || '（無）') + '｜寄件者：' + escapeXml((m.from.name || '') + ' ' + (m.from.email ? '<' + m.from.email + '>' : '')) +
        '｜收件者 ' + m.to.length + ' 人｜附件 ' + ((m.atts || []).length - skipped) + ' 個' + (skipped ? '（' + skipped + ' 個內嵌郵件未轉換）' : '') + '</span>';
      var b = document.createElement('button'); b.className = 'secondary'; b.textContent = '下載 .eml'; b.style.marginLeft = '8px';
      b.addEventListener('click', function(n, bl){ return function(){ saveFile(n, bl, 'message/rfc822'); }; }(name, blob)); row.appendChild(b);
    }catch(e){ row.innerHTML = '❌ <b>' + escapeXml(f.name) + '</b>：' + escapeXml((e && e.message) || String(e)); }
  }
  btnAll.disabled = done.length < 2;
  if(done.length) toast('已轉換 ' + done.length + ' 封郵件');
}
dz.addEventListener('click', function(){ input.click(); });
input.addEventListener('change', function(){ if(input.files.length) handle(Array.prototype.slice.call(input.files)); input.value = ''; });
dz.addEventListener('dragover', function(e){ e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', function(){ dz.classList.remove('drag'); });
dz.addEventListener('drop', function(e){ e.preventDefault(); dz.classList.remove('drag'); if(e.dataTransfer.files.length) handle(Array.prototype.slice.call(e.dataTransfer.files)); });
btnAll.addEventListener('click', async function(){
  var z = new JSZip(); done.forEach(function(d){ z.file(d.name, d.blob); });
  saveFile('msg轉eml.zip', await z.generateAsync({type: 'blob'}), 'application/zip');
});
})();
