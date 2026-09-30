// Title bar with tabs, toolbar with menus and mode switches, status bar, banners.
import { $, $$, el, esc, I, LOGO, WINICON, bus, on, basename, shortPath, wordCount, throttle, debounce } from '../util.js';
import { t, lang } from '../i18n.js';
import { settings } from '../settings.js';
import { host } from '../host.js';
import { run, keysOf, prettyKeys } from '../commands.js';
import { docs, tabName, isDirty, activateTab, closeTab, moveTab, encLabel, encName } from '../docs.js';
import { editor } from '../editor/editor.js';
import { langName } from '../editor/langs.js';
import { openMenu, closeMenus, isOpen as menuOpen } from './menu.js';
import { MENUBAR, menuItems, tabMenu, encodingMenu, eolMenu, langMenu, typeMenu } from './menus.js';
import { issuesOf } from '../editor/proof.js';
import { APP } from './settings-ui.js';

const FILE_ICON = { markdown: 'file-text', text: 'file', json: 'file-code', html: 'file-code', css: 'file-code', xml: 'file-code' };
const tabIcon = tab => (tab.view === 'read' ? 'book-open' : FILE_ICON[tab.lang] || (tab.lang ? 'code-xml' : 'file'));

export const win = { maximized: false, active: true, fullscreen: false, topmost: false };

export function buildChrome(root) {
  root.innerHTML = `
    <div class="resize-top" data-edge="top"></div><div class="resize-top l" data-edge="topleft"></div><div class="resize-top r" data-edge="topright"></div>
    <header class="chrome">
      <div class="titlebar drag">
        <div class="brand drag">${LOGO()}<span>Folio</span></div>
        <nav class="tabs drag" id="tabs"></nav>
        <button class="tab-add" data-act="new">${I('plus', 'sm')}</button>
        <div class="tb-gap drag"></div>
        <div class="tb-right">
          <button class="icon-btn" data-act="theme" data-tip="theme"></button>
          <button class="icon-btn" data-act="settings" data-tip="settings">${I('settings')}</button>
          <button class="icon-btn" data-act="pin" data-tip="pin">${I('pin')}</button>
          <div class="winctl"><span data-win="min" title="">${WINICON.min}</span><span data-win="max">${WINICON.max}</span><span class="close" data-win="close">${WINICON.close}</span></div>
        </div>
      </div>
      <div class="toolbar" id="toolbar"></div>
    </header>
    <main class="body" id="body">
      <div id="banners"></div>
      <div class="row" id="row">
        <div class="work" id="work"><div id="ed" class="ed-host"></div><div id="reader" class="reader-host" hidden></div><div class="toc" id="toc" hidden></div></div>
        <div id="side"></div>
      </div>
      <div id="logs"></div>
    </main>
    <footer class="status" id="status"></footer>
    <div id="layer"></div>`;

  wireTitlebar(root);
  on($('#toolbar'), 'click', '[data-cmd]', (e, b) => run(b.dataset.cmd));
  renderTabs();
  renderToolbar();
  renderStatus();
  renderTitleButtons();

  bus.on('tabs', () => { renderTabs(); renderStatus(); });
  bus.on('active', () => { renderTabs(); renderToolbar(); renderStatus(); renderBanners(); });
  bus.on('doc.change', throttle(() => { renderTabsDirty(); renderStatus(); }, 200));
  bus.on('cursor', throttle(() => renderStatus(), 60));
  bus.on('saved', () => { renderTabsDirty(); renderStatus(); });
  bus.on('banner', tab => { if (tab === docs.active) renderBanners(); });
  bus.on('mode', () => { renderToolbar(); renderStatus(); renderTabs(); });
  bus.on('proof.issues', () => renderStatus());
  bus.on('session.saved', () => renderStatus());
  bus.on('lang', () => { renderTabs(); renderToolbar(); renderStatus(); renderBanners(); renderTitleButtons(); });
  bus.on('reader.change', () => { renderToolbar(); renderStatus(); });
  settings.on('theme', renderTitleButtons);
  settings.on('topmost', renderTitleButtons);
  settings.on('statusBar', v => $('#status').hidden = v === false);
  settings.on('zoom', () => renderStatus());
  $('#status').hidden = settings.get('statusBar') === false;
}

