// Dropdown menus (menubar, context menus, submenus) with keyboard navigation.
import { $, el, esc, I } from '../util.js';
import { run, keysOf, prettyKeys, getCommand, titleOf } from '../commands.js';

/*
 item: '-' | {h: 'Header'} | {html: '...'} |
       {cmd:'id', label?, icon?, keys?, checked?, disabled?, sub?: () => items, subCls?, run?: fn, note?, two?: 'description', cls?}
*/
let openStack = [];   // [{el, items, anchor, parentIndex}]
let onCloseAll = null;

export function isOpen() { return openStack.length > 0; }

export function closeMenus() {
  for (const m of openStack) m.el.remove();
  openStack = [];
  document.querySelectorAll('.mb.open').forEach(b => b.classList.remove('open'));
  const cb = onCloseAll; onCloseAll = null; cb?.();
}

function resolve(it) {
  if (it === '-' || it.h || it.html) return it;
  const c = it.cmd ? getCommand(it.cmd) : null;
  return {
    ...it,
    label: it.label ?? (c ? titleOf(c) : ''),
    icon: it.icon ?? c?.icon ?? '',
    keys: it.keys ?? (c ? prettyKeys(keysOf(c.id)) : ''),
    checked: typeof it.checked === 'function' ? it.checked() : it.checked ?? (c?.checked ? c.checked() : undefined),
    disabled: typeof it.disabled === 'function' ? it.disabled() : it.disabled ?? (c?.enabled ? !c.enabled() : false),
  };
}

function itemHTML(it, i) {
  if (it === '-') return '<div class="sep"></div>';
  if (it.h) return `<div class="mh">${esc(it.h)}</div>`;
  if (it.html) return it.html;
  const icon = it.checked === true ? I('check') : it.icon ? I(it.icon) : '<span class="ic0"></span>';
  const label = it.two ? `<span class="lbl">${esc(it.label)}<small>${esc(it.two)}</small></span>` : `<span class="lbl">${esc(it.label)}${it.group ? `<span class="grp">${esc(it.group)}</span>` : ''}</span>`;
  const right = it.sub ? `<span class="arr">${I('chevron-right', 'sm')}</span>` : it.right ? it.right : it.note ? `<span class="note">${esc(it.note)}</span>` : it.keys ? `<span class="kb2">${esc(it.keys)}</span>` : '';
  const sw = it.swatch ? `<span class="sw" style="background:${it.swatch}"></span>` : '';
  return `<div class="mi ${it.two ? 'two' : ''} ${it.checked ? 'chk' : ''} ${it.disabled ? 'dis' : ''} ${it.cls || ''}" data-i="${i}" role="menuitem" ${it.disabled ? 'aria-disabled="true"' : ''}>${icon}${sw}${label}${right}</div>`;
}

function build(items, cls = '') {
  const list = (typeof items === 'function' ? items() : items).filter(Boolean).map(resolve);
  const m = el(`<div class="dd ${cls}" role="menu">${list.map(itemHTML).join('')}</div>`);
  return { el: m, items: list };
}

function place(m, x, y, alignRight = false, parentRect = null) {
  const L = $('#layer');
  L.append(m);
  const r = m.getBoundingClientRect();
  const W = innerWidth, H = innerHeight;
  let left = alignRight ? x - r.width : x, top = y;
  if (parentRect) {
    left = parentRect.right - 4;
    if (left + r.width > W - 6) left = parentRect.left - r.width + 4;
    top = parentRect.top - 6;
  }
  if (left + r.width > W - 6) left = Math.max(6, W - r.width - 6);
  if (top + r.height > H - 6) top = Math.max(6, H - r.height - 6);
  m.style.left = Math.max(6, left) + 'px';
  m.style.top = top + 'px';
  m.style.maxHeight = (H - 12) + 'px';
}

function activate(level, idx) {
  const m = openStack[level];
  if (!m) return;
  m.el.querySelectorAll('.mi.hot').forEach(x => x.classList.remove('hot'));
  m.hot = idx;
  const node = m.el.querySelector(`.mi[data-i="${idx}"]`);
  if (node) { node.classList.add('hot'); node.scrollIntoView({ block: 'nearest' }); }
}

