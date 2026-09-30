// Command palette (Ctrl+K): commands, open tabs, recent files; ":" go to line, "@" headings.
import { $, el, esc, I, basename, dirname, shortPath } from '../util.js';
import { t, LANGS } from '../i18n.js';
import { allCommands, titleOf, keysOf, prettyKeys, run } from '../commands.js';
import { docs, tabName, activateTab, openPaths } from '../docs.js';
import { editor } from '../editor/editor.js';

let pal = null;

export const paletteOpen = () => !!pal;
export function closePalette() { if (!pal) return; pal.scrim.remove(); pal.box.remove(); pal = null; editor.focus(); }

function score(q, s) {
  if (!q) return 1;
  s = s.toLowerCase();
  const i = s.indexOf(q);
  if (i >= 0) return 100 - i + (i === 0 || /[\s./\\-]/.test(s[i - 1]) ? 50 : 0);
  let si = 0, sc = 0, prev = -2;
  for (const ch of q) {
    const j = s.indexOf(ch, si);
    if (j < 0) return 0;
    sc += j === prev + 1 ? 6 : (j === 0 || /[\s./\\-]/.test(s[j - 1])) ? 4 : 1;
    prev = j; si = j + 1;
  }
  return sc;
}

// folders only count as a plain substring: fuzzy matching over a long path finds almost anything
const inPath = (q, p) => (q && p && p.toLowerCase().includes(q) ? 30 : 0);

function items(query) {
  const q = query.trim();
  if (q.startsWith(':')) {
    const [l, c] = q.slice(1).split(/[:,]/).map(x => parseInt(x, 10));
    const n = editor.lineCount();
    return [{ group: t('pal.goto'), icon: 'arrow-right', label: l ? t('pal.gotoLine', { l, n }) : t('pal.gotoHint', { n }), run: () => { if (l) { if (docs.active?.view === 'read') run('view.edit'); editor.gotoLine(l, c || 1); } } }];
  }
  if (q.startsWith('@')) {
    const qq = q.slice(1).trim().toLowerCase();
    return editor.headings().filter(h => !qq || h.text.toLowerCase().includes(qq)).slice(0, 60).map(h => ({ group: t('pal.headings'), icon: 'hash', label: h.text, note: 'H' + h.level, run: () => { if (docs.active?.view === 'read') run('view.edit'); editor.gotoPos(h.from); } }));
  }
  const onlyCmds = q.startsWith('>');
  const qq = (onlyCmds ? q.slice(1) : q).trim().toLowerCase();
  const out = [];
  const en = LANGS.en;
  for (const c of allCommands()) {
    if (c.palette === false) continue;
    if (c.enabled && !c.enabled()) continue;
    const title = titleOf(c);
    const alt = (en[c.title || c.id] || '') + ' ' + (c.kw || '');
    const s = Math.max(score(qq, title), score(qq, alt) * 0.8);
    if (s <= 0) continue;
    out.push({ group: t('pal.commands'), icon: c.icon || 'terminal', label: title, keys: prettyKeys(keysOf(c.id)), s, checked: c.checked?.(), run: () => run(c.id) });
  }
  if (!onlyCmds) {
    for (const tab of docs.tabs) {
      const name = tabName(tab);
      const s = Math.max(score(qq, name), inPath(qq, tab.path));
      if (s > 0 && qq) out.push({ group: t('pal.tabs'), icon: 'file-text', label: name, note: tab.path ? shortPath(dirname(tab.path), 40) : '', s: s + 20, run: () => activateTab(tab) });
    }
    for (const r of docs.recent) {
      if (docs.tabs.some(x => x.path && x.path.toLowerCase() === r.path.toLowerCase())) continue;
      const s = Math.max(score(qq, basename(r.path)), inPath(qq, r.path));
      if (s > 0) out.push({ group: t('pal.recent'), icon: 'history', label: basename(r.path), note: shortPath(dirname(r.path), 40), s: qq ? s + 10 : 0.5, run: () => openPaths([r.path]) });
    }
  }
  if (qq) out.sort((a, b) => b.s - a.s);
  else out.sort((a, b) => (a.group === b.group ? 0 : a.group === t('pal.recent') ? 1 : -1));
  return out.slice(0, qq ? 40 : 60);
}

export function openPalette(initial = '') {
  if (pal) { closePalette(); return; }
  const scrim = el('<div class="scrim pal-scrim"></div>');
  const box = el(`<div class="pal" role="dialog" aria-label="${esc(t('cmd.palette'))}">
    <div class="pal-in">${I('search')}<input spellcheck="false" autocomplete="off" placeholder="${esc(t('pal.placeholder'))}"><kbd class="kb">Esc</kbd></div>
    <div class="pal-l" role="listbox"></div>
    <div class="pal-f"><span><kbd class="kb">↑</kbd><kbd class="kb">↓</kbd>${esc(t('pal.nav'))}</span><span><kbd class="kb">Enter</kbd>${esc(t('pal.run'))}</span><span><kbd class="kb">&gt;</kbd>${esc(t('pal.cmdOnly'))}</span><span><kbd class="kb">:</kbd>${esc(t('pal.line'))}</span><span><kbd class="kb">@</kbd>${esc(t('pal.head'))}</span></div></div>`);
  $('#layer').append(scrim, box);
  pal = { scrim, box, list: [], hot: 0 };
  const inp = $('input', box);
  const listEl = $('.pal-l', box);
  const draw = () => {
    pal.list = items(inp.value);
    pal.hot = Math.min(pal.hot, Math.max(0, pal.list.length - 1));
    let g = '';
    listEl.innerHTML = pal.list.length ? pal.list.map((it, i) => {
      const head = it.group !== g ? `<div class="mh">${esc((g = it.group))}</div>` : '';
      return head + `<div class="mi ${i === pal.hot ? 'hot' : ''} ${it.checked ? 'chk' : ''}" data-i="${i}" role="option">${I(it.checked ? 'check' : it.icon)}<span class="lbl">${esc(it.label)}</span>${it.note ? `<span class="note">${esc(it.note)}</span>` : ''}${it.keys ? `<span class="kb2">${esc(it.keys)}</span>` : ''}</div>`;
    }).join('') : `<div class="pal-empty">${esc(t('pal.nothing'))}</div>`;
    listEl.querySelector('.mi.hot')?.scrollIntoView({ block: 'nearest' });
  };
  const exec = i => { const it = pal?.list[i]; if (!it) return; closePalette(); it.run(); };
  inp.addEventListener('input', () => { pal.hot = 0; draw(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = pal.list.length; if (n) { pal.hot = (pal.hot + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; draw(); } }
    else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); pal.hot = Math.max(0, Math.min(pal.list.length - 1, pal.hot + (e.key === 'PageDown' ? 8 : -8))); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); exec(pal.hot); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
  });
  listEl.addEventListener('mousemove', e => { const m = e.target.closest('.mi[data-i]'); if (m && +m.dataset.i !== pal.hot) { pal.hot = +m.dataset.i; listEl.querySelectorAll('.mi.hot').forEach(x => x.classList.remove('hot')); m.classList.add('hot'); } });
  listEl.addEventListener('mousedown', e => e.preventDefault());
  listEl.addEventListener('click', e => { const m = e.target.closest('.mi[data-i]'); if (m) exec(+m.dataset.i); });
  scrim.addEventListener('mousedown', closePalette);
  inp.value = initial;
  draw();
  setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 10);
}
