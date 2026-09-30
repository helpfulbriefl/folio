// Proofreading side panel + the popover that appears when clicking an underlined word.
import { $, esc, I, bus, debounce } from '../util.js';
import { t } from '../i18n.js';
import { settings } from '../settings.js';
import { editor } from '../editor/editor.js';
import { issuesOf, issueAt, applyIssue, applyAll, ignoreWord, addToDictionary, removeIssue, missingLanguages } from '../editor/proof.js';
import { registerPanel, openSide, closeSide, sideOpen, sideEl } from './side.js';
import { openMenu } from './menu.js';
import { toast } from './dialogs.js';
import { docs } from '../docs.js';
import { run } from '../commands.js';

let activeFrom = -1;

registerPanel('proof', { render: fresh => render(fresh) });

export function toggleProof() {
  if (sideOpen('proof')) { closeSide(); return; }
  const tab = docs.active;
  if (tab && (tab.view !== 'edit' || tab.mode !== 'proof')) run('mode.proof');
  openSide('proof');
}

const LANG_NAMES = { 'ru-RU': 'русский', 'en-US': 'English (US)', 'en-GB': 'English (UK)', 'uk-UA': 'українська', 'de-DE': 'Deutsch', 'fr-FR': 'français', 'es-ES': 'español' };

function render(fresh) {
  const box = sideEl();
  if (!box || !sideOpen('proof')) return;
  const view = editor.view;
  const issues = view ? issuesOf(view.state) : [];
  const fixable = issues.filter(i => i.sugg?.length).length;
  const missing = missingLanguages();
  const scroll = $('.issues', box)?.scrollTop || 0;
  const spell = issues.filter(i => i.kind === 'spell').length;
  box.innerHTML = `<div class="panel proof-panel ${fresh ? 'enter' : ''}">
    <div class="panel-h">${I('spell-check')}<span>${esc(t('proof.title'))}</span><span class="badge ${issues.length ? 'b-coral' : 'b-teal'}">${issues.length}</span><span class="grow"></span><button class="icon-btn" data-pf="close" title="${esc(t('dlg.close'))}">${I('x', 'sm')}</button></div>
    <div class="panel-b">
      ${missing.length ? `<div class="card note-card">${I('info', 'sm')}<div><b>${esc(t('proof.missingTitle'))}</b><p>${esc(t('proof.missingText', { langs: missing.map(l => LANG_NAMES[l] || l).join(', ') }))}</p></div></div>` : ''}
      ${issues.length ? `<div class="pf-sum"><span><span class="dotc" style="background:var(--coral)"></span>${esc(t('proof.nSpell', { n: spell }))}</span><span><span class="dotc" style="background:var(--accent)"></span>${esc(t('proof.nPunct', { n: issues.length - spell }))}</span></div>
        <button class="btn primary" data-pf="all" ${fixable ? '' : 'disabled'}>${I('wand-sparkles', 'sm')}${esc(t('proof.fixAll', { n: fixable }))}</button>`
      : `<div class="empty-ok">${I('circle-check', 'lg')}<b>${esc(t('proof.clean'))}</b><span>${esc(t('proof.cleanHint'))}</span></div>`}
      <div class="issues">${issues.slice(0, 300).map(issueHTML).join('')}</div>
      <div class="pf-foot">${esc(t('proof.langs'))}: ${esc((settings.get('spellLangs') || []).join(', '))} · <button class="lnkbtn" data-pf="settings">${esc(t('proof.settings'))}</button></div>
    </div></div>`;
  const list = $('.issues', box);
  if (list) list.scrollTop = scroll;
}

function issueHTML(i) {
  const s0 = i.sugg?.[0];
  const show = v => (v === '' ? '∅' : v.replace(/^ +| +$| {2,}/g, m => '␣'.repeat(m.length)));
  return `<div class="card issue ${i.from === activeFrom ? 'on' : ''}" data-iss="${i.from}:${i.to}">
    <div class="w"><span class="dotc" style="background:${i.kind === 'spell' ? 'var(--coral)' : 'var(--accent)'}"></span>${i.word != null ? `<s>${esc(show(i.word))}</s>` : ''}${s0 != null ? `<span class="ar">→</span><span class="to">${esc(show(s0))}</span>` : ''}</div>
    <div class="m">${esc(i.msg || t('proof.spelling'))}${i.sugg?.length > 1 ? ` · ${esc(t('proof.alts'))}: ${i.sugg.slice(1, 4).map(x => esc(show(x))).join(', ')}` : ''}</div>
    <div class="acts">${s0 != null ? `<button class="btn primary sm" data-fix>${esc(t('proof.fix'))}</button>` : ''}<button class="btn ghost sm" data-skip>${esc(t('proof.skip'))}</button>${i.kind === 'spell' ? `<button class="btn ghost sm icon-btn" data-dict title="${esc(t('proof.addDict'))}" aria-label="${esc(t('proof.addDict'))}">${I('book-plus')}</button>` : ''}</div></div>`;
}

