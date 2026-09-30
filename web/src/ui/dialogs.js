// Modals, confirmations, toasts and the zoom HUD.
import { $, el, esc, I, bus } from '../util.js';
import { t } from '../i18n.js';

const layer = () => $('#layer');
const stack = [];

/** Opens a modal. content: HTML string or element. Returns {el, close, done: Promise} */
export function modal(content, { cls = '', onClose, dismiss = true, label = '' } = {}) {
  const scrim = el('<div class="scrim"></div>');
  const box = el(`<div class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(label)}"></div>`);
  if (typeof content === 'string') box.innerHTML = content; else box.append(content);
  layer().append(scrim, box);
  const prevFocus = document.activeElement;
  let resolve;
  const done = new Promise(r => (resolve = r));
  const api = {
    el: box,
    close(v) {
      if (!box.isConnected) return;
      scrim.remove(); box.remove();
      stack.splice(stack.indexOf(api), 1);
      onClose?.(v);
      resolve(v);
      if (prevFocus?.isConnected) prevFocus.focus?.();
    },
    done,
    dismiss,
  };
  stack.push(api);
  if (dismiss) scrim.addEventListener('mousedown', () => api.close());
  box.addEventListener('click', e => { if (e.target.closest('[data-close]')) api.close(); });
  setTimeout(() => (box.querySelector('[autofocus]') || box.querySelector('.btn.primary') || box.querySelector('input,button'))?.focus(), 30);
  return api;
}

export function topModal() { return stack[stack.length - 1]; }
export function closeTopModal() { const m = topModal(); if (m?.dismiss) { m.close(); return true; } return false; }
export const modalOpen = () => stack.length > 0;

/** Buttons dialog. buttons: [{id, label, primary}] → resolves id (or 'cancel' on Esc) */
export function choose({ title, text = '', icon = 'info', buttons, cls = '' }) {
  const html = `<div class="dlg ${cls}">
    <div class="dlg-h"><span class="dlg-ic">${I(icon)}</span><div class="dlg-t"><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}</div></div>
    <div class="dlg-f">${buttons.map(b => `<button class="btn ${b.primary ? 'primary' : b.danger ? 'danger' : 'ghost'}" data-id="${b.id}">${esc(b.label)}</button>`).join('')}</div></div>`;
  const m = modal(html, { cls: 'm-dlg', label: title });
  m.el.addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) m.close(b.dataset.id); });
  m.el.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const bs = [...m.el.querySelectorAll('.dlg-f .btn')];
      const i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length]?.focus();
    }
  });
  return m.done.then(v => v ?? 'cancel');
}

export async function confirm({ title, text, ok = t('dlg.ok'), cancel = t('dlg.cancel'), icon = 'info', danger = false }) {
  const r = await choose({ title, text, icon, buttons: [{ id: 'ok', label: ok, primary: !danger, danger }, { id: 'cancel', label: cancel }] });
  return r === 'ok';
}

export function prompt({ title, text = '', value = '', placeholder = '', ok = t('dlg.ok'), icon = 'pencil', multiline = false }) {
  const field = multiline ? `<textarea class="inp area" rows="5" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="inp" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false">`;
  const html = `<div class="dlg"><div class="dlg-h"><span class="dlg-ic">${I(icon)}</span><div class="dlg-t"><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}</div></div>
    <div class="dlg-b">${field}</div>
    <div class="dlg-f"><button class="btn primary" data-ok>${esc(ok)}</button><button class="btn ghost" data-close>${esc(t('dlg.cancel'))}</button></div></div>`;
  const m = modal(html, { cls: 'm-dlg', label: title });
  const inp = m.el.querySelector('.inp');
  setTimeout(() => { inp.focus(); inp.select?.(); }, 40);
  m.el.querySelector('[data-ok]').onclick = () => m.close(inp.value);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && (!multiline || e.ctrlKey)) { e.preventDefault(); m.close(inp.value); } });
  return m.done.then(v => (v === undefined ? null : v));
}

// ---- toasts ----
let toastTimer = 0;
export function toast(msg, { sub = '', icon = 'check', ms = 2600, action, kind = 'ok' } = {}) {
  layer().querySelector('.toast')?.remove();
  const tEl = el(`<div class="toast ${kind}" role="status"><span class="ok">${I(icon, 'sm')}</span><span>${esc(msg)}</span>${sub ? `<span class="mut">${esc(sub)}</span>` : ''}${action ? `<button class="toast-act">${esc(action.label)}</button>` : ''}</div>`);
  if (action) tEl.querySelector('.toast-act').onclick = () => { tEl.remove(); action.run(); };
  layer().append(tEl);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { tEl.classList.add('out'); setTimeout(() => tEl.remove(), 250); }, ms);
}

const ERR = { notFound: 'err.notFound', access: 'err.access', readonly: 'err.readonly', tooLarge: 'err.tooLarge', io: 'err.io', network: 'err.network', auth: 'err.auth', timeout: 'err.timeout' };
export function toastError(e, prefix) {
  const code = e?.code;
  const msg = ERR[code] ? t(ERR[code]) : (e?.message || String(e));
  console.warn(prefix || '', e);
  toast(prefix ? `${prefix}: ${msg}` : msg, { icon: 'triangle-alert', kind: 'err', ms: 5000 });
  import('../host.js').then(({ host }) => host.send('log.write', { level: 'error', msg: (prefix ? prefix + ': ' : '') + (e?.message || String(e)) }));
}

// ---- zoom HUD ----
let hudTimer = 0;
export function hud(pct, fill) {
  let h = layer().querySelector('.hud');
  if (!h) {
    h = el(`<div class="hud"><div class="ms">${I('mouse')}</div><div><div class="pct"></div><div class="hint"><span class="kb">Ctrl</span> + ${esc(t('zoom.wheel'))} · <span class="kb">Ctrl</span> <span class="kb">0</span> — 100%</div><div class="tr"><i></i></div></div></div>`);
    layer().append(h);
  }
  h.querySelector('.pct').textContent = pct + '%';
  h.querySelector('.tr i').style.width = fill + '%';
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => { h.classList.add('out'); setTimeout(() => h.remove(), 200); }, 900);
}

bus.on('toast', (msg, o) => toast(msg, o));