// ---------- title bar ----------
function wireTitlebar(root) {
  const tb = $('.titlebar', root);
  // With WebView2 drag regions (CSS app-region) Windows moves the window itself; this is the fallback for old runtimes.
  tb.addEventListener('mousedown', e => {
    if (e.button !== 0 || APP.sys?.nativeDrag) return;
    if (e.target.closest('.tab, .tab-add, .tb-right, button')) return;
    if (!e.target.closest('.drag')) return;
    if (e.detail === 2) { host.send('win.maximize'); return; }
    host.send('win.drag');
  });
  tb.addEventListener('contextmenu', e => {
    if (e.target.closest('.tab')) return;
    if (e.target.closest('.drag')) { e.preventDefault(); if (!APP.sys?.nativeDrag) host.send('win.sysmenu', { x: e.screenX, y: e.screenY }); }
  });
  $$('.resize-top', root).forEach(r => r.addEventListener('mousedown', e => { if (e.button === 0) host.send('win.resize', { edge: r.dataset.edge }); }));
  on(tb, 'click', '[data-win]', (e, b) => {
    const w = b.dataset.win;
    if (w === 'min') host.send('win.minimize');
    else if (w === 'max') host.send('win.maximize');
    else run('app.close');
  });
  on(tb, 'click', '[data-act]', (e, b) => {
    const a = b.dataset.act;
    if (a === 'theme') run('view.themeToggle');
    else if (a === 'settings') run('app.settings');
    else if (a === 'pin') run('view.topmost');
    else if (a === 'new') run('file.new');
  });
  const tabs = $('#tabs');
  on(tabs, 'mousedown', '.tab', (e, b) => {
    const tab = docs.tabs.find(x => x.id === b.dataset.id);
    if (!tab) return;
    if (e.button === 1) { e.preventDefault(); closeTab(tab); return; }
    if (e.button !== 0 || e.target.closest('.x')) return;
    if (tab !== docs.active) activateTab(tab);
    startTabDrag(e, b, tab);
  });
  on(tabs, 'click', '.tab .x', (e, x) => { e.stopPropagation(); const tab = docs.tabs.find(t2 => t2.id === x.closest('.tab').dataset.id); if (tab) closeTab(tab); });
  on(tabs, 'contextmenu', '.tab', (e, b) => {
    e.preventDefault();
    const tab = docs.tabs.find(x => x.id === b.dataset.id);
    if (tab) openMenu(tabMenu(tab), { x: e.clientX, y: e.clientY });
  });
  tabs.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabs.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  tabs.addEventListener('scroll', tabFades, { passive: true });
  window.addEventListener('resize', throttle(tabFades, 100));
}

function startTabDrag(e, node, tab) {
  const x0 = e.clientX;
  let dragging = false;
  const strip = $('#tabs');
  const move = ev => {
    if (!dragging && Math.abs(ev.clientX - x0) < 6) return;
    dragging = true;
    node.classList.add('dragging');
    node.style.transform = `translateX(${ev.clientX - x0}px)`;
    const others = $$('.tab', strip).filter(n => n !== node);
    let idx = 0;
    for (const o of others) { const r = o.getBoundingClientRect(); if (ev.clientX > r.left + r.width / 2) idx++; }
    node.dataset.to = idx;
  };
  const up = () => {
    removeEventListener('mousemove', move);
    removeEventListener('mouseup', up);
    if (dragging) { node.style.transform = ''; node.classList.remove('dragging'); moveTab(tab, +node.dataset.to); }
  };
  addEventListener('mousemove', move);
  addEventListener('mouseup', up);
}

