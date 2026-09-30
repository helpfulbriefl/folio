// Tools: text transforms, statistics, compare with saved, file versions, all encodings, shortcuts list, go to line, print.
import { $, $$, el, esc, I, basename, fmtSize, wordCount, debounce, on } from '../util.js';
import { t, lang } from '../i18n.js';
import { settings } from '../settings.js';
import { host } from '../host.js';
import { docs, tabName, reloadTab, saveTab, setEncoding, newDoc, encName, encLabel, isDirty } from '../docs.js';
import { editor } from '../editor/editor.js';
import { allCommands, titleOf, keysOf, prettyKeys, getCommand, rebuildKeymap, altKeys } from '../commands.js';
import { modal, toast, prompt, confirm } from './dialogs.js';
import { renderMd } from '../reader/md.js';

// ---------- text transforms (selection or whole document) ----------
function targetRange() {
  const s = editor.selection();
  const doc = editor.view.state.doc;
  if (s.empty) return { from: 0, to: doc.length, text: doc.toString(), whole: true };
  const a = doc.lineAt(s.from), b = doc.lineAt(s.to === s.from ? s.to : s.to - (doc.lineAt(s.to).from === s.to ? 1 : 0));
  return { from: a.from, to: b.to, text: doc.sliceString(a.from, b.to), whole: false };
}
function replaceTarget(r, text, what) {
  if (text === r.text) { toast(t('tools.nothing'), { icon: 'info' }); return; }
  editor.view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, userEvent: 'input.tool', selection: r.whole ? undefined : { anchor: r.from, head: r.from + text.length } });
  if (what) toast(what, { icon: 'check' });
}
const coll = () => new Intl.Collator(lang() === 'zh' ? 'zh' : lang(), { numeric: true, sensitivity: 'base' });

