// Small DOM + misc helpers shared by all modules.
import ICONS from './icons.gen.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const warned = new Set();
export const I = (n, c = '') => {
  if (n && !ICONS[n] && !warned.has(n)) { warned.add(n); console.warn('icon missing:', n); }
  return `<svg class="i ${c}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
};
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const uid = (p = 't') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const LOGO = (c = 'logo') => `<svg class="${c}" viewBox="0 0 32 32" aria-hidden="true"><path d="M10 3h9.4c.5 0 1 .2 1.4.6l5.6 5.6c.4.4.6.9.6 1.4V24a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5z" fill="var(--primary)"/><path d="M20.2 3.2V8a3 3 0 0 0 3 3h4.6z" fill="var(--teal)"/><path d="M10.6 15.6h10.8M10.6 20h7.6M10.6 24.4h4.6" stroke="var(--on-primary)" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>`;
export const WINICON = {
  min: '<svg viewBox="0 0 10 10"><path d="M0 5.5h10"/></svg>',
  max: '<svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" rx="1.5"/></svg>',
  restore: '<svg viewBox="0 0 10 10"><rect x=".5" y="2.5" width="7" height="7" rx="1.2"/><path d="M2.6 2.4V1.9c0-.8.6-1.4 1.4-1.4h4.1c.8 0 1.4.6 1.4 1.4V6c0 .8-.6 1.4-1.4 1.4h-.5"/></svg>',
  close: '<svg viewBox="0 0 10 10"><path d="M.5.5l9 9M9.5.5l-9 9"/></svg>',
};

/** Creates an element from an HTML string (first element). */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function throttle(fn, ms) {
  let last = 0, t = 0, args;
  return (...a) => {
    args = a;
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
    else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn(...args); }, ms - (now - last)); }
  };
}

export const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : (m >= 2 && m <= 4 && (h < 12 || h > 14)) ? b : c; };

export function basename(p) { if (!p) return ''; const s = p.replace(/[\\/]+$/, ''); const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/')); return i >= 0 ? s.slice(i + 1) : s; }
export function dirname(p) { if (!p) return ''; const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return i >= 0 ? p.slice(0, i) : ''; }
export function extname(p) { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; }
export function shortPath(p, max = 48) {
  if (!p || p.length <= max) return p || '';
  const parts = p.split(/[\\/]/);
  if (parts.length <= 3) return '…' + p.slice(-max);
  let head = parts[0], tail = parts[parts.length - 1];
  for (let i = parts.length - 2; i > 0; i--) {
    const cand = parts[i] + '\\' + tail;
    if ((head + '\\…\\' + cand).length > max) break;
    tail = cand;
  }
  return head + '\\…\\' + tail;
}

export function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

export function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ':' + s.length; }

export function on(target, ev, sel, fn, opts) {
  target.addEventListener(ev, e => {
    const m = e.target.closest?.(sel);
    if (m && target.contains(m)) fn(e, m);
  }, opts);
}

/** Simple event emitter */
export class Emitter {
  constructor() { this.h = new Map(); }
  on(ev, fn) { if (!this.h.has(ev)) this.h.set(ev, new Set()); this.h.get(ev).add(fn); return () => this.h.get(ev)?.delete(fn); }
  emit(ev, ...a) { for (const fn of [...(this.h.get(ev) || [])]) { try { fn(...a); } catch (e) { console.error(e); } } }
}
export const bus = new Emitter();

export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function isMac() { return false; }

export function kbd(keys) {
  if (!keys) return '';
  return keys.split('+').map(k => k.length === 1 ? k.toUpperCase() : k).join('+');
}

export function wordCount(text) {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  let n = m ? m.length : 0;
  // CJK: count characters as words
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g);
  if (cjk) n += cjk.length - (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+/g)?.length || 0);
  return n;
}

export function copyText(text) {
  return import('./host.js').then(m => m.host.call('clipboard.write', { text }));
}
