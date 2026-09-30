// Browser stand-in for the Windows host: in-memory files, fake spell checker and a demo AI.
// Lets the UI run in a normal browser (npm run dev + open dist/index.html) and in UI tests.
import { SAMPLES, DEMO_FIXES } from './samples.js';

const SINGLE = { 'windows-1251': 1, 'cp866': 'ibm866', 'koi8-r': 1, 'iso-8859-5': 1, 'windows-1252': 1, 'windows-1250': 1 };
const encMaps = {};
function encodeSingle(text, enc) {
  const label = SINGLE[enc] === 1 ? enc : SINGLE[enc];
  let map = encMaps[enc];
  if (!map) {
    map = encMaps[enc] = new Map();
    const dec = new TextDecoder(label);
    for (let b = 0; b < 256; b++) { const ch = dec.decode(new Uint8Array([b])); if (ch !== '\ufffd' && !map.has(ch)) map.set(ch, b); }
  }
  const out = [];
  let bad = 0;
  for (const ch of text) { const b = map.get(ch); if (b === undefined) { out.push(63); bad++; } else out.push(b); }
  return { bytes: new Uint8Array(out), bad };
}
function encode(text, enc, bom) {
  if (enc === 'utf-8') { const b = new TextEncoder().encode(text); return bom ? concat([0xEF, 0xBB, 0xBF], b) : b; }
  if (enc === 'utf-16le' || enc === 'utf-16be') {
    const out = new Uint8Array(text.length * 2 + (bom ? 2 : 0));
    let o = 0;
    if (bom) { out[0] = enc === 'utf-16le' ? 0xFF : 0xFE; out[1] = enc === 'utf-16le' ? 0xFE : 0xFF; o = 2; }
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (enc === 'utf-16le') { out[o++] = c & 255; out[o++] = c >> 8; } else { out[o++] = c >> 8; out[o++] = c & 255; } }
    return out;
  }
  if (SINGLE[enc]) return encodeSingle(text, enc).bytes;
  return new TextEncoder().encode(text);
}
const concat = (a, b) => { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
const LABEL = { cp866: 'ibm866', 'shift_jis': 'shift_jis', 'euc-kr': 'euc-kr', gb18030: 'gb18030', big5: 'big5' };
function decode(bytes, enc) {
  try { return new TextDecoder(LABEL[enc] || enc).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}
function detect(bytes) {
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return { encoding: 'utf-8', bom: true, confidence: 1, reason: 'bom' };
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return { encoding: 'utf-16le', bom: true, confidence: 1, reason: 'bom' };
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return { encoding: 'utf-8', bom: false, confidence: 1, reason: bytes.some(b => b > 127) ? 'utf8' : 'ascii' }; } catch { }
  let hi = 0; for (const b of bytes) if (b >= 0xC0) hi++;
  return { encoding: 'windows-1251', bom: false, confidence: hi > 20 ? 0.97 : 0.7, reason: 'cyrillic', candidates: [{ key: 'windows-1251', value: 0.97 }, { key: 'koi8-r', value: 0.12 }, { key: 'cp866', value: 0.05 }] };
}

const TYPOS = { recieve: ['receive'], feedbak: ['feedback'], teh: ['the', 'tech'], впринципе: ['в принципе'], извените: ['извините'], сдесь: ['здесь'], помошь: ['помощь'] };
const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem('folio.' + k) || 'null'); localStorage.setItem('folio.' + k, JSON.stringify(v)); } catch { return null; } };

