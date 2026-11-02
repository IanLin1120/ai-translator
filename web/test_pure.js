const fs = require('fs');
const src = fs.readFileSync(__dirname + '/n_pure.js', 'utf8');
const body = src.split('/*PURE-START*/')[1].split('/*PURE-END*/')[0];
const api = new Function(body + `; return {splitSentences,segmentText,joinSents,needsTranslate,buildTxt,parseJsonLoose,expandBlock,linesFromBlocks,safeFileName,parseEmlFull,decodeMimeWords,encodeHeaderValue,buildEml,qpToBytes,b64ToBytes,msgBestEffort};`)();
const assert = require('assert');
let n = 0; function t(name, fn){ try{ fn(); n++; console.log('ok  ', name); }catch(e){ console.log('FAIL', name, '\n   ', e.message); process.exitCode = 1; } }

t('split english', () => assert.deepStrictEqual(api.splitSentences('Hello world. How are you? I am fine!'), ['Hello world.', 'How are you?', 'I am fine!']));
t('split abbreviations/decimals', () => assert.deepStrictEqual(api.splitSentences('Dr. Smith paid 3.5 dollars. He left.'), ['Dr. Smith paid 3.5 dollars.', 'He left.']));
t('split list number', () => assert.deepStrictEqual(api.splitSentences('1. Introduction'), ['1. Introduction']));
t('split chinese', () => assert.deepStrictEqual(api.splitSentences('今天天氣很好。我們去公園吧！好嗎？'), ['今天天氣很好。', '我們去公園吧！', '好嗎？']));
t('split quotes', () => assert.deepStrictEqual(api.splitSentences('他說：「你好。」然後離開了。'), ['他說：「你好。」', '然後離開了。']));
t('split mixed', () => assert.deepStrictEqual(api.splitSentences('Version 2.0 released. 新版本已發布。Enjoy!'), ['Version 2.0 released.', '新版本已發布。', 'Enjoy!']));
t('split empty', () => assert.deepStrictEqual(api.splitSentences('   '), []));
t('split no terminator', () => assert.deepStrictEqual(api.splitSentences('just a title'), ['just a title']));
t('needsTranslate', () => { assert(!api.needsTranslate('12.5%')); assert(api.needsTranslate('A1')); assert(!api.needsTranslate('  ')); });

const segs = api.segmentText('Hello. World!\n\nSecond line.');
segs.forEach(s => s.pairs = s.sents.map(x => ({o: x, t: '譯:' + x})));
t('segment shape', () => assert.deepStrictEqual(segs.map(s => s.sents.length), [2, 0, 1]));
t('build trans', () => assert.strictEqual(api.buildTxt(segs, 'trans', {}, 'zh-TW'), '譯:Hello.譯:World!\n\n譯:Second line.'));
t('build trans latin join', () => assert.strictEqual(api.buildTxt(segs, 'trans', {}, 'en'), '譯:Hello. 譯:World!\n\n譯:Second line.'));
t('build orig', () => assert.strictEqual(api.buildTxt(segs, 'orig', {}, 'zh-TW'), 'Hello. World!\n\nSecond line.'));
t('build both stack+blank', () => assert.strictEqual(api.buildTxt(segs, 'both', {layout:'stack', blank:true}, 'zh-TW'),
  'Hello.\n譯:Hello.\n\nWorld!\n譯:World!\n\nSecond line.\n譯:Second line.'));
t('build both stack no blank keeps source blank', () => assert.strictEqual(api.buildTxt(segs, 'both', {layout:'stack', blank:false}, 'zh-TW'),
  'Hello.\n譯:Hello.\nWorld!\n譯:World!\n\nSecond line.\n譯:Second line.'));
t('build both inline + prefix', () => assert.strictEqual(api.buildTxt(segs.slice(0,1), 'both', {layout:'inline', blank:false, prefix:'→ '}, 'zh-TW'),
  'Hello.  ｜  → 譯:Hello.\nWorld!  ｜  → 譯:World!'));
t('keep lines', () => assert.strictEqual(api.buildTxt([{orig:'主旨：x', keep:true, pairs:[]}], 'trans', {}, 'zh-TW'), '主旨：x'));

