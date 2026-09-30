// Right-edge outline for Markdown in the editor: short dashes that expand into a heading list on hover.
import { $, esc, bus, throttle, debounce } from '../util.js';
import { settings } from '../settings.js';
import { docs } from '../docs.js';
import { editor } from '../editor/editor.js';

let heads = [];

export function initToc() {
  const box = $('#toc');
  const refresh = debounce(render, 250);
  bus.on('doc.change', refresh);
  bus.on('active', render);
  bus.on('mode', render);
  bus.on('side', render);
  settings.on('toc', render);
  settings.on('focusMode', render);
  bus.on('cursor', throttle(markActive, 120));
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-h]');
    if (!b) return;
    const h = heads[+b.dataset.h];
    if (h) { editor.gotoPos(h.from); }
  });
  editor.view.scrollDOM.addEventListener('scroll', throttle(markActive, 100), { passive: true });
  render();
}

function render() {
  const box = $('#toc');
  const tab = docs.active;
  const md = tab && (tab.lang === 'markdown' || (tab.lang === 'text' && settings.get('markdownInTxt')));
  const show = tab && tab.view === 'edit' && tab.mode !== 'coder' && md && settings.get('toc') !== false && !settings.get('focusMode');
  heads = show ? editor.headings(tab).filter(h => h.level <= 3).slice(0, 80) : [];
  box.hidden = heads.length < 2;
  if (box.hidden) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="toc-in">${heads.map((h, i) => `<button class="th l${h.level}" data-h="${i}"><i></i><span>${esc(h.text)}</span></button>`).join('')}</div>`;
  markActive();
}

function markActive() {
  const box = $('#toc');
  if (box.hidden || !heads.length || !editor.view) return;
  const view = editor.view;
  const top = view.scrollDOM.scrollTop + 60;
  let pos;
  try { pos = view.lineBlockAtHeight(top).from; } catch { pos = view.state.selection.main.head; }
  let cur = 0;
  heads.forEach((h, i) => { if (h.from <= pos) cur = i; });
  box.querySelectorAll('.th').forEach((b, i) => b.classList.toggle('on', i === cur));
}