export function renderTabs() {
  const strip = $('#tabs');
  if (!strip) return;
  const html = docs.tabs.map(tab => {
    const on = tab === docs.active;
    const dirty = isDirty(tab);
    const title = tab.path ? tab.path : tabName(tab);
    return `<button class="tab ${on ? 'on' : ''}" data-id="${tab.id}" title="${esc(title)}">${I(tabIcon(tab), 'sm')}<span class="nm">${esc(tabName(tab))}</span>${dirty ? '<i class="dirty"></i>' : ''}<span class="x" title="${esc(t('tab.close'))}">${I('x', 'xs')}</span></button>`;
  }).join('');
  strip.innerHTML = html;
  const add = $('.titlebar .tab-add');
  if (add) add.title = t('menu.new') + ' (Ctrl+N)';
  const act = strip.querySelector('.tab.on');
  act?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  tabFades();
}

// soft edges when some tabs are scrolled out of view
function tabFades() {
  const s = $('#tabs');
  if (!s) return;
  const max = s.scrollWidth - s.clientWidth;
  s.classList.toggle('fade-l', s.scrollLeft > 2);
  s.classList.toggle('fade-r', max - s.scrollLeft > 2);
}

function renderTabsDirty() {
  for (const tab of docs.tabs) {
    const node = document.querySelector(`.tab[data-id="${tab.id}"]`);
    if (!node) continue;
    const d = isDirty(tab);
    const has = node.querySelector('.dirty');
    if (d && !has) node.querySelector('.nm').insertAdjacentHTML('afterend', '<i class="dirty"></i>');
    else if (!d && has) has.remove();
  }
}

export function renderTitleButtons() {
  const th = settings.get('theme');
  const dark = document.documentElement.dataset.dark === '1';
  const b = $('[data-act=theme]');
  if (b) { b.innerHTML = I(dark ? 'moon' : 'sun'); b.title = t('tip.theme'); }
  const s = $('[data-act=settings]'); if (s) s.title = t('tip.settings') + ' (Ctrl+,)';
  const p = $('[data-act=pin]');
  if (p) { p.innerHTML = I(settings.get('topmost') ? 'pin' : 'pin-off'); p.classList.toggle('on', !!settings.get('topmost')); p.title = t('tip.pin') + ' (Ctrl+Alt+T)'; }
  const mx = $('[data-win=max]');
  if (mx) { mx.innerHTML = win.maximized ? WINICON.restore : WINICON.max; mx.title = win.maximized ? t('win.restore') : t('win.maximize'); }
  const mn = $('[data-win=min]'); if (mn) mn.title = t('win.minimize');
  const cl = $('[data-win=close]'); if (cl) cl.title = settings.get('closeToTray') ? t('win.closeTray') : t('win.close');
  document.documentElement.classList.toggle('maximized', win.maximized);
}

// ---------- toolbar ----------
export function renderToolbar() {
  const bar = $('#toolbar');
  if (!bar) return;
  const tab = docs.active;
  const view = tab?.view || 'edit';
  const mode = tab?.mode || 'standard';
  const menus = MENUBAR.map(m => `<button class="mb" data-menu="${m}">${esc(t('mb.' + m))}</button>`).join('');
  const seg1 = `<div class="seg" role="tablist"><button class="${view === 'edit' ? 'on' : ''}" data-cmd="view.edit" title="${esc(t('cmd.view.edit'))} (Ctrl+1)">${I('pen-line', 'sm')}<span>${esc(t('seg.write'))}</span></button><button class="${view === 'read' ? 'on' : ''}" data-cmd="view.read" title="${esc(t('cmd.view.read'))} (Ctrl+2)">${I('book-open', 'sm')}<span>${esc(t('seg.read'))}</span></button></div>`;
  let seg2;
  if (view === 'edit') {
    seg2 = `<div class="seg">${[['standard', 'type', 'Alt+1'], ['coder', 'code', 'Alt+2'], ['proof', 'spell-check', 'Alt+3']].map(([m, ic, k]) => `<button class="${mode === m ? 'on' : ''}" data-cmd="mode.${m}" title="${esc(t('mode.' + m + '.d'))} (${k})">${I(ic, 'sm')}<span>${esc(t('mode.' + m))}</span></button>`).join('')}</div>`;
  } else {
    const r = tab?.reader || {};
    const lay = r.layout || settings.get('reader.layout') || 'book';
    seg2 = `<div class="seg"><button class="${lay === 'book' ? 'on' : ''}" data-cmd="reader.book">${I('book-marked', 'sm')}<span>${esc(t('reader.book'))}</span></button><button class="${lay === 'feed' ? 'on' : ''}" data-cmd="reader.feed">${I('scroll-text', 'sm')}<span>${esc(t('reader.feed'))}</span></button></div><button class="chip-btn ${r.pick ? 'on' : ''}" data-cmd="reader.pick">${I('square-check', 'sm')}<span>${esc(t('reader.pick'))}</span></button>`;
  }
  const aiOn = document.body.classList.contains('ai-open');
  bar.innerHTML = `<nav class="menubar" role="menubar">${menus}</nav><div class="grow drag"></div>${seg1}${seg2}<button class="cmdk" data-cmd="palette">${I('search', 'sm')}<span class="ph">${esc(t('cmdk'))}</span><kbd>Ctrl K</kbd></button><button class="btn primary ai-btn ${aiOn ? 'on' : ''}" data-cmd="ai.panel" title="Ctrl+I">${I('sparkles', 'sm')}<span>${esc(t('ai.btn'))}</span></button>`;
}