function findIssue(key) {
  const [a, b] = key.split(':').map(Number);
  return issuesOf(editor.view.state).find(i => i.from === a && i.to === b);
}

document.addEventListener('click', e => {
  const box = sideEl();
  if (!box?.contains(e.target) || !sideOpen('proof')) return;
  const pf = e.target.closest('[data-pf]');
  if (pf) {
    const a = pf.dataset.pf;
    if (a === 'close') closeSide();
    else if (a === 'all') fixAll();
    else if (a === 'settings') run('app.settings', 'proof');
    return;
  }
  const card = e.target.closest('.issue');
  if (!card) return;
  const issue = findIssue(card.dataset.iss);
  if (!issue) return;
  const view = editor.view;
  if (e.target.closest('[data-fix]')) applyIssue(view, issue);
  else if (e.target.closest('[data-skip]')) { ignoreWord(issue.word || ''); removeIssue(view, issue); }
  else if (e.target.closest('[data-dict]')) { addToDictionary(issue.word); removeIssue(view, issue); toast(t('proof.added', { w: issue.word }), { icon: 'book-marked' }); }
  else { activeFrom = issue.from; editor.gotoPos(issue.from, issue.to); render(false); }
});

export function fixAll() {
  try { const n = applyAll(editor.view); if (n) toast(t('proof.fixedN', { n }), { icon: 'wand-sparkles' }); }
  catch (e) { console.warn(e); toast(t('proof.fixAllFailed'), { icon: 'triangle-alert', kind: 'err' }); }
}

/** F8: jump to the next issue after the cursor */
export function nextIssue(dir = 1) {
  const view = editor.view;
  const issues = issuesOf(view.state);
  if (!issues.length) { toast(t('proof.clean'), { icon: 'circle-check' }); return; }
  const pos = view.state.selection.main.head;
  const sorted = [...issues].sort((a, b) => a.from - b.from);
  const next = dir > 0 ? sorted.find(i => i.from > pos) || sorted[0] : [...sorted].reverse().find(i => i.to < pos) || sorted[sorted.length - 1];
  activeFrom = next.from;
  editor.gotoPos(next.from, next.to);
  if (sideOpen('proof')) render(false);
}

// popover over an underlined word
bus.on('proof.click', ({ pos, x, y }) => {
  const view = editor.view;
  if (pos == null) return;
  const issue = issueAt(view.state, pos);
  if (!issue) return;
  const rect = view.coordsAtPos(issue.from);
  const items = [{ h: issue.kind === 'spell' ? t('proof.spellingOf', { w: issue.word }) : issue.msg }];
  if (issue.sugg?.length) issue.sugg.slice(0, 5).forEach((s, i) => items.push({ label: s === ' ' ? '␣' : s === '' ? '∅' : s, cls: i === 0 ? 'first' : '', icon: i === 0 ? 'wand-sparkles' : '', keys: i === 0 ? 'Enter' : '', run: () => applyIssue(view, issue, s) }));
  else items.push({ label: t('proof.noSugg'), disabled: true });
  items.push('-', { icon: 'eye-off', label: t('proof.skip'), run: () => { ignoreWord(issue.word || ''); removeIssue(view, issue); } });
  if (issue.kind === 'spell') items.push({ icon: 'book-marked', label: t('proof.addDict'), run: () => { addToDictionary(issue.word); removeIssue(view, issue); } });
  const m = openMenu(items, { x: rect ? rect.left - 8 : x, y: rect ? rect.bottom + 6 : y + 14, cls: 'pp-menu' });
  m.querySelector('.mi.first')?.classList.add('hot');
});

bus.on('proof.issues', debounce(() => { if (sideOpen('proof')) render(false); }, 60));
bus.on('lang', () => { if (sideOpen('proof')) render(false); });
bus.on('active', () => { if (sideOpen('proof')) render(false); });