t('json loose fence', () => assert.deepStrictEqual(api.parseJsonLoose('```json\n[{"i":1}]\n```'), [{i:1}]));
t('json loose prose', () => assert.deepStrictEqual(api.parseJsonLoose('結果如下：[{"i":1,"t":"a"}] 以上'), [{i:1,t:'a'}]));
t('json loose bad', () => assert.throws(() => api.parseJsonLoose('no json here')));

t('expandBlock splits equal counts', () => assert.deepStrictEqual(api.expandBlock({original:'Hi. Bye.', translated:'嗨。再見。'}).pairs, [{o:'Hi.',t:'嗨。'},{o:'Bye.',t:'再見。'}]));
t('expandBlock keeps unequal', () => assert.strictEqual(api.expandBlock({original:'Hi. Bye.', translated:'嗨，再見。'}).pairs.length, 1));
t('linesFromBlocks drops empty', () => assert.strictEqual(api.linesFromBlocks([{original:'',translated:''},{original:'a',translated:'b'}]).length, 1));

t('safeFileName', () => { assert.strictEqual(api.safeFileName('客戶/文件:1?', '.txt'), '客戶_文件_1_.txt'); assert.strictEqual(api.safeFileName('abc.txt', '.txt'), 'abc.txt'); assert.strictEqual(api.safeFileName('', '.txt'), '翻譯結果.txt'); assert.strictEqual(api.safeFileName('CON', '.txt'), '_CON.txt'); });

// ---- mail ----
const subj = '=?UTF-8?B?' + Buffer.from('測試郵件：報價單').toString('base64') + '?=';
const qpBody = Buffer.from('您好，\n請查收附件。').toString('binary');
const plainB64 = Buffer.from('Hello team,\nPlease review the quote.\nThanks.').toString('base64');
const eml = [
  'From: =?UTF-8?B?' + Buffer.from('王小明').toString('base64') + '?= <wang@example.com>',
  'To: you@example.com',
  'Subject: ' + subj,
  'Date: Mon, 2 Nov 2026 09:00:00 +0800',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="XYZ"',
  '',
  '--XYZ',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: base64',
  '',
  plainB64,
  '--XYZ',
  'Content-Type: text/html; charset="utf-8"',
  '',
  '<p>Hello team</p>',
  '--XYZ--', ''
].join('\r\n');
const p = api.parseEmlFull(eml);
t('eml subject decoded', () => assert.strictEqual(p.headers.subject, '測試郵件：報價單'));
t('eml from decoded', () => assert.strictEqual(p.headers.from, '王小明 <wang@example.com>'));
t('eml multipart base64 plain', () => assert.strictEqual(p.text, 'Hello team,\nPlease review the quote.\nThanks.'));
const eml2 = ['Subject: Hi', 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', '<p>Caf=C3=A9 =E4=BD=A0=E5=A5=BD</p><br>Line2'].join('\n');
t('eml html qp fallback', () => assert.strictEqual(api.parseEmlFull(eml2).text, 'Café 你好\n\nLine2'));
t('encodeHeaderValue ascii', () => assert.strictEqual(api.encodeHeaderValue('Plain'), 'Plain'));
t('encodeHeaderValue roundtrip', () => { const e = api.encodeHeaderValue('這是一封很長很長的測試郵件主旨，用來驗證編碼分段是否正確運作。'); assert(e.split('\r\n ').every(w => w.length <= 75)); assert.strictEqual(api.decodeMimeWords(e.replace(/\r\n /g, ' ')), '這是一封很長很長的測試郵件主旨，用來驗證編碼分段是否正確運作。'); });
t('buildEml re-parse', () => { const out = api.buildEml(p.headers, 'Test mail: quote', 'Line1\nLine2'); const q = api.parseEmlFull(out); assert.strictEqual(q.headers.subject, 'Test mail: quote'); assert.strictEqual(q.text, 'Line1\nLine2'); });
t('msgBestEffort', () => { const s = '\u0000\u0000Hello this is body text\u0000\u0000__substg1.0_1000001F\u0000'; const buf = Buffer.from(s, 'utf16le'); assert(api.msgBestEffort(buf).includes('Hello this is body text')); });
console.log('\n' + n + ' passed');