let menubarActive = false;
export function openMenubar(name, viaKeyboard = false) {
  const btn = document.querySelector(`.mb[data-menu="${name}"]`);
  if (!btn) return;
  closeMenus();
  btn.classList.add('open');
  menubarActive = true;
  const m = openMenu(menuItems(name), { anchor: btn, cls: 'm-' + name, onClose: () => { btn.classList.remove('open'); menubarActive = false; } });
  btn.classList.add('open');
  if (viaKeyboard) m.querySelector('.mi:not(.dis)')?.classList.add('hot');
  return m;
}
export function menubarNav(dir) {
  const open = document.querySelector('.mb.open');
  if (!open) return;
  const i = MENUBAR.indexOf(open.dataset.menu);
  openMenubar(MENUBAR[(i + dir + MENUBAR.length) % MENUBAR.length], true);
}

document.addEventListener('mousedown', e => {
  const b = e.target.closest('.mb');
  if (!b || e.button !== 0) return;
  e.preventDefault();
  if (b.classList.contains('open')) { closeMenus(); return; }
  openMenubar(b.dataset.menu);
});
document.addEventListener('mouseover', e => {
  const b = e.target.closest('.mb');
  if (b && menubarActive && menuOpen() && !b.classList.contains('open')) openMenubar(b.dataset.menu);
});

// ---------- status bar ----------
let wordsCache = { doc: null, n: 0 };
function words(tab) {
  const d = editor.doc(tab);
  if (wordsCache.doc === d) return wordsCache.n;
  const n = d.length > 3e6 ? -1 : wordCount(d.toString());
  wordsCache = { doc: d, n };
  return n;
}

