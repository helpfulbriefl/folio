// Reading view: chats and long documents as a book (pages) or a feed, with outline, search and a "basket" for copying.
import { $, $$, el, esc, I, bus, on, debounce, clamp, wordCount, basename } from '../util.js';
import { t, lang } from '../i18n.js';
import { settings } from '../settings.js';
import { host } from '../host.js';
import { docs, tabName, newDoc } from '../docs.js';
import { editor } from '../editor/editor.js';
import { parse } from './parse.js';
import { renderMd, mdToPlain } from './md.js';
import { toast } from '../ui/dialogs.js';

let root = null;
let model = null;      // {kind, blocks, preface, key}
let pages = [];        // [[blockIndex...]]
let rtab = null;

const st = () => (rtab.reader ??= { layout: settings.get('reader.layout') || 'book', page: 0, pick: false, sel: [], q: '' });

export function initReader(host_) {
  root = host_;
  root.innerHTML = `<div class="reader"><aside class="outline"><label class="search">${I('search', 'sm')}<input type="search" data-q placeholder="" spellcheck="false"><span class="kb">Ctrl F</span></label><div class="stats"></div><div class="ol"></div></aside><div class="stage" tabindex="-1"></div><aside class="basket" hidden></aside></div>`;
  const stage = $('.stage', root);
  on(root, 'click', '[data-go]', (e, b) => goToBlock(+b.dataset.go));
  on(root, 'click', '.turn', (e, b) => turn(b.classList.contains('l') ? -1 : 1));
  on(root, 'click', '.blk [data-a]', (e, b) => blockAction(b.dataset.a, +b.closest('.blk').dataset.i));
  on(root, 'click', '.bcb', (e, b) => togglePick(+b.closest('.blk').dataset.i));
  on(root, 'click', '.blk', (e, b) => { if (st().pick && !e.target.closest('button,a,.codeblk')) togglePick(+b.dataset.i); });
  on(root, 'click', '[data-copy]', async (e, b) => {
    const pre = b.closest('.codeblk').querySelector('pre');
    await host.call('clipboard.write', { text: pre.textContent });
    b.classList.add('done'); b.querySelector('span').textContent = t('reader.copied');
    setTimeout(() => { b.classList.remove('done'); b.querySelector('span').textContent = t('reader.copy'); }, 1400);
  });
  on(root, 'click', 'a.lnk', (e, a) => { e.preventDefault(); host.send('sys.openUrl', { url: a.dataset.href }); });
  on(root, 'click', '.basket [data-bk]', (e, b) => basketAction(b.dataset.bk, b));
  on(root, 'click', '.basket .bk .x', (e, b) => togglePick(+b.closest('.bk').dataset.i));
  on(root, 'click', '.basket .bk', (e, b) => { if (!e.target.closest('.x')) goToBlock(+b.dataset.i); });
  const q = $('[data-q]', root);
  q.addEventListener('input', debounce(() => { st().q = q.value; renderOutline(); highlight(); }, 120));
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { q.value = ''; st().q = ''; renderOutline(); highlight(); stage.focus(); } });
  stage.addEventListener('wheel', e => {
    if (e.ctrlKey || st().layout !== 'book') return;
    const page = $('.page', stage);
    if (page && page.scrollHeight > page.clientHeight + 4) return;
    if (Math.abs(e.deltaY) < 30) return;
    wheelTurn(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });
  new ResizeObserver(debounce(() => { if (isShown()) layout(true); }, 120)).observe(stage);
  settings.on('reader', () => { if (isShown()) layout(true); });
  settings.on('zoom', () => { if (isShown()) layout(true); });
  bus.on('lang', () => { if (isShown()) show(docs.active); });
  bus.on('reloaded', tab => { if (tab === rtab && isShown()) show(tab, true); });
}

let wheelLock = 0;
function wheelTurn(dir) { const n = Date.now(); if (n - wheelLock < 450) return; wheelLock = n; turn(dir); }

export const isShown = () => root && !root.hidden;