function openSub(level, idx) {
  // close deeper menus
  while (openStack.length > level + 1) openStack.pop().el.remove();
  const parent = openStack[level];
  const it = parent.items[idx];
  if (!it?.sub || it.disabled) return;
  const node = parent.el.querySelector(`.mi[data-i="${idx}"]`);
  const sub = build(it.sub, 'sub ' + (it.subCls || ''));
  wire(sub, openStack.length);
  openStack.push({ ...sub, hot: -1, parentIdx: idx });
  place(sub.el, 0, 0, false, node.getBoundingClientRect());
  it.onSubOpen?.(sub.el);
}

function exec(level, idx) {
  const m = openStack[level];
  const it = m?.items[idx];
  if (!it || it.disabled || it === '-' || it.h || it.html) return;
  if (it.sub) { openSub(level, idx); activate(level + 1, firstEnabled(openStack[level + 1], 0, 1)); return; }
  closeMenus();
  if (it.run) it.run(); else if (it.cmd) run(it.cmd, it.arg);
}

function firstEnabled(m, from, dir) {
  if (!m) return -1;
  const n = m.items.length;
  for (let k = 0, i = from; k < n; k++, i = (i + dir + n) % n) {
    const it = m.items[i];
    if (it && it !== '-' && !it.h && !it.html && !it.disabled) return i;
  }
  return -1;
}

let subTimer = 0;
function wire(m, level) {
  m.el.addEventListener('mousemove', e => {
    const node = e.target.closest('.mi[data-i]');
    if (!node) return;
    const idx = +node.dataset.i;
    const cur = openStack[level];
    if (!cur || cur.hot === idx) return;
    activate(level, idx);
    clearTimeout(subTimer);
    subTimer = setTimeout(() => {
      if (cur.items[idx]?.sub) openSub(level, idx);
      else while (openStack.length > level + 1) openStack.pop().el.remove();
    }, cur.items[idx]?.sub ? 90 : 160);
  });
  m.el.addEventListener('mousedown', e => e.preventDefault());
  m.el.addEventListener('click', e => {
    const node = e.target.closest('.mi[data-i]');
    if (node) exec(level, +node.dataset.i);
  });
}

/** Opens a menu at a position or under an anchor element. */
export function openMenu(items, { x = 0, y = 0, anchor = null, cls = '', onClose, alignRight = false } = {}) {
  closeMenus();
  const m = build(items, 'main ' + cls);
  wire(m, 0);
  openStack.push({ ...m, hot: -1 });
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    place(m.el, alignRight ? r.right : r.left, r.bottom + 4, alignRight);
  } else place(m.el, x, y);
  onCloseAll = onClose || null;
  return m.el;
}

export function menuKey(e) {
  if (!openStack.length) return false;
  const level = openStack.length - 1;
  const m = openStack[level];
  const key = e.key;
  if (key === 'Escape') {
    if (openStack.length > 1) { openStack.pop().el.remove(); }
    else closeMenus();
    return true;
  }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const dir = key === 'ArrowDown' ? 1 : -1;
    activate(level, firstEnabled(m, m.hot < 0 ? (dir > 0 ? 0 : m.items.length - 1) : (m.hot + dir + m.items.length) % m.items.length, dir));
    return true;
  }
  if (key === 'ArrowRight') {
    if (m.items[m.hot]?.sub) { openSub(level, m.hot); activate(level + 1, firstEnabled(openStack[level + 1], 0, 1)); return true; }
    bus.dispatchMenuNav?.(1);
    return 'nav+1';
  }
  if (key === 'ArrowLeft') {
    if (level > 0) { openStack.pop().el.remove(); return true; }
    return 'nav-1';
  }
  if (key === 'Enter' || key === ' ') { if (m.hot >= 0) exec(level, m.hot); return true; }
  if (key.length === 1) {
    // jump by first letter
    const k = key.toLowerCase();
    const start = m.hot + 1;
    for (let d = 0; d < m.items.length; d++) {
      const i = (start + d) % m.items.length;
      const it = m.items[i];
      if (it?.label && !it.disabled && it.label.toLowerCase().startsWith(k)) { activate(level, i); return true; }
    }
    return true;
  }
  return false;
}
const bus = {};

document.addEventListener('mousedown', e => {
  if (!openStack.length) return;
  if (e.target.closest('.dd') || e.target.closest('.mb')) return;
  closeMenus();
}, true);
window.addEventListener('blur', () => closeMenus());
window.addEventListener('resize', () => closeMenus());