export function renderStatus() {
  const bar = $('#status');
  const tab = docs.active;
  if (!bar || !tab) return;
  const view = tab.view;
  const mode = view === 'read' ? 'read' : tab.mode;
  const col = { standard: 'var(--teal)', coder: 'var(--accent)', proof: 'var(--coral)', read: 'var(--lav-ink)' }[mode];
  const parts = [];
  parts.push(`<button class="st" data-st="mode"><i class="dot" style="background:${col}"></i>${esc(t(mode === 'read' ? 'seg.read' : 'mode.' + mode))}</button>`);
  if (view === 'edit' && tab === editor.tab) {
    const c = editor.cursorInfo();
    parts.push(`<button class="st" data-st="goto">${esc(t('st.pos', { l: c.line, c: c.col }))}${c.sel ? ` <span class="mut">(${esc(t('st.sel', { n: c.sel }))})</span>` : ''}</button>`);
    const w = words(tab);
    if (w >= 0) parts.push(`<button class="st" data-st="stats">${esc(t('st.words', { n: w }))}</button>`);
    if (tab.mode === 'proof') {
      const n = issuesOf(editor.view.state).length;
      parts.push(`<button class="st ${n ? 'warn' : 'ok'}" data-st="proof">${I('spell-check', 'xs')}${esc(n ? t('st.issues', { n }) : t('st.noIssues'))}</button>`);
    }
  } else if (view === 'read') {
    const r = tab.reader?.info;
    if (r) parts.push(`<span class="st">${esc(r)}</span>`);
  }
  parts.push('<span class="grow"></span>');
  parts.push(`<button class="st" data-st="type">${esc(tab.lang === 'text' ? t('lang.text') : langName(tab.lang))}</button>`);
  parts.push(`<button class="st ${tab.encoding.startsWith('utf-') ? '' : 'hl'}" data-st="enc">${I('file-code', 'xs')}${esc(encLabel(tab))}</button>`);
  parts.push(`<button class="st" data-st="eol">${tab.mixedEol ? esc(t('st.mixed')) : tab.eol.toUpperCase()}</button>`);
  parts.push(`<button class="st" data-st="lang">${I('globe', 'xs')}${esc(lang().toUpperCase())}</button>`);
  const z = settings.get('zoom') || 1;
  const f = Math.max(0, Math.min(100, (z - 0.5) / 2.5 * 100));
  parts.push(`<span class="st zoomctl" data-st="zoom" title="${esc(t('zoom.tip'))}"><button data-z="-">${I('zoom-out', 'xs')}</button><span class="track"><span class="fill" style="width:${f}%"></span><span class="knob" style="left:${f}%"></span></span><button data-z="+">${I('zoom-in', 'xs')}</button><b data-z="0">${Math.round(z * 100)}%</b></span>`);
  const dirty = isDirty(tab);
  if (dirty) {
    const bt = docs.lastBackup ? new Date(docs.lastBackup).toLocaleTimeString(lang() === 'en' ? 'en-GB' : lang(), { hour: '2-digit', minute: '2-digit' }) : '';
    parts.push(`<button class="st unsaved" data-st="save"><i class="dot" style="background:var(--coral)"></i>${esc(t('st.unsaved'))}${bt && settings.get('hotExit') !== false ? ` · ${esc(t('st.backup', { t: bt }))}` : ''}</button>`);
  } else if (tab.path) parts.push(`<span class="st ok">${I('circle-check', 'xs')}${esc(t('st.saved'))}</span>`);
  bar.innerHTML = parts.join('');
}

document.addEventListener('click', e => {
  const s = e.target.closest('#status [data-st]');
  if (!s) return;
  const k = s.dataset.st;
  const z = e.target.closest('[data-z]');
  if (k === 'zoom' && z) { run(z.dataset.z === '+' ? 'view.zoomIn' : z.dataset.z === '-' ? 'view.zoomOut' : 'view.zoomReset'); return; }
  const tab = docs.active;
  const r = s.getBoundingClientRect();
  const at = { x: r.left, y: r.top };
  const up = items => { const m = openMenu(items, { x: at.x, y: at.y - 8 }); const h = m.getBoundingClientRect().height; m.style.top = Math.max(6, r.top - h - 6) + 'px'; };
  if (k === 'mode') up(menuItems('viewmode'));
  else if (k === 'goto') run('edit.goto');
  else if (k === 'stats') run('tools.stats');
  else if (k === 'proof') run('proof.panel');
  else if (k === 'type') up(typeMenu(tab));
  else if (k === 'enc') up(encodingMenu(tab));
  else if (k === 'eol') up(eolMenu(tab));
  else if (k === 'lang') up(langMenu());
  else if (k === 'save') run('file.save');
});

// zoom by dragging the status bar track
document.addEventListener('mousedown', e => {
  const tr = e.target.closest('#status .zoomctl .track');
  if (!tr) return;
  e.preventDefault();
  const set = ev => {
    const r = tr.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const z = Math.round((0.5 + f * 2.5) * 10) / 10;
    run('view.zoomSet', z);
  };
  set(e);
  const up = () => { removeEventListener('mousemove', set); removeEventListener('mouseup', up); };
  addEventListener('mousemove', set);
  addEventListener('mouseup', up);
});