export function sortLines(desc = false) {
  const r = targetRange();
  const lines = r.text.split('\n');
  const trail = lines[lines.length - 1] === '' ? lines.pop() : null;
  const c = coll();
  lines.sort((a, b) => c.compare(a, b) * (desc ? -1 : 1));
  if (trail !== null) lines.push('');
  replaceTarget(r, lines.join('\n'), t('tools.sorted', { n: lines.length }));
}
export function dedupe() {
  const r = targetRange();
  const seen = new Set(); let removed = 0;
  const out = r.text.split('\n').filter(l => { const k = l.trim(); if (!k) return true; if (seen.has(k)) { removed++; return false; } seen.add(k); return true; });
  replaceTarget(r, out.join('\n'), t('tools.deduped', { n: removed }));
}
export function removeEmpty() {
  const r = targetRange();
  const lines = r.text.split('\n');
  const out = lines.filter((l, i) => l.trim() !== '' || i === lines.length - 1);
  replaceTarget(r, out.join('\n'), t('tools.removedEmpty', { n: lines.length - out.length }));
}
export function trimSpaces() {
  const r = targetRange();
  replaceTarget(r, r.text.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n'), t('tools.trimmed'));
}
export function changeCase(kind) {
  const s = editor.selection();
  const doc = editor.view.state.doc;
  const from = s.empty ? 0 : s.from, to = s.empty ? doc.length : s.to;
  const text = doc.sliceString(from, to);
  const L = lang() === 'en' ? 'en' : lang();
  let out = text;
  if (kind === 'upper') out = text.toLocaleUpperCase(L);
  else if (kind === 'lower') out = text.toLocaleLowerCase(L);
  else if (kind === 'title') out = text.toLocaleLowerCase(L).replace(/(^|[\s\-«"(])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase(L));
  else if (kind === 'sentence') out = text.toLocaleLowerCase(L).replace(/(^\s*|[.!?…]\s+|\n\s*)(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase(L));
  else if (kind === 'invert') out = [...text].map(ch => { const u = ch.toLocaleUpperCase(L); return u === ch ? ch.toLocaleLowerCase(L) : u; }).join('');
  if (out === text) return;
  editor.view.dispatch({ changes: { from, to, insert: out }, userEvent: 'input.tool', selection: s.empty ? undefined : { anchor: from, head: from + out.length } });
}
export function formatJson() {
  const s = editor.selection();
  const doc = editor.view.state.doc;
  const from = s.empty ? 0 : s.from, to = s.empty ? doc.length : s.to;
  const text = doc.sliceString(from, to);
  try {
    const n = settings.get('tabSize') || 2;
    const out = JSON.stringify(JSON.parse(text), null, settings.get('insertSpaces') === false ? '\t' : ' '.repeat(Math.min(n, 4)));
    editor.view.dispatch({ changes: { from, to, insert: out + (s.empty && /\n$/.test(text) ? '\n' : '') }, userEvent: 'input.tool' });
    toast(t('tools.jsonOk'), { icon: 'braces' });
  } catch (e) {
    const m = /position (\d+)/.exec(e.message);
    if (m) { const pos = from + +m[1]; const line = doc.lineAt(Math.min(pos, doc.length)); editor.gotoPos(Math.min(pos, doc.length)); toast(t('tools.jsonErrAt', { l: line.number, c: pos - line.from + 1 }), { icon: 'triangle-alert', kind: 'err', ms: 5000 }); }
    else toast(t('tools.jsonErr') + ': ' + e.message, { icon: 'triangle-alert', kind: 'err', ms: 5000 });
  }
}
export function insertDate() {
  const d = new Date();
  const L = lang() === 'en' ? 'en-US' : lang() === 'zh' ? 'zh-CN' : 'ru-RU';
  editor.replaceSelection(d.toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString(L));
}

// ---------- go to line ----------
export async function gotoLineDialog() {
  const c = editor.cursorInfo();
  const v = await prompt({ title: t('cmd.edit.goto'), text: t('dlg.gotoText', { n: c.lines }), value: String(c.line), placeholder: t('dlg.gotoPh'), icon: 'arrow-down-to-line', ok: t('dlg.go') });
  if (!v) return;
  const [l, col] = v.split(/[:,\s]+/).map(x => parseInt(x, 10));
  if (l > 0) editor.gotoLine(l, col || 1);
}

// ---------- statistics ----------
export function statsDialog() {
  const tab = docs.active;
  const s = editor.selection();
  const text = s.empty ? editor.text(tab) : s.text;
  const chars = [...text].length;
  const noSpace = [...text.replace(/\s/g, '')].length;
  const words = wordCount(text);
  const lines = text ? text.split('\n').length : 0;
  const paras = text.split(/\n\s*\n/).filter(p => p.trim()).length;
  const sentences = (text.match(/[^.!?…。！？]+[.!?…。！？]+/g) || []).length;
  const readMin = words / 180, speakMin = words / 130;
  const fmtMin = m => (m < 1 ? t('stats.lessMin') : t('stats.min', { n: Math.round(m) }));
  const N = n => n.toLocaleString(lang() === 'en' ? 'en-US' : lang());
  const cells = [
    ['stats.words', N(words)], ['stats.chars', N(chars)], ['stats.noSpaces', N(noSpace)], ['stats.lines', N(lines)],
    ['stats.paras', N(paras)], ['stats.sentences', N(sentences)], ['stats.read', fmtMin(readMin)], ['stats.speak', fmtMin(speakMin)],
    ['stats.pages', (noSpace / 1800).toFixed(1).replace('.', lang() === 'ru' ? ',' : '.')], ['stats.enc', encLabel(tab) + ' · ' + tab.eol.toUpperCase()],
    ['stats.size', tab.size ? fmtSize(tab.size) : '—'], ['stats.lang', tab.lang],
  ];
  modal(`<div class="dlg w520"><div class="dlg-h"><span class="dlg-ic">${I('chart-no-axes-column')}</span><div class="dlg-t"><h3>${esc(t('cmd.tools.stats'))}</h3><p>${esc(s.empty ? tabName(tab) : t('stats.selection'))}</p></div></div>
    <div class="dlg-b"><div class="stat-grid">${cells.map(([k, v]) => `<div class="sc"><b>${esc(v)}</b><span>${esc(t(k))}</span></div>`).join('')}</div></div>
    <div class="dlg-f"><button class="btn ghost" data-copy-stats>${I('copy', 'sm')}${esc(t('reader.copy'))}</button><span class="grow"></span><button class="btn primary" data-close>${esc(t('dlg.close'))}</button></div></div>`, { cls: 'm-dlg', label: t('cmd.tools.stats') })
    .el.querySelector('[data-copy-stats]').onclick = () => { host.send('clipboard.write', { text: cells.map(([k, v]) => `${t(k)}: ${v}`).join('\n') }); toast(t('toast.copied')); };
}

// ---------- line diff ----------
export function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const mid = myers(A.slice(s, ea), B.slice(s, eb));
  const ops = [];
  for (let i = 0; i < s; i++) ops.push(['=', A[i], i + 1, i + 1]);
  let ia = s, ib = s;
  for (const [op, line] of mid) {
    if (op === '=') { ops.push(['=', line, ++ia, ++ib]); }
    else if (op === '-') ops.push(['-', line, ++ia, null]);
    else ops.push(['+', line, null, ++ib]);
  }
  for (let i = ea; i < A.length; i++) ops.push(['=', A[i], ++ia, ++ib]);
  return ops;
}
function myers(A, B) {
  const N = A.length, M = B.length;
  if (N * M > 4e7 || N + M > 40000) return [...A.map(l => ['-', l]), ...B.map(l => ['+', l])];
  const max = N + M, off = max;
  const V = new Int32Array(2 * max + 2);
  const trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(V.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      V[off + k] = x;
      if (x >= N && y >= M) return backtrack(trace, A, B, off, d);
    }
  }
  return [];
}
function backtrack(trace, A, B, off, D) {
  let x = A.length, y = B.length;
  const out = [];
  for (let d = D; d > 0; d--) {
    const V = trace[d];
    const k = x - y;
    const pk = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? k + 1 : k - 1;
    const px = V[off + pk], py = px - pk;
    while (x > px && y > py) { out.push(['=', A[--x]]); y--; }
    if (x === px) out.push(['+', B[--y]]); else out.push(['-', A[--x]]);
  }
  while (x > 0 && y > 0) { out.push(['=', A[--x]]); y--; }
  return out.reverse();
}

function diffHTML(ops, ctx = 3) {
  const show = new Uint8Array(ops.length);
  ops.forEach((o, i) => { if (o[0] !== '=') for (let j = Math.max(0, i - ctx); j <= Math.min(ops.length - 1, i + ctx); j++) show[j] = 1; });
  let html = '', gap = false, added = 0, removed = 0;
  ops.forEach((o, i) => {
    if (o[0] === '+') added++; if (o[0] === '-') removed++;
    if (!show[i]) { if (!gap) { html += `<div class="dl gap">⋯</div>`; gap = true; } return; }
    gap = false;
    const cls = o[0] === '+' ? 'ins' : o[0] === '-' ? 'del' : 'ctx';
    html += `<div class="dl ${cls}"><span class="n">${o[2] ?? ''}</span><span class="n">${o[3] ?? ''}</span><span class="s">${o[0] === '=' ? ' ' : o[0]}</span><span class="c">${esc(o[1]) || ' '}</span></div>`;
  });
  return { html, added, removed };
}

// ---------- compare with saved ----------
export async function compareWithSaved() {
  const tab = docs.active;
  if (!tab?.path) { toast(t('tools.notSaved'), { icon: 'info' }); return; }
  let saved;
  try { saved = (await host.call('file.read', { path: tab.path, encoding: tab.encoding })).text; } catch (e) { (await import('./dialogs.js')).toastError(e); return; }
  const cur = editor.text(tab);
  const ops = lineDiff(saved, cur);
  const d = diffHTML(ops);
  const same = !d.added && !d.removed;
  modal(`<div class="dlg w820 diff-dlg"><div class="dlg-h"><span class="dlg-ic">${I('git-compare')}</span><div class="dlg-t"><h3>${esc(t('cmd.tools.compare'))}</h3><p>${esc(tabName(tab))} · <span class="plus">+${d.added}</span> <span class="minus">−${d.removed}</span></p></div></div>
    <div class="dlg-b">${same ? `<div class="empty-ok">${I('circle-check', 'lg')}<b>${esc(t('tools.same'))}</b></div>` : `<div class="diff">${d.html}</div>`}</div>
    <div class="dlg-f">${same ? '' : `<button class="btn ghost" data-revert>${I('undo-2', 'sm')}${esc(t('tools.revert'))}</button>`}<span class="grow"></span><button class="btn primary" data-close>${esc(t('dlg.close'))}</button></div></div>`, { cls: 'm-dlg', label: t('cmd.tools.compare') })
    .el.querySelector('[data-revert]')?.addEventListener('click', async e => {
      if (await confirm({ title: t('tools.revertTitle'), text: t('tools.revertText'), ok: t('tools.revert'), icon: 'undo-2', danger: true })) { editor.setText(tab, saved); editor.markSaved(tab); e.target.closest('.modal')?.querySelector('[data-close]')?.click(); }
    });
}

// ---------- file versions ----------
export async function versionsDialog() {
  const tab = docs.active;
  if (!tab?.path) { toast(t('tools.notSaved'), { icon: 'info' }); return; }
  let list = [];
  try { list = await host.call('file.versions', { path: tab.path }) || []; } catch { }
  const when = ms => new Date(ms).toLocaleString(lang() === 'en' ? 'en-GB' : lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const m = modal(`<div class="dlg w860 ver-dlg"><div class="dlg-h"><span class="dlg-ic">${I('history')}</span><div class="dlg-t"><h3>${esc(t('cmd.file.versions'))}</h3><p>${esc(t('ver.sub', { name: tabName(tab) }))}</p></div></div>
    <div class="ver-b">${list.length ? `<div class="ver-list">${list.map((v, i) => `<button class="ver ${i === 0 ? 'on' : ''}" data-id="${esc(v.id)}"><b>${esc(when(v.time))}</b><span>${esc(fmtSize(v.size))}</span></button>`).join('')}</div><div class="ver-pv"><div class="diff"></div></div>` : `<div class="empty-ok">${I('history', 'lg')}<b>${esc(t('ver.none'))}</b><span>${esc(t('ver.noneHint'))}</span></div>`}</div>
    <div class="dlg-f">${list.length ? `<button class="btn ghost" data-open>${I('file-plus', 'sm')}${esc(t('ver.openCopy'))}</button><button class="btn primary" data-restore>${I('undo-2', 'sm')}${esc(t('ver.restore'))}</button>` : ''}<span class="grow"></span><button class="btn ghost" data-close>${esc(t('dlg.close'))}</button></div></div>`, { cls: 'm-dlg', label: t('cmd.file.versions') });
  if (!list.length) return;
  let curText = '';
  const pv = $('.ver-pv .diff', m.el);
  const load = async id => {
    $$('.ver', m.el).forEach(b => b.classList.toggle('on', b.dataset.id === id));
    pv.innerHTML = `<div class="dl gap">…</div>`;
    try {
      curText = (await host.call('file.versionRead', { path: tab.path, id })).text;
      const d = diffHTML(lineDiff(curText, editor.text(tab)));
      pv.innerHTML = d.added || d.removed ? `<div class="ver-sum"><span class="minus">${esc(t('ver.inVersion'))}</span> · <span class="plus">${esc(t('ver.now'))}</span></div>` + d.html : `<div class="empty-ok sm">${esc(t('tools.same'))}</div>`;
    } catch (e) { pv.innerHTML = `<div class="dl gap">${esc(e.message)}</div>`; }
  };
  on(m.el, 'click', '.ver', (e, b) => load(b.dataset.id));
  m.el.querySelector('[data-restore]').onclick = () => { editor.setText(tab, curText); m.close(); toast(t('ver.restored'), { icon: 'undo-2', sub: t('ver.undoHint') }); };
  m.el.querySelector('[data-open]').onclick = () => { m.close(); newDoc({ text: curText, name: tabName(tab).replace(/(\.\w+)?$/, ' (' + t('ver.copy') + ')$1') }); };
  load(list[0].id);
}

// ---------- all encodings ----------
export async function encodingsDialog(purpose = 'reopen') {
  const tab = docs.active;
  let list = [];
  try { list = await host.call('enc.list'); } catch { }
  const groups = { unicode: 'g.unicode', cyr: 'g.cyrAll', west: 'g.west', central: 'g.central', cjk: 'g.cjk', other: 'g.other' };
  const reopen = purpose === 'reopen' && !!tab?.path;
  const m = modal(`<div class="dlg w640 enc-dlg"><div class="dlg-h"><span class="dlg-ic">${I('file-code')}</span><div class="dlg-t"><h3>${esc(t(reopen ? 'enc.dlgReopen' : 'enc.dlgSave'))}</h3><p>${esc(t('enc.dlgNow', { enc: encLabel(tab) }))}</p></div></div>
    <div class="dlg-b"><label class="search">${I('search', 'sm')}<input placeholder="${esc(t('enc.search'))}" spellcheck="false"></label><div class="enc-list"></div></div>
    <div class="dlg-f"><span class="grow"></span><button class="btn ghost" data-close>${esc(t('dlg.cancel'))}</button></div></div>`, { cls: 'm-dlg', label: t('menu.allEncodings') });
  const box = $('.enc-list', m.el);
  const inp = $('input', m.el);
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    let html = '';
    for (const g of Object.keys(groups)) {
      const items = list.filter(e => e.group === g && (!q || e.name.toLowerCase().includes(q) || e.id.includes(q)));
      if (!items.length) continue;
      html += `<div class="mh">${esc(t(groups[g]))}</div>` + items.map(e => `<button class="encrow ${tab.encoding === e.id ? 'cur' : ''}" data-enc="${esc(e.id)}"><span class="nm">${esc(e.name)}</span><span class="pv" data-pv="${esc(e.id)}"></span>${tab.encoding === e.id ? I('check', 'sm') : ''}</button>`).join('');
    }
    box.innerHTML = html || `<div class="pal-empty">${esc(t('pal.nothing'))}</div>`;
    if (reopen) fill();
  };
  const fill = debounce(async () => {
    const ids = $$('[data-pv]', box).map(x => x.dataset.pv);
    try {
      const pv = await host.call('file.previews', { path: tab.path, ids });
      for (const p of pv) { const n = box.querySelector(`[data-pv="${CSS.escape(p.id)}"]`); if (n) { n.textContent = p.preview; n.closest('.encrow').classList.toggle('bad', p.bad > 0); } }
    } catch { }
  }, 80);
  inp.addEventListener('input', draw);
  on(box, 'click', '[data-enc]', async (e, b) => {
    const id = b.dataset.enc;
    m.close();
    if (reopen) await reloadTab(tab, id);
    else { setEncoding(tab, id, id.startsWith('utf-') && id !== 'utf-8'); await saveTab(tab, { encoding: id }); }
  });
  draw();
  setTimeout(() => inp.focus(), 40);
}

// ---------- keyboard shortcuts ----------
const GROUPS = [['file', 'mb.file'], ['edit', 'mb.edit'], ['view', 'mb.view'], ['mode', 'keys.modes'], ['enc', 'mb.enc'], ['tools', 'mb.tools'], ['ai', 'mb.ai'], ['reader', 'keys.reader'], ['help', 'mb.help'], ['app', 'keys.app']];
export function keysDialog() {
  const cmds = allCommands().filter(c => c.palette !== false || keysOf(c.id));
  const extra = [['keys.nextTab', 'Ctrl+Tab'], ['keys.prevTab', 'Ctrl+Shift+Tab'], ['keys.closeTab', 'Ctrl+W'], ['keys.pages', '← →'], ['keys.quickNote', settings.get('hotkeyQuickNote') + ' ' + t('keys.global')], ['keys.show', settings.get('hotkeyShow') + ' ' + t('keys.global')], ['keys.zoomWheel', 'Ctrl + ' + t('zoom.wheel')]];
  const m = modal(`<div class="dlg w760 keys-dlg"><div class="dlg-h"><span class="dlg-ic">${I('keyboard')}</span><div class="dlg-t"><h3>${esc(t('cmd.help.keys'))}</h3><p>${esc(t('keys.sub'))}</p></div><span class="grow"></span><label class="search">${I('search', 'sm')}<input placeholder="${esc(t('keys.search'))}" spellcheck="false"></label></div>
    <div class="dlg-b keys-b"></div>
    <div class="dlg-f"><button class="btn ghost" data-edit>${I('pencil', 'sm')}${esc(t('keys.edit'))}</button><span class="grow"></span><button class="btn primary" data-close>${esc(t('dlg.close'))}</button></div></div>`, { cls: 'm-dlg', label: t('cmd.help.keys') });
  const body = $('.keys-b', m.el);
  const inp = $('input', m.el);
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    let html = '<div class="kcols">';
    for (const [g, label] of GROUPS) {
      const list = cmds.filter(c => (c.id.split('.')[0] === g || (g === 'mode' && c.id.startsWith('mode.'))) && keysOf(c.id)).filter(c => !q || titleOf(c).toLowerCase().includes(q) || keysOf(c.id).toLowerCase().includes(q));
      if (!list.length) continue;
      html += `<div class="kgrp"><div class="mh">${esc(t(label))}</div>${list.map(c => `<div class="krow"><span>${esc(titleOf(c))}</span>${keyCaps(keysOf(c.id))}</div>`).join('')}</div>`;
    }
    const ex = extra.filter(([k, v]) => !q || t(k).toLowerCase().includes(q) || v.toLowerCase().includes(q));
    if (ex.length) html += `<div class="kgrp"><div class="mh">${esc(t('keys.other'))}</div>${ex.map(([k, v]) => `<div class="krow"><span>${esc(t(k))}</span>${keyCaps(v)}</div>`).join('')}</div>`;
    body.innerHTML = html + '</div>';
  };
  inp.addEventListener('input', draw);
  m.el.querySelector('[data-edit]').onclick = () => { m.close(); import('../commands.js').then(c => c.run('app.settings', 'keys')); };
  draw();
}
export function keyCaps(k) {
  const first = altKeys(k)[0] || '';
  const [keys, ...rest] = first.split(' ');
  return `<span class="caps">${keys.split(/\+(?!$)/).map(x => `<kbd class="kb">${esc(x === '=' || x === 'Plus' ? '+' : x)}</kbd>`).join('')}${rest.length ? `<small>${esc(rest.join(' '))}</small>` : ''}</span>`;
}

// ---------- print ----------
export function printDoc() {
  const tab = docs.active;
  const text = editor.text(tab);
  let box = $('#print');
  if (!box) { box = el('<div id="print"></div>'); document.body.append(box); }
  const md = tab.lang === 'markdown' || (tab.lang === 'text' && settings.get('markdownInTxt') && /^#{1,3} |\n#{1,3} |\*\*|^- \[/m.test(text));
  box.className = md ? 'md' : 'plain';
  box.innerHTML = md ? `<div class="p-md">${renderMd(text)}</div>` : `<pre class="p-pre">${esc(text)}</pre>`;
  document.title = tabName(tab);
  setTimeout(() => { window.print(); setTimeout(() => { box.innerHTML = ''; host.send('win.setTitle', { title: `${tabName(tab)} — Folio` }); }, 500); }, 50);
}