export function createMockHost(emit) {
  const fs = new Map();
  const now = Date.now();
  SAMPLES.forEach((s, i) => fs.set(s.path.toLowerCase(), { path: s.path, bytes: encode(s.text, s.encoding, false), mtime: now - (i + 1) * 3600e3 }));
  const logs = [{ t: new Date().toISOString(), level: 'info', msg: 'Folio (browser preview) started' }];
  const versions = new Map();
  let clip = '';
  const aiJobs = new Map();
  const ev = (e, d) => setTimeout(() => emit({ ev: e, d }), 0);
  const url = new URLSearchParams(location.search);

  const readFile = (path, encoding) => {
    const f = fs.get(path.toLowerCase());
    if (!f) throw { code: 'notFound', message: 'File not found: ' + path };
    const det = encoding ? { encoding, bom: false, confidence: 1, reason: 'manual' } : detect(f.bytes);
    let bytes = f.bytes;
    if (det.bom) bytes = bytes.slice(det.encoding === 'utf-8' ? 3 : 2);
    let text = decode(bytes, det.encoding);
    const invalid = (text.match(/\ufffd/g) || []).length;
    const crlf = (text.match(/\r\n/g) || []).length, lf = (text.match(/(?<!\r)\n/g) || []).length;
    text = text.replace(/\r\n?/g, '\n');
    return { path: f.path, text, encoding: det.encoding, bom: !!det.bom, eol: crlf >= lf && crlf ? 'crlf' : lf ? 'lf' : 'crlf', mixedEol: crlf > 0 && lf > 0, confidence: det.confidence, reason: det.reason, candidates: det.candidates || [], mtime: f.mtime, size: f.bytes.length, readOnly: false, binary: false, invalid };
  };

  const handlers = {
    'app.init': () => ({
      version: '1.0.0', settings: store('settings'), recent: store('recent') || SAMPLES.slice(0, 4).map((s, i) => ({ path: s.path, encoding: s.encoding, time: now - i * 86400e3, pinned: i === 0 })),
      session: url.has('fresh') ? null : store('session'), args: url.has('open') ? SAMPLES.map(s => s.path) : [], locale: url.get('lang') || navigator.language,
      sys: { os: 'Browser preview', build: 22631, win11: true, portable: false, dataDir: 'C:\\Users\\Demo\\AppData\\Roaming\\Folio', notesDir: 'C:\\Users\\Demo\\Documents\\Folio', webview: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '', arch: 'x64', primary: true, mock: true },
      spell: { langs: ['en-US', 'ru-RU'] }, flags: { firstRun: !store('settings'), selftest: url.has('selftest') }, langs: [], hasAiKey: !!store('aikey'),
    }),
    'app.ready': () => true, 'app.exit': () => { logs.push({ t: new Date().toISOString(), level: 'info', msg: 'exit' }); return true; },
    'app.newWindow': () => { window.open(location.href.split('?')[0] + '?fresh', '_blank'); return true; }, 'app.restart': () => { location.reload(); return true; },
    'win.maximize': () => { this_.max = !this_.max; ev('win.state', { maximized: this_.max, active: true }); return true; },
    'win.fullscreen': p => { if (p.on) document.documentElement.requestFullscreen?.().catch(() => { }); else if (document.fullscreenElement) document.exitFullscreen(); ev('win.state', { fullscreen: !!p.on }); return true; },
    'win.topmost': p => { ev('win.state', { topmost: !!p.on }); return true; },
    'win.hide': () => { document.title = '(hidden) Folio'; return true; },
    'win.setTitle': p => { document.title = p.title; return true; },
    'file.read': p => readFile(p.path, p.encoding),
    'file.exists': p => ({ exists: fs.has(p.path.toLowerCase()) }),
    'file.openDialog': () => { const open = [...fs.values()].map(f => f.path); return { paths: open.length ? [open[(this_.pick = ((this_.pick || 0) + 1) % open.length)]] : [] }; },
    'file.saveDialog': p => ({ path: (p.dir || 'C:\\Users\\Demo\\Documents') + '\\' + (p.name || 'note.txt') }),
    'file.checkEncodable': p => {
      if (!SINGLE[p.encoding]) return { count: 0, chars: '', positions: [] };
      const r = encodeSingle(p.text, p.encoding);
      const chars = [...new Set([...p.text].filter(ch => encodeSingle(ch, p.encoding).bad))].slice(0, 12).join(' ');
      return { count: r.bad, chars, positions: [] };
    },
    'file.save': p => {
      const key = p.path.toLowerCase();
      const old = fs.get(key);
      if (old) { const list = versions.get(key) || []; list.unshift({ id: 'v' + Date.now(), time: old.mtime, size: old.bytes.length, bytes: old.bytes }); versions.set(key, list.slice(0, 20)); }
      const text = p.eol === 'crlf' ? p.text.replace(/\n/g, '\r\n') : p.eol === 'cr' ? p.text.replace(/\n/g, '\r') : p.text;
      let replaced = 0;
      if (SINGLE[p.encoding]) replaced = encodeSingle(text, p.encoding).bad;
      const bytes = encode(text, p.encoding, p.bom);
      const mtime = Date.now();
      fs.set(key, { path: p.path, bytes, mtime });
      return { ok: true, mtime, size: bytes.length, replaced };
    },
    'file.previews': p => {
      const f = fs.get(p.path.toLowerCase());
      if (!f) return [];
      return p.ids.map(id => {
        let s = decode(f.bytes, id).replace(/\r?\n/g, ' ').slice(0, 42);
        const bad = (s.match(/[\ufffd]/g) || []).length + ((id === 'utf-8' && /[\u0400-\u04ff]/.test(s)) ? 0 : 0);
        return { id, preview: s, bad };
      });
    },
    'file.watch': () => true, 'file.reveal': () => true,
    'file.versions': p => (versions.get(p.path.toLowerCase()) || []).map(v => ({ id: v.id, time: v.time, size: v.size })),
    'file.versionRead': p => { const v = (versions.get(p.path.toLowerCase()) || []).find(x => x.id === p.id); if (!v) throw { code: 'notFound', message: 'no version' }; return { text: decode(v.bytes, 'utf-8').replace(/\r\n?/g, '\n') }; },
    'enc.list': () => ENCODINGS,
    'recent.save': p => { store('recent', p.list); return true; },
    'settings.save': p => { store('settings', p.settings); return true; },
    'session.save': p => { store('session', p.session); return true; },
    'dict.save': () => true,
    'clipboard.write': p => { clip = p.text; navigator.clipboard?.writeText(p.text).catch(() => { }); return true; },
    'clipboard.read': async () => { try { return { text: await navigator.clipboard.readText() }; } catch { return { text: clip }; } },
    'spell.words': p => {
      const bad = {};
      for (const w of p.words) { const s = TYPOS[w.toLowerCase()]; if (s) bad[w] = s; }
      return { bad, missing: false };
    },
    'spell.langs': () => ({ langs: ['en-US', 'ru-RU'] }),
    'ai.hasKey': () => ({ has: !!store('aikey') }),
    'ai.setKey': p => { store('aikey', p.key ? '***' : null); return true; },
    'ai.models': () => ({ models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'] }),
    'ai.cancel': p => { const j = aiJobs.get(p.id); if (j) j.cancel = true; return true; },
    'ai.request': p => mockAi(p, aiJobs, ev),
    'update.check': () => ({ current: '1.0.0', latest: '1.0.0', newer: false, notes: '', url: 'https://github.com/helpfulbriefl/folio/releases' }),
    'update.download': () => ({ ok: false }), 'update.install': () => true,
    'log.write': p => { logs.push({ t: new Date().toISOString(), level: p.level || 'info', msg: p.msg }); return true; },
    'log.read': () => ({ lines: logs.slice(-500), path: 'C:\\Users\\Demo\\AppData\\Roaming\\Folio\\logs\\folio.log' }),
    'log.clear': () => { logs.length = 0; return true; },
    'log.openFolder': () => true,
    'sys.fonts': () => ({ fonts: ['Arial', 'Calibri', 'Cambria', 'Cascadia Code', 'Cascadia Mono', 'Consolas', 'Georgia', 'Segoe UI', 'Segoe UI Variable Text', 'Times New Roman', 'Verdana'] }),
    'sys.openUrl': p => { window.open(p.url, '_blank', 'noopener'); return true; },
    'sys.openDataDir': () => true, 'sys.autostart': () => ({ ok: true }), 'sys.hotkeys': () => ({ ok: true, failed: [] }), 'sys.tray': () => true,
    'lang.import': () => ({ cancelled: true }), 'lang.exportTemplate': () => ({ cancelled: true }),
    'settings.export': () => ({ cancelled: true }), 'settings.import': () => ({ cancelled: true }),
    'selftest.shot': () => true, 'selftest.done': () => true, 'selftest.writeFile': p => { fs.set(p.path.toLowerCase(), { path: p.path, bytes: encode(p.text, p.encoding || 'utf-8', !!p.bom), mtime: Date.now() }); return { path: p.path }; },
  };
  const this_ = {};

  return {
    fs,
    async handle({ id, m, p }) {
      const h = handlers[m];
      if (!h) { if (!/^win\.|^sys\./.test(m)) console.debug('[mock] unhandled', m, p); emit({ id, ok: true, r: null }); return; }
      await new Promise(r => setTimeout(r, m === 'file.read' ? 30 : 5));
      try { emit({ id, ok: true, r: await h(p || {}) }); } catch (e) { emit({ id, ok: false, err: { code: e.code || 'error', message: e.message || String(e) } }); }
    },
    dropFiles(files) {
      Promise.all([...files].map(f => f.arrayBuffer().then(buf => {
        const path = 'C:\\Users\\Demo\\Desktop\\' + f.name;
        fs.set(path.toLowerCase(), { path, bytes: new Uint8Array(buf), mtime: Date.now() });
        return path;
      }))).then(paths => emit({ ev: 'app.open', d: { paths } }));
    },
  };
}

function mockAi(p, jobs, ev) {
  const job = { cancel: false };
  jobs.set(p.id, job);
  const sys = p.messages.find(m => m.role === 'system')?.content || '';
  const user = [...p.messages].reverse().find(m => m.role === 'user')?.content || '';
  const task = /Task: (\w+)/.exec(sys)?.[1] || 'chat';
  const src = /<text>\n?([\s\S]*?)\n?<\/text>/.exec(user)?.[1] ?? '';
  let out;
  if (task === 'fix') { out = src; for (const [a, b] of DEMO_FIXES) out = out.split(a).join(b); }
  else if (task === 'shorten') out = src.split(/\n{2,}/).map(par => par.split(/(?<=[.!?])\s+/)[0]).join('\n\n');
  else if (task === 'polite') out = src.replace(/Главное —/g, 'Пожалуй, главное —').replace(/^/, '');
  else if (task === 'translate') out = 'How I stopped being afraid of long texts\n\n' + src.split(/\n{2,}/).slice(1).map(() => '(translated paragraph)').join('\n\n');
  else if (task === 'continue') out = '\n\nА ещё помогает заранее выбрать тему на завтра — тогда утром не нужно думать, с чего начать.';
  else if (task === 'explain') out = 'Это модуль на JavaScript. Функция `stats()` читает файл и считает слова, строки и символы, а класс `Cache` — простой кэш с ограничением размера: при переполнении он удаляет самый старый элемент.';
  else if (task === 'summary') out = '**Кратко:** держать все заметки в одном месте, записывать по горячей клавише и тратить 10–15 минут в день на разбор.';
  else out = 'Это демо-режим без подключения к ИИ. В приложении ответ придёт от выбранной модели. Могу, например, **исправить ошибки**, **сократить** текст или **перевести** его — выберите действие выше.';
  const parts = out.match(/[\s\S]{1,12}/g) || [''];
  return new Promise((resolve, reject) => {
    let i = 0;
    const tick = () => {
      if (job.cancel) { jobs.delete(p.id); reject({ code: 'cancelled', message: 'cancelled' }); return; }
      if (i >= parts.length) { jobs.delete(p.id); resolve({ text: out, model: p.model || 'demo', usage: { total: out.length } }); return; }
      if (p.stream !== false) ev('ai.delta', { id: p.id, text: parts[i] });
      i++;
      setTimeout(tick, 18);
    };
    setTimeout(tick, 300);
  });
}

export const ENCODINGS = [
  ['utf-8', 'UTF-8', 'unicode'], ['utf-16le', 'UTF-16 LE', 'unicode'], ['utf-16be', 'UTF-16 BE', 'unicode'], ['utf-32le', 'UTF-32 LE', 'unicode'],
  ['windows-1251', 'Windows-1251', 'cyr'], ['cp866', 'CP866 (DOS)', 'cyr'], ['koi8-r', 'KOI8-R', 'cyr'], ['koi8-u', 'KOI8-U', 'cyr'], ['iso-8859-5', 'ISO-8859-5', 'cyr'], ['x-mac-cyrillic', 'Mac Cyrillic', 'cyr'],
  ['windows-1252', 'Windows-1252', 'west'], ['iso-8859-1', 'ISO-8859-1', 'west'], ['iso-8859-15', 'ISO-8859-15', 'west'], ['cp437', 'CP437 (DOS)', 'west'], ['cp850', 'CP850 (DOS)', 'west'],
  ['windows-1250', 'Windows-1250', 'central'], ['iso-8859-2', 'ISO-8859-2', 'central'],
  ['gb18030', 'GB18030', 'cjk'], ['gbk', 'GBK', 'cjk'], ['big5', 'Big5', 'cjk'], ['shift_jis', 'Shift-JIS', 'cjk'], ['euc-jp', 'EUC-JP', 'cjk'], ['euc-kr', 'EUC-KR', 'cjk'],
  ['windows-1253', 'Windows-1253', 'other'], ['windows-1254', 'Windows-1254', 'other'], ['windows-1255', 'Windows-1255', 'other'], ['windows-1256', 'Windows-1256', 'other'], ['windows-1257', 'Windows-1257', 'other'], ['windows-1258', 'Windows-1258', 'other'], ['windows-874', 'Windows-874', 'other'],
].map(([id, name, group]) => ({ id, name, group }));