// ---------- banners ----------
export function renderBanners() {
  const box = $('#banners');
  if (!box) return;
  const tab = docs.active;
  const b = tab?.banner;
  if (!b) { box.innerHTML = ''; return; }
  let html = '';
  if (b.kind === 'legacy') {
    const conf = Math.round((tab.confidence || 0) * 100);
    html = `<div class="encbar enter">${I('info', 'sm')}<span>${t('banner.legacy', { enc: `<b>${esc(encName(tab.encoding))}</b>`, conf })}</span><span class="grow"></span><button class="btn primary" data-b="toUtf8">${esc(t('banner.toUtf8'))}</button><button class="btn ghost" data-b="keep">${esc(t('banner.keep', { enc: encName(tab.encoding) }))}</button><button class="btn ghost" data-b="other">${esc(t('banner.other'))}</button><button class="icon-btn" data-b="close" title="${esc(t('dlg.close'))}">${I('x', 'sm')}</button></div>`;
  } else if (b.kind === 'invalid') {
    html = `<div class="encbar warn enter">${I('triangle-alert', 'sm')}<span>${t('banner.invalid', { n: tab.invalid })}</span><span class="grow"></span><button class="btn primary" data-b="other">${esc(t('banner.pickEnc'))}</button><button class="icon-btn" data-b="close">${I('x', 'sm')}</button></div>`;
  } else if (b.kind === 'external') {
    html = `<div class="encbar warn enter">${I('refresh-cw', 'sm')}<span>${esc(t('banner.external'))}</span><span class="grow"></span><button class="btn primary" data-b="reload">${esc(t('banner.reload'))}</button><button class="btn ghost" data-b="mine">${esc(t('banner.keepMine'))}</button></div>`;
  } else if (b.kind === 'deleted') {
    html = `<div class="encbar err enter">${I('triangle-alert', 'sm')}<span>${esc(t('banner.deleted'))}</span><span class="grow"></span><button class="btn primary" data-b="resave">${esc(t('banner.resave'))}</button><button class="btn ghost" data-b="closeTab">${esc(t('banner.closeTab'))}</button></div>`;
  } else if (b.kind === 'mixedEol') {
    html = `<div class="encbar enter">${I('wrap-text', 'sm')}<span>${t('banner.mixedEol', { eol: tab.eol.toUpperCase() })}</span><span class="grow"></span><button class="btn ghost" data-b="eol-crlf">CRLF</button><button class="btn ghost" data-b="eol-lf">LF</button><button class="icon-btn" data-b="close">${I('x', 'sm')}</button></div>`;
  }
  box.innerHTML = html;
}

document.addEventListener('click', async e => {
  const btn = e.target.closest('#banners [data-b]');
  if (!btn) return;
  const tab = docs.active;
  const a = btn.dataset.b;
  const D = await import('../docs.js');
  if (a === 'toUtf8') run('enc.toUtf8');
  else if (a === 'keep' || a === 'close') { tab.banner = null; tab.bannerDismissed = true; renderBanners(); }
  else if (a === 'other') { const r = btn.getBoundingClientRect(); openMenu(encodingMenu(tab, true), { x: r.left, y: r.bottom + 4 }); }
  else if (a === 'reload') { tab.banner = null; await D.reloadTab(tab, null, { silent: true }); renderBanners(); }
  else if (a === 'mine') { tab.banner = null; tab.forceDirty = true; renderBanners(); bus.emit('tabs'); }
  else if (a === 'resave') { tab.banner = null; await D.saveTab(tab); renderBanners(); }
  else if (a === 'closeTab') { tab.banner = null; await D.closeTab(tab, { force: true }); }
  else if (a.startsWith('eol-')) { D.setEol(tab, a.slice(4)); tab.banner = null; renderBanners(); }
});
