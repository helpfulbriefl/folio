// Right-hand side panel host (AI assistant, proofreading). One panel at a time.
import { $, bus } from '../util.js';

const panels = new Map();
let current = null;

export function registerPanel(id, { render, onOpen, onClose }) { panels.set(id, { render, onOpen, onClose }); }
export const sideEl = () => $('#side');
export const sideOpen = id => (id ? current === id : current);

export function openSide(id, opts) {
  const p = panels.get(id);
  if (!p) return;
  if (current && current !== id) panels.get(current)?.onClose?.();
  const fresh = current !== id;
  current = id;
  document.body.classList.remove('ai-open', 'proof-open');
  document.body.classList.add(id + '-open');
  p.render(fresh);
  if (fresh) p.onOpen?.(opts);
  bus.emit('side', id);
}

export function closeSide() {
  if (!current) return;
  panels.get(current)?.onClose?.();
  document.body.classList.remove(current + '-open');
  current = null;
  sideEl().innerHTML = '';
  bus.emit('side', null);
}

export function toggleSide(id) { if (current === id) closeSide(); else openSide(id); }
export function rerenderSide() { if (current) panels.get(current)?.render(false); }