export function show(tab, force = false) {
  rtab = tab;
  const text = editor.text(tab);
  const key = tab.id + ':' + text.length + ':' + (text.length < 2e5 ? hashLite(text) : '');
  if (force || !model || model.key !== key) { model = { ...parse(text), key }; }
  const s = st();
  $('[data-q]', root).value = s.q || '';
  $('[data-q]', root).placeholder = t('reader.search');
  root.classList.toggle('chat', model.kind === 'chat');
  layout();
  renderBasket();
  bus.emit('reader.change');
}

function hashLite(s) { let h = 0; for (let i = 0; i < s.length; i += 7) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

const GENERIC_USER = /^(вы|you|user|я|me|пользователь|human|человек|вопрос|question|q)$/i;
const GENERIC_BOT = /^(chatgpt сказал|chatgpt said|assistant|ассистент|помощник|ai|ии|model|модель|bot|бот|ответ|answer|a)$/i;
function whoOf(b) {
  if (b.role === 'user') return b.who && !GENERIC_USER.test(b.who) ? b.who : t('reader.you');
  if (b.role === 'assistant') return b.who && !GENERIC_BOT.test(b.who) ? b.who : (model.bot || t('reader.assistant'));
  return '';
}
function avatar(b) {
  if (b.role === 'user') return `<span class="av you">${esc(lang() === 'ru' ? 'ВЫ' : lang() === 'zh' ? '你' : 'YOU')}</span>`;
  const n = whoOf(b);
  return `<span class="av ai">${esc(/gpt/i.test(n) ? 'AI' : n.slice(0, 2).toUpperCase())}</span>`;
}

function blockHTML(b, i) {
  const s = st();
  const picked = s.sel.includes(i);
  if (b.role === 'doc') {
    return `<div class="blk doc ${picked ? 'sel' : ''}" data-i="${i}">${s.pick ? `<span class="bcb ${picked ? 'on' : ''}">${picked ? I('check') : ''}</span>` : ''}<div class="blk-body">${renderMd(b.text)}</div><div class="acts"><button data-a="copy">${I('copy', 'xs')}${esc(t('reader.copy'))}</button><button data-a="pick">${I('square-check', 'xs')}${esc(t(picked ? 'reader.unpick' : 'reader.pickOne'))}</button></div></div>`;
  }
  const time = settings.get('reader.showTime') !== false && b.time ? `<span class="time">${esc(fmtTime(b.time))}</span>` : '';
  return `<div class="blk ${b.role} ${picked ? 'sel' : ''}" data-i="${i}"><div class="blk-h">${s.pick ? `<span class="bcb ${picked ? 'on' : ''}">${picked ? I('check') : ''}</span>` : ''}${avatar(b)}<span class="who">${esc(whoOf(b))}</span>${time}<span class="num">#${i + 1}</span></div><div class="blk-body">${renderMd(b.text)}</div><div class="acts"><button data-a="copy">${I('copy', 'xs')}${esc(t('reader.copy'))}</button><button data-a="pick">${I('square-check', 'xs')}${esc(t(picked ? 'reader.unpick' : 'reader.pickOne'))}</button><button data-a="quote">${I('quote', 'xs')}${esc(t('reader.quote'))}</button></div></div>`;
}

function fmtTime(v) {
  if (typeof v === 'number') return new Date(v).toLocaleString(lang() === 'en' ? 'en-GB' : lang(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return String(v);
}

function title() { return tabName(rtab).replace(/\.(md|markdown|txt|json)$/i, ''); }

// ---------- layout ----------
function layout(keep = false) {
  const s = st();
  const stage = $('.stage', root);
  const firstBlock = keep && pages[s.page] ? pages[s.page][0] : null;
  stage.innerHTML = '';
  stage.classList.toggle('feed', s.layout === 'feed');
  root.classList.toggle('picking', !!s.pick);
  if (!model.blocks.length) {
    stage.innerHTML = `<div class="r-empty">${I('book-open', 'lg')}<b>${esc(t('reader.empty'))}</b><span>${esc(t('reader.emptyHint'))}</span></div>`;
    renderOutline(); renderStats(); return;
  }
  if (s.layout === 'feed') {
    stage.innerHTML = `<div class="feed-col"><div class="page-h"><span>${esc(title())}</span><span class="rule"></span><span>${esc(t(model.kind === 'chat' ? 'reader.nMsgs' : 'reader.nBlocks', { n: model.blocks.length }))}</span></div>${model.blocks.map(blockHTML).join('')}</div>`;
    pages = [model.blocks.map((_, i) => i)];
    s.page = 0;
    const col = $('.feed-col', stage);
    const feedInfo = () => {
      const max = stage.scrollHeight - stage.clientHeight;
      const pct = max > 4 ? Math.round(stage.scrollTop / max * 100) : 100;
      const info = `${t('reader.feed')} · ${pct}%`;
      if (rtab.reader.info !== info) { rtab.reader.info = info; bus.emit('reader.change'); }
    };
    stage.onscroll = debounce(() => { renderOutlineActive(); rtab.reader.scroll = stage.scrollTop; feedInfo(); }, 80);
    if (rtab.reader.scroll) stage.scrollTop = rtab.reader.scroll;
    if (firstBlock != null) col.querySelector(`.blk[data-i="${firstBlock}"]`)?.scrollIntoView({ block: 'start' });
    feedInfo();
  } else {
    stage.onscroll = null;
    paginate(stage);
    if (firstBlock != null) s.page = Math.max(0, pages.findIndex(p => p.includes(firstBlock)));
    s.page = clamp(s.page || 0, 0, pages.length - 1);
    renderPage(false);
  }
  renderOutline();
  renderStats();
  highlight();
}

function paginate(stage) {
  const measure = el(`<div class="stack measure"><div class="page"><div class="page-h"><span>x</span></div>${model.blocks.map(blockHTML).join('')}</div></div>`);
  stage.append(measure);
  const page = $('.page', measure);
  const cs = getComputedStyle(page);
  const avail = stage.clientHeight - 26 - 58 - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - $('.page-h', page).offsetHeight - 22;
  const hs = $$('.blk', page).map(b => b.offsetHeight + 4);
  measure.remove();
  pages = [];
  let cur = [], h = 0;
  hs.forEach((bh, i) => {
    if (cur.length && h + bh > avail) { pages.push(cur); cur = []; h = 0; }
    cur.push(i); h += bh;
  });
  if (cur.length) pages.push(cur);
  if (!pages.length) pages = [[]];
}

function renderPage(anim = true, dir = 1) {
  const s = st();
  const stage = $('.stage', root);
  const idx = pages[s.page] || [];
  const n = pages.length;
  const pct = n > 1 ? Math.round(s.page / (n - 1) * 100) : 100;
  stage.innerHTML = `<div class="stack ${anim && settings.get('animations') !== false ? (dir > 0 ? 'turn-next' : 'turn-prev') : ''}">${n > 1 ? '<div class="under u2"></div><div class="under"></div>' : ''}<div class="page"><div class="page-h"><span>${esc(title())}</span><span class="rule"></span><span>${esc(t('reader.pageOf', { a: s.page + 1, b: n }))}</span></div>${idx.map(i => blockHTML(model.blocks[i], i)).join('')}</div></div>
    <button class="turn l" ${s.page <= 0 ? 'disabled' : ''} title="${esc(t('reader.prev'))} (←)">${I('chevron-left')}</button><button class="turn r" ${s.page >= n - 1 ? 'disabled' : ''} title="${esc(t('reader.next'))} (→)">${I('chevron-right')}</button>
    <div class="prog"><span>${esc(t('reader.pageOf', { a: s.page + 1, b: n }))}</span><div class="bar"><i style="width:${Math.max(2, pct)}%"></i></div><span>${pct}%</span></div>`;
  rtab.reader.info = t('reader.pageOf', { a: s.page + 1, b: n });
  renderOutlineActive();
  highlight();
  bus.emit('reader.change');
}

export function turn(dir) {
  if (!isShown() || st().layout !== 'book') return;
  const s = st();
  const next = clamp(s.page + dir, 0, pages.length - 1);
  if (next === s.page) return;
  s.page = next;
  renderPage(true, dir);
}

export function goToBlock(i) {
  const s = st();
  if (s.layout === 'book') {
    const p = pages.findIndex(pg => pg.includes(i));
    if (p >= 0 && p !== s.page) { const dir = p > s.page ? 1 : -1; s.page = p; renderPage(true, dir); }
  }
  const node = $(`.stage .blk[data-i="${i}"]`, root);
  if (node) { node.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); node.classList.add('flash'); setTimeout(() => node.classList.remove('flash'), 900); }
}

// ---------- outline ----------
function excerpt(text, n = 80) {
  return mdToPlain(text).replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '').replace(/^>[ \t]?/gm, '').replace(/\s+/g, ' ').slice(0, n);
}
function renderOutline() {
  const box = $('.ol', root);
  const q = (st().q || '').toLowerCase();
  let html = '';
  if (model.kind === 'chat') {
    let turnNo = 0;
    model.blocks.forEach((b, i) => {
      if (q && !b.text.toLowerCase().includes(q)) return;
      if (b.role === 'user') turnNo++;
      html += `<button class="mi2 ${b.role}" data-go="${i}"><span class="n">${i + 1}</span><span><span class="who ${b.role === 'user' ? 'y' : 'a'}">${esc(whoOf(b))}</span> ${esc(excerpt(b.text))}</span></button>`;
    });
  } else {
    model.blocks.forEach((b, i) => {
      if (q ? !b.text.toLowerCase().includes(q) : !b.heading) return;
      const lvl = b.heading ? (/^(#+)/.exec(b.text)?.[1].length || 1) : 3;
      html += `<button class="mi2 h${lvl}" data-go="${i}"><span>${esc(b.heading || excerpt(b.text, 60))}</span></button>`;
    });
    if (!html && !q) html = `<div class="ol-empty">${esc(t('reader.noHeadings'))}</div>`;
  }
  if (!html && q) html = `<div class="ol-empty">${esc(t('reader.notFound'))}</div>`;
  box.innerHTML = html;
  renderOutlineActive();
}

function renderOutlineActive() {
  const s = st();
  let on = new Set(pages[s.page] || []);
  if (s.layout === 'feed') {
    const stage = $('.stage', root);
    const top = stage.getBoundingClientRect().top;
    on = new Set();
    for (const b of $$('.blk', stage)) { const r = b.getBoundingClientRect(); if (r.bottom > top + 40 && r.top < top + stage.clientHeight - 40) on.add(+b.dataset.i); }
  }
  let first = null;
  $$('.ol [data-go]', root).forEach(b => { const a = on.has(+b.dataset.go); b.classList.toggle('on', a); if (a && !first) first = b; });
  first?.scrollIntoView({ block: 'nearest' });
}

function renderStats() {
  const words = model.blocks.reduce((n, b) => n + wordCount(b.text), 0);
  const min = Math.max(1, Math.round(words / 180));
  const parts = [];
  if (model.kind === 'chat') {
    parts.push(t('reader.nMsgs', { n: model.blocks.length }));
    parts.push(t('reader.nQuestions', { n: model.blocks.filter(b => b.role === 'user').length }));
  } else parts.push(t('reader.nBlocks', { n: model.blocks.length }));
  parts.push(t('reader.words', { n: words }));
  parts.push(t('reader.minutes', { n: min }));
  $('.stats', root).textContent = parts.join(' · ');
}

// ---------- search highlight ----------
function highlight() {
  const q = st().q;
  const stage = $('.stage', root);
  $$('mark.find', stage).forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
  stage.normalize?.();
  if (!q || q.length < 2) return;
  const lq = q.toLowerCase();
  for (const body of $$('.blk-body', stage)) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) { const n = walker.currentNode; if (n.nodeValue.toLowerCase().includes(lq)) hits.push(n); }
    for (const n of hits) {
      const frag = document.createDocumentFragment();
      const s = n.nodeValue;
      let i = 0, j;
      const ls = s.toLowerCase();
      while ((j = ls.indexOf(lq, i)) >= 0) {
        frag.append(s.slice(i, j));
        const m = document.createElement('mark'); m.className = 'find'; m.textContent = s.slice(j, j + q.length); frag.append(m);
        i = j + q.length;
      }
      frag.append(s.slice(i));
      n.replaceWith(frag);
    }
  }
}

let findPos = -1;
function findNext(dir) {
  const q = (st().q || '').toLowerCase();
  if (!q) return;
  const hits = model.blocks.map((b, i) => (b.text.toLowerCase().includes(q) ? i : -1)).filter(i => i >= 0);
  if (!hits.length) { toast(t('reader.notFound'), { icon: 'search' }); return; }
  findPos = dir > 0 ? (hits.find(i => i > findPos) ?? hits[0]) : ([...hits].reverse().find(i => i < findPos) ?? hits[hits.length - 1]);
  goToBlock(findPos);
}

export function focusSearch() { const q = $('[data-q]', root); q.focus(); q.select(); }

// ---------- picking + copy ----------
export function setLayout(l) { st().layout = l; settings.set('reader.layout', l); layout(true); bus.emit('reader.change'); }
export function togglePickMode(on) {
  const s = st();
  s.pick = on ?? !s.pick;
  if (!s.pick) s.sel = [];
  layout(true); renderBasket(); bus.emit('reader.change');
}
function togglePick(i) {
  const s = st();
  if (!s.pick) s.pick = true;
  s.sel = s.sel.includes(i) ? s.sel.filter(x => x !== i) : [...s.sel, i].sort((a, b) => a - b);
  $$(`.stage .blk[data-i="${i}"]`, root).forEach(n => n.outerHTML = blockHTML(model.blocks[i], i));
  if (!$('.stage .bcb', root)) layout(true);
  renderBasket();
  bus.emit('reader.change');
}

function blockAction(a, i) {
  if (a === 'copy') copyBlocks([i], { quiet: false });
  else if (a === 'pick') togglePick(i);
  else if (a === 'quote') copyBlocks([i], { format: 'quote' });
}

export function compose(indices, o = {}) {
  const c = { ...settings.get('copy'), ...o };
  const parts = indices.map(i => {
    const b = model.blocks[i];
    let body = c.format === 'plain' ? mdToPlain(b.text) : b.text;
    if (c.format === 'quote') body = body.split('\n').map(l => '> ' + l).join('\n');
    let head = '';
    if (c.names !== false && b.role !== 'doc') {
      const who = whoOf(b) + (c.time && b.time ? ` · ${fmtTime(b.time)}` : '');
      head = c.format === 'plain' ? who + ':\n' : `**${who}:**\n`;
      if (c.format === 'quote') head = `> **${who}:**\n`;
    }
    return head + body;
  });
  return parts.join(c.separator !== false ? (c.format === 'plain' ? '\n\n———\n\n' : '\n\n---\n\n') : '\n\n');
}

async function copyBlocks(indices, o = {}) {
  if (!indices.length) return;
  const text = compose(indices, o);
  await host.call('clipboard.write', { text });
  toast(t('reader.copiedN', { n: indices.length }), { sub: t('fmt.' + (o.format || settings.get('copy.format') || 'markdown')) });
}

/** Ctrl+Shift+C */
export function copySelection() {
  if (!isShown()) return false;
  const s = st();
  if (!s.sel.length) { if (!s.pick) togglePickMode(true); toast(t('reader.pickFirst'), { icon: 'square-check' }); return true; }
  copyBlocks(s.sel);
  return true;
}

function renderBasket() {
  const box = $('.basket', root);
  const s = st();
  if (!s.pick) { box.hidden = true; return; }
  box.hidden = false;
  const c = settings.get('copy');
  const items = s.sel.map(i => {
    const b = model.blocks[i];
    return `<div class="card bk" data-i="${i}"><span class="grip">${I('grip-vertical', 'xs')}</span><div class="bd"><div class="t">${b.role !== 'doc' ? `<span class="dotc" style="background:${b.role === 'user' ? 'var(--lav-ink)' : 'var(--teal)'}"></span>${esc(whoOf(b))}` : esc(t('reader.fragment'))}<span class="num">#${i + 1}</span></div><div class="d">${esc(excerpt(b.text, 110))}</div></div><button class="x icon-btn" title="${esc(t('reader.unpick'))}">${I('x', 'xs')}</button></div>`;
  }).join('');
  box.innerHTML = `<div class="bk-h"><b>${esc(t('reader.basket'))}</b><span class="badge b-teal">${s.sel.length}</span><span class="grow"></span><button class="icon-btn" data-bk="close" title="${esc(t('dlg.close'))}">${I('x', 'sm')}</button></div>
    <div class="bk-list">${items || `<div class="bk-empty">${I('square-check', 'lg')}<span>${esc(t('reader.basketEmpty'))}</span></div>`}</div>
    <div class="bk-opts">
      <div class="seg fmt">${['markdown', 'plain', 'quote'].map(f => `<button class="${c.format === f ? 'on' : ''}" data-bk="fmt" data-v="${f}">${esc(t('fmt.' + f))}</button>`).join('')}</div>
      <label class="opt"><span class="tg ${c.names !== false ? 'on' : ''}" data-bk="names"></span>${esc(t('reader.optNames'))}</label>
      <label class="opt"><span class="tg ${c.separator !== false ? 'on' : ''}" data-bk="separator"></span>${esc(t('reader.optSep'))}</label>
      <label class="opt"><span class="tg ${c.time ? 'on' : ''}" data-bk="time"></span>${esc(t('reader.optTime'))}</label>
    </div>
    <div class="bk-foot"><button class="btn primary" data-bk="copy" ${s.sel.length ? '' : 'disabled'}>${I('copy', 'sm')}${esc(t('reader.copyN', { n: s.sel.length }))}<kbd>Ctrl Shift C</kbd></button>
      <div class="row2"><button class="btn ghost sm" data-bk="all">${esc(t('reader.pickAll'))}</button><button class="btn ghost sm" data-bk="doc" ${s.sel.length ? '' : 'disabled'}>${I('file-plus', 'xs')}${esc(t('reader.toDoc'))}</button><button class="btn ghost sm" data-bk="clear" ${s.sel.length ? '' : 'disabled'}>${esc(t('reader.clear'))}</button></div></div>`;
}

function basketAction(a, b) {
  const s = st();
  if (a === 'close') togglePickMode(false);
  else if (a === 'fmt') { settings.set('copy.format', b.dataset.v); renderBasket(); }
  else if (['names', 'separator', 'time'].includes(a)) { const v = settings.get('copy.' + a); settings.set('copy.' + a, a === 'time' ? !v : v === false); renderBasket(); }
  else if (a === 'copy') copyBlocks(s.sel);
  else if (a === 'clear') { s.sel = []; layout(true); renderBasket(); }
  else if (a === 'all') { s.sel = model.blocks.map((_, i) => i); layout(true); renderBasket(); }
  else if (a === 'doc') { const text = compose(s.sel); newDoc({ text, name: t('reader.excerptName', { name: title() }) }); }
}

export function readerKey(e) {
  if (!isShown() || e.target.closest?.('input,textarea')) return false;
  const k = e.key;
  if (st().layout === 'book') {
    if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { turn(1); return true; }
    if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { turn(-1); return true; }
    if (k === 'Home' && !e.ctrlKey) { st().page = 0; renderPage(true, -1); return true; }
    if (k === 'End' && !e.ctrlKey) { st().page = pages.length - 1; renderPage(true, 1); return true; }
  }
  if (e.ctrlKey && !e.shiftKey && e.code === 'KeyF') { focusSearch(); return true; }
  if (e.ctrlKey && !e.shiftKey && e.code === 'KeyA' && st().pick) { basketAction('all'); return true; }
  return false;
}

export function readerInfo() { return model ? { kind: model.kind, blocks: model.blocks.length, pages: pages.length, page: st().page } : null; }
