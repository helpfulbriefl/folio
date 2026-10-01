// AI assistant panel: quick actions, chat, proposals shown right in the text (accept / reject each change).
import { EditorView } from '@codemirror/view';
import { $, $$, esc, I, bus, on, wordCount, throttle, debounce } from '../util.js';
import { t } from '../i18n.js';
import { settings } from '../settings.js';
import { host } from '../host.js';
import { docs, tabName } from '../docs.js';
import { editor } from '../editor/editor.js';
import { propose, proposalOf, accept, reject, setProposal } from '../editor/aidiff.js';
import { PROVIDERS, aiState, refreshKey, needsKey, configured, taskPrompt, EDIT_TASKS, complete, cleanEdit, parseEdit, profiles, activeProfile, useProfile, profileLabel, saveKey, loadModels } from '../ai/ai.js';
import { renderMd } from '../reader/md.js';
import { openMenu } from './menu.js';
import { toast, prompt } from './dialogs.js';
import { registerPanel, openSide, closeSide, sideOpen, sideEl } from './side.js';
import { run } from '../commands.js';

const chat = [];
let busy = null;
let ctxMode = null;
const TRANSLATE = [['English', 'English'], ['Русский', 'Russian'], ['中文', 'Simplified Chinese'], ['Deutsch', 'German'], ['Français', 'French'], ['Español', 'Spanish'], ['Italiano', 'Italian'], ['日本語', 'Japanese'], ['한국어', 'Korean'], ['Українська', 'Ukrainian'], ['Türkçe', 'Turkish'], ['Português', 'Portuguese']];

registerPanel('ai', {
  render: fresh => render(fresh),
  onOpen: () => { if (!aiState.checked) refreshKey().then(() => render(false)); setTimeout(() => $('.composer textarea', sideEl())?.focus(), 60); },
  onClose: () => { },
});

export function openAi() { openSide('ai'); }
export function toggleAi() { if (sideOpen('ai')) closeSide(); else openSide('ai'); }

function context(forTask = false) {
  const tab = docs.active;
  if (!tab) return { kind: 'none', from: 0, to: 0, text: '' };
  const sel = tab.view === 'edit' && tab === editor.tab ? editor.selection() : { empty: true };
  let mode = ctxMode || (sel.empty ? (settings.get('ai.context') === 'none' ? 'none' : 'page') : 'selection');
  if (mode === 'selection' && sel.empty) mode = 'page';
  if (forTask && mode === 'none') mode = sel.empty ? 'page' : 'selection';
  if (mode === 'selection') return { kind: 'selection', from: sel.from, to: sel.to, text: sel.text };
  if (mode === 'none') return { kind: 'none', from: 0, to: 0, text: '' };
  const text = editor.text(tab);
  return { kind: 'page', from: 0, to: text.length, text };
}

// ---------- rendering ----------
function render(fresh) {
  const box = sideEl();
  if (!box || !sideOpen('ai')) return;
  const ok = configured();
  const composing = $('.composer textarea', box)?.value || '';
  box.innerHTML = `<div class="panel ai-panel ${fresh ? 'enter' : ''}">
    <div class="panel-h">${I('sparkles')}<span>${esc(t('ai.title'))}</span>${ok ? `<button class="badge b-gray model" data-ai="model" title="${esc(t('ai.profileModel'))}">${profiles().length > 1 ? `<span class="pn">${esc(profileLabel(activeProfile()))}</span>·` : ''}${esc(shortModel(settings.get('ai.model')))}${I('chevron-down', 'xs')}</button>` : ''}<span class="grow"></span>
      <button class="icon-btn" data-ai="new" title="${esc(t('ai.newChat'))}">${I('message-square-plus', 'sm')}</button>
      <button class="icon-btn" data-ai="settings" title="${esc(t('cmd.ai.settings'))}">${I('settings-2', 'sm')}</button>
      <button class="icon-btn" data-ai="close" title="${esc(t('dlg.close'))}">${I('x', 'sm')}</button></div>
    <div class="panel-b ai-b">${ok ? `<div class="card ctx"></div><div class="msgs"></div>` : setupHTML()}</div>
    ${ok ? `<div class="composer"><textarea rows="2" placeholder="${esc(t('ai.placeholder'))}" spellcheck="true"></textarea><div class="bar"><span>${esc(t('ai.hint'))}</span><button class="send" data-ai="send" title="${esc(t('ai.send'))}">${I(busy ? 'square' : 'arrow-up', 'sm')}</button></div></div>` : ''}
  </div>`;
  if (ok) {
    const ta = $('.composer textarea', box);
    ta.value = composing;
    autosize(ta);
    ta.addEventListener('input', () => autosize(ta));
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (busy) stop(); else editor.focus(); }
    });
    renderCtx(); renderMsgs();
  } else wireSetup(box);
}

const shortModel = m => (m || '').replace(/^[\w-]+\//, '');
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(160, Math.max(42, ta.scrollHeight)) + 'px'; }

function renderCtx() {
  const box = $('.ctx', sideEl());
  if (!box) return;
  const c = context();
  const label = c.kind === 'selection' ? t('ai.ctxSel') : c.kind === 'page' ? t('ai.ctxDoc') : t('ai.ctxNone');
  const words = c.text ? t('ai.words', { n: wordCount(c.text) }) : '';
  const chips = [['fix', 'spell-check'], ['shorten', 'minimize-2'], ['polite', 'smile'], ['translate', 'languages'], ['continue', 'pen-line'], ['explain', 'lightbulb'], ['summary', 'list']];
  box.innerHTML = `<div class="top">${I(c.kind === 'selection' ? 'text-select' : c.kind === 'page' ? 'file-text' : 'message-circle', 'sm')}<span>${esc(label)}${words ? ` <span class="mut">· ${esc(words)}</span>` : ''}</span><span class="grow"></span><button class="chip sm" data-ai="ctx">${esc(t('ai.change'))}${I('chevron-down', 'xs')}</button></div>
    <div class="chips">${chips.map(([k, ic]) => `<button class="chip" data-task="${k}">${I(ic, 'xs')}${esc(t('ai.task.' + k))}</button>`).join('')}</div>`;
}

function lastChangeIdx() { for (let i = chat.length - 1; i >= 0; i--) if (chat[i].changes) return i; return -1; }

function msgHTML(m, i) {
  if (m.role === 'user') {
    const ctx = m.ctx && m.ctx !== 'none' ? `<span class="ctxb">${I(m.ctx === 'selection' ? 'text-select' : 'file-text', 'xs')}${esc(t(m.ctx === 'selection' ? 'ai.ctxSel' : 'ai.ctxDoc'))}${m.words ? ` · ${esc(t('ai.words', { n: m.words }))}` : ''}</span>` : '';
    return `<div class="msg-u">${esc(m.text)}${ctx}</div>`;
  }
  let body;
  const think = thinkHTML(m);
  if (m.error) body = think + `<div class="ai-err">${I('triangle-alert', 'sm')}<div><b>${esc(errTitle(m.error))}</b><span>${esc(errText(m.error))}</span></div></div>${m.error.code === 'model' ? `<button class="btn ghost sm" data-ai="model">${I('list', 'xs')}${esc(t('ai.pickModel'))}</button>` : m.error.code === 'auth' || m.error.code === 'config' ? `<button class="btn ghost sm" data-ai="settings">${esc(t('cmd.ai.settings'))}</button>` : `<button class="btn ghost sm" data-ai="retry">${I('rotate-ccw', 'xs')}${esc(t('ai.retry'))}</button>`}`;
  else if (m.pending && (!m.text || EDIT_TASKS.has(m.task))) body = think + `<div class="typing"><i></i><i></i><i></i><span>${esc(t(m.thinking ? 'ai.reasoning' : EDIT_TASKS.has(m.task) ? 'ai.working' : 'ai.thinking'))}${m.progress ? ` · ${m.progress}` : m.thinking && m.think ? ` · ${m.think.length}` : ''}</span></div>`;
  else body = think + `<div class="md">${renderMd(m.text)}</div>` + (m.pending ? '<span class="cursor-blink"></span>' : '');
  const changes = m.changes && i === lastChangeIdx() ? changesHTML(m) : '';
  const tools = !m.pending && !m.error && m.text && !m.changes ? `<div class="msg-tools"><button class="icon-btn xs" data-ai="copyMsg" data-i="${i}" title="${esc(t('reader.copy'))}">${I('copy', 'xs')}</button><button class="icon-btn xs" data-ai="insertMsg" data-i="${i}" title="${esc(t('ai.insert'))}">${I('text-cursor-input', 'xs')}</button></div>` : '';
  return `<div class="msg-a" data-m="${i}"><span class="av ai">AI</span><div class="txt">${body}${changes}${tools}</div></div>`;
}

/** The model's reasoning, folded (open while it is still thinking, if the user wants to watch it). */
function thinkHTML(m) {
  if (!m.think || settings.get('ai.showThinking') === false) return '';
  const open = m.pending && m.thinking && !m.text;
  const tail = m.think.length > 4000 ? '…' + m.think.slice(-4000) : m.think;
  return `<details class="think" ${open || m.thinkOpen ? 'open' : ''} data-think="${chat.indexOf(m)}"><summary>${I('brain', 'xs')}<span>${esc(t(m.pending && m.thinking ? 'ai.reasoning' : 'ai.reasoned'))}</span><span class="mut">· ${m.think.length}</span></summary><div class="think-b">${esc(tail)}</div></details>`;
}

const vis = s => { const x = s.length > 60 ? s.slice(0, 57) + '…' : s; return x.replace(/\n/g, '↵').replace(/^ +| +$| {2,}/g, m => '␣'.repeat(m.length)); };
// whitespace both sides share at the edges is not part of the change: leave it out of the list
function edgeTrim(a, b) {
  if (!a || !b) return [a, b];
  let i = 0, j = 0;
  while (i < a.length && i < b.length && a[i] === b[i] && /\s/.test(a[i])) i++;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j] && /\s/.test(a[a.length - 1 - j])) j++;
  return [a.slice(i, a.length - j), b.slice(i, b.length - j)];
}
function changesHTML(m) {
  if (!editor.view) return '';
  const list = proposalOf(editor.view.state);
  if (!list.length) return m.resolved ? `<div class="chg-done">${I('circle-check', 'xs')}${esc(t(m.resolved === 'accepted' ? 'ai.accepted' : 'ai.rejected'))}</div>` : '';
  const rows = list.slice(0, 8).map(c => { const [o, n] = edgeTrim(c.old, c.insert); return `<div class="chg" data-chg="${c.id}"><span class="dif">${o ? `<s>${esc(vis(o))}</s>` : ''}${o && n ? `<span class="ar">→</span>` : ''}${n ? `<span class="to">${esc(vis(n))}</span>` : ''}</span><span class="yn"><span data-yes="${c.id}" title="${esc(t('ai.accept'))}">${I('check', 'xs')}</span><span data-no="${c.id}" title="${esc(t('ai.reject'))}">${I('x', 'xs')}</span></span></div>`; }).join('');
  const more = list.length > 8 ? `<div class="chg more">${esc(t('ai.more', { n: list.length - 8 }))}</div>` : '';
  return `<div class="card changes">${rows}${more}</div><div class="chg-acts"><button class="btn primary sm" data-ai="acceptAll">${I('check-check', 'xs')}${esc(t('ai.acceptAll'))}</button><button class="btn ghost sm" data-ai="rejectAll">${esc(t('ai.rejectAll'))}</button><span class="kbh">Ctrl+Shift+Enter</span></div>`;
}

function renderMsgs() {
  const box = $('.msgs', sideEl());
  if (!box) return;
  if (!chat.length) {
    box.innerHTML = `<div class="ai-hello">${I('sparkles', 'lg')}<b>${esc(t('ai.helloTitle'))}</b><span>${esc(t('ai.helloText'))}</span></div>`;
    return;
  }
  box.innerHTML = chat.map(msgHTML).join('');
  box.scrollTop = box.scrollHeight;
  const send = $('.composer .send', sideEl());
  if (send) send.innerHTML = I(busy ? 'square' : 'arrow-up', 'sm');
}

const updateLast = throttle(() => {
  const box = $('.msgs', sideEl());
  if (!box) return;
  const i = chat.length - 1;
  const node = box.querySelector(`.msg-a[data-m="${i}"]`);
  if (!node) { renderMsgs(); return; }
  node.outerHTML = msgHTML(chat[i], i);
  box.scrollTop = box.scrollHeight;
}, 60);

function setupHTML() {
  const p = settings.get('ai.provider') || 'openai';
  const P = PROVIDERS[p] || PROVIDERS.custom;
  return `<div class="card setup"><div class="st-h">${I('plug')}<b>${esc(t('ai.setupTitle'))}</b></div><p>${esc(t('ai.setupText'))}</p>
    <div class="frm">
      <label>${esc(t('ai.provider'))}</label><button class="select" data-ai="provider"><span>${esc(p === 'custom' ? t('ai.custom') : P.name)}</span>${I('chevron-down', 'sm')}</button>
      ${p === 'custom' || P.local ? `<label>${esc(t('ai.baseUrl'))}</label><input class="inp" data-f="baseUrl" value="${esc(settings.get('ai.baseUrl') || P.baseUrl)}" spellcheck="false" placeholder="https://…/v1">` : ''}
      ${P.noKey ? '' : `<label>${esc(t('ai.key'))}</label><input class="inp" type="password" data-f="key" placeholder="${esc(aiState.hasKey ? t('ai.keySaved') : 'sk-…')}" autocomplete="off" spellcheck="false">`}
      <label>${esc(t('ai.model'))}</label><input class="inp" data-f="model" value="${esc(settings.get('ai.model') || P.model)}" spellcheck="false">
    </div>
    <div class="row"><button class="btn primary" data-ai="connect">${I('plug-zap', 'sm')}${esc(t('ai.connect'))}</button>${P.keyUrl ? `<button class="btn ghost" data-ai="getKey">${esc(t('ai.getKey'))}${I('external-link', 'xs')}</button>` : ''}</div>
    <p class="note">${I('lock', 'xs')}<span>${esc(t('ai.privacy'))}</span></p></div>`;
}

function wireSetup(box) {
  const inp = $('[data-f=key]', box) || $('[data-f=model]', box);
  setTimeout(() => inp?.focus(), 80);
  box.querySelectorAll('.setup .inp').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); connect(); } }));
}

export function providerMenu(anchor, after) {
  openMenu(Object.entries(PROVIDERS).map(([id, p]) => ({
    label: id === 'custom' ? t('ai.custom') : p.name, note: p.local ? t('ai.local') : '', checked: settings.get('ai.provider') === id,
    run: () => { settings.set('ai.provider', id); if (id !== 'custom') { settings.set('ai.baseUrl', p.baseUrl); settings.set('ai.model', p.model); } refreshKey().then(() => after?.()); },
  })), { anchor });
}

async function connect() {
  const box = sideEl();
  const key = $('[data-f=key]', box)?.value.trim();
  const model = $('[data-f=model]', box)?.value.trim();
  const base = $('[data-f=baseUrl]', box)?.value.trim();
  if (model) settings.set('ai.model', model);
  if (base) settings.set('ai.baseUrl', base.replace(/\/+$/, ''));
  if (key) await saveKey(key);
  if (needsKey() && !aiState.hasKey) { toast(t('ai.enterKey'), { icon: 'key-round', kind: 'err' }); return; }
  render(false);
  toast(t('ai.connected'), { icon: 'plug-zap' });
}

// ---------- actions ----------
function errTitle(e) { return t('aiErr.' + (e.code || 'error') + '.t') !== 'aiErr.' + (e.code || 'error') + '.t' ? t('aiErr.' + (e.code || 'error') + '.t') : t('aiErr.error.t'); }
function errText(e) {
  const k = 'aiErr.' + (e.code || 'error');
  const s = t(k, { model: settings.get('ai.model') });
  return s === k ? (e.message || String(e)) : s + (['http', 'server', 'error', 'model', 'format', 'network'].includes(e.code) ? (e.message ? ` (${e.message})` : '') : '');
}

function stop() { busy?.ctrl.abort(); }

export async function runTask(task, arg) {
  const tab = docs.active;
  if (!tab) return;
  if (!aiState.checked) await refreshKey();
  if (!configured()) { openSide('ai'); toast(t('ai.needSetup'), { icon: 'sparkles' }); return; }
  if (busy) { toast(t('ai.busy'), { icon: 'hourglass' }); return; }
  if (EDIT_TASKS.has(task) && tab.view === 'read') run('view.edit');
  const c = context(true);
  if (!c.text.trim()) { toast(t('ai.emptyText'), { icon: 'info' }); return; }
  const max = settings.get('ai.maxChars') || 60000;
  if (c.text.length > max) { toast(t('ai.tooLong', { n: max }), { icon: 'triangle-alert', kind: 'err', ms: 5000 }); return; }
  openSide('ai');
  const label = t('ai.task.' + task) + (task === 'translate' ? ` → ${arg}` : '');
  chat.push({ role: 'user', text: label, task, ctx: c.kind, words: wordCount(c.text) });
  const msg = { role: 'assistant', text: '', pending: true, task, retry: () => runTask(task, arg) };
  chat.push(msg);
  renderMsgs();
  const ctrl = new AbortController();
  busy = { ctrl, msg };
  const target = TRANSLATE.find(x => x[0] === arg)?.[1] || arg;
  try {
    const r = await complete([{ role: 'system', content: taskPrompt(task, target) }, { role: 'user', content: `<text>\n${c.text}\n</text>` }], {
      signal: ctrl.signal,
      onDelta: s => { if (s) { msg.thinking = false; msg.progress = s.length; } if (!EDIT_TASKS.has(task)) msg.text = s; updateLast(); },
      onThink: (s, open) => { msg.think = s; msg.thinking = open !== false && !msg.progress; updateLast(); },
    });
    msg.think = r.thoughts || msg.think; msg.thinking = false;
    if (EDIT_TASKS.has(task)) {
      const view = editor.view;
      if (docs.active !== tab || view.state.sliceDoc(c.from, c.from + c.text.length) !== c.text) throw { code: 'changed' };
      if (task === 'continue') {
        let out = r.text.replace(/^\s+/, '').replace(/\s+$/, '');
        const sep = /\n\s*$/.test(c.text) ? '' : '\n\n';
        showProposal(c.from + c.text.length, '', sep + out + (/\n$/.test(c.text) ? '\n' : ''), msg, true);
      } else showProposal(c.from, c.text, cleanEdit(r.text, c.text), msg, task === 'translate');
    } else msg.text = r.text;
  } catch (e) {
    if (e?.code === 'cancelled' || ctrl.signal.aborted) { msg.text = t('ai.stopped'); msg.stopped = true; }
    else msg.error = e;
  } finally {
    msg.pending = false; msg.thinking = false; busy = null; renderMsgs();
  }
}

function showProposal(base, oldText, newText, msg, whole = false) {
  const view = editor.view;
  if (oldText === newText) { msg.text = t(msg.task === 'fix' ? 'ai.noErrors' : 'ai.noChanges'); return; }
  let changes;
  if (whole) {
    changes = [{ id: 1, from: base, to: base + oldText.length, insert: newText, old: oldText }];
    view.dispatch({ effects: [setProposal.of({ changes, meta: { task: msg.task } }), EditorView.scrollIntoView(base, { y: 'center' })] });
    bus.emit('ai.proposal', changes);
  } else changes = propose(view, base, oldText, newText, { task: msg.task });
  msg.changes = true;
  msg.text = t('ai.proposed', { n: changes.length });
}

async function send() {
  const box = sideEl();
  const ta = $('.composer textarea', box);
  if (busy) { stop(); return; }
  const text = ta.value.trim();
  if (!text) return;
  const tab = docs.active;
  const c = context();
  if (c.text.length > (settings.get('ai.maxChars') || 60000)) { toast(t('ai.tooLong', { n: settings.get('ai.maxChars') || 60000 }), { icon: 'triangle-alert', kind: 'err' }); return; }
  ta.value = ''; autosize(ta);
  const history = chat.filter(m => !m.error && !m.pending && !m.stopped && m.text && (m.task === 'chat')).slice(-8).map(m => ({ role: m.role, content: m.raw || m.text }));
  chat.push({ role: 'user', text, ctx: c.kind, words: c.text ? wordCount(c.text) : 0, task: 'chat' });
  const msg = { role: 'assistant', text: '', pending: true, task: 'chat', retry: null };
  chat.push(msg);
  renderMsgs();
  const ctrl = new AbortController();
  busy = { ctrl, msg };
  const doc = c.kind === 'none' ? '' : `<document name="${tabName(tab).replace(/"/g, '')}" part="${c.kind === 'selection' ? 'selected fragment' : 'whole document'}">\n${c.text}\n</document>\n\n`;
  msg.retry = () => { ta.value = text; chat.splice(chat.indexOf(msg) - 1, 2); send(); };
  try {
    const r = await complete([{ role: 'system', content: taskPrompt('chat') }, ...history, { role: 'user', content: doc + text }], {
      signal: ctrl.signal,
      onDelta: s => { if (s) msg.thinking = false; const cut = s.indexOf('<folio-edit>'); msg.text = cut >= 0 ? s.slice(0, cut) + `\n\n_${t('ai.preparingEdit')}_` : s; updateLast(); },
      onThink: (s, open) => { msg.think = s; msg.thinking = open !== false && !msg.text; updateLast(); },
    });
    msg.think = r.thoughts || msg.think; msg.thinking = false;
    msg.raw = r.text;
    const ed = parseEdit(r.text);
    if (ed && c.kind !== 'none') {
      const view = editor.view;
      if (docs.active !== tab || view.state.sliceDoc(c.from, c.from + c.text.length) !== c.text) throw { code: 'changed' };
      showProposal(c.from, c.text, cleanEdit(ed.text, c.text), msg);
      if (ed.note) msg.text = ed.note + '\n\n' + msg.text;
    } else msg.text = r.text.replace(/<\/?folio-edit>/g, '');
  } catch (e) {
    if (e?.code === 'cancelled' || ctrl.signal.aborted) { msg.text = (msg.text || '') + `\n\n_${t('ai.stopped')}_`; msg.stopped = true; }
    else msg.error = e;
  } finally { msg.pending = false; msg.thinking = false; busy = null; renderMsgs(); }
}

export function acceptAll() {
  const v = editor.view; if (!v || !proposalOf(v.state).length) return false;
  const n = accept(v); const m = chat[lastChangeIdx()]; if (m) m.resolved = 'accepted';
  toast(t('ai.acceptedN', { n }), { icon: 'check-check' }); renderMsgs(); return true;
}
export function rejectAll() {
  const v = editor.view; if (!v || !proposalOf(v.state).length) return false;
  reject(v); const m = chat[lastChangeIdx()]; if (m) m.resolved = 'rejected'; renderMsgs(); return true;
}
export const hasProposal = () => !!editor.view && proposalOf(editor.view.state).length > 0;

document.addEventListener('click', async e => {
  const box = sideEl();
  if (!box || !box.contains(e.target) || !sideOpen('ai')) return;
  const b = e.target.closest('[data-ai],[data-task],[data-yes],[data-no],.chg[data-chg]');
  if (!b) return;
  if (b.dataset.task) {
    if (b.dataset.task === 'translate') openMenu(TRANSLATE.map(([n]) => ({ label: n, run: () => runTask('translate', n) })), { anchor: b });
    else runTask(b.dataset.task);
    return;
  }
  if (b.dataset.yes) { accept(editor.view, [+b.dataset.yes]); if (!hasProposal()) { const m = chat[lastChangeIdx()]; if (m) m.resolved = 'accepted'; } renderMsgs(); return; }
  if (b.dataset.no) { reject(editor.view, [+b.dataset.no]); if (!hasProposal()) { const m = chat[lastChangeIdx()]; if (m) m.resolved = 'rejected'; } renderMsgs(); return; }
  if (b.dataset.chg) { const c = proposalOf(editor.view.state).find(x => x.id === +b.dataset.chg); if (c) editor.view.dispatch({ effects: EditorView.scrollIntoView(c.from, { y: 'center' }) }); return; }
  const a = b.dataset.ai;
  if (a === 'close') closeSide();
  else if (a === 'new') { if (busy) stop(); chat.length = 0; ctxMode = null; if (hasProposal()) reject(editor.view); renderMsgs(); renderCtx(); }
  else if (a === 'settings') run('ai.settings');
  else if (a === 'send') send();
  else if (a === 'acceptAll') acceptAll();
  else if (a === 'rejectAll') rejectAll();
  else if (a === 'retry') { const m = chat.find(x => x.error && x === chat[chat.length - 1]); if (m?.retry) { chat.splice(chat.length - 2, 2); m.retry(); } }
  else if (a === 'copyMsg') { await host.call('clipboard.write', { text: chat[+b.dataset.i].text }); toast(t('toast.copied')); }
  else if (a === 'insertMsg') { if (docs.active?.view === 'read') run('view.edit'); editor.replaceSelection(chat[+b.dataset.i].text); }
  else if (a === 'ctx') {
    const sel = editor.tab === docs.active ? editor.selection() : { empty: true };
    openMenu([
      { label: t('ai.ctxSel'), icon: 'text-select', disabled: sel.empty, checked: context().kind === 'selection', run: () => { ctxMode = 'selection'; renderCtx(); } },
      { label: t('ai.ctxDoc'), icon: 'file-text', checked: context().kind === 'page', run: () => { ctxMode = 'page'; renderCtx(); } },
      { label: t('ai.ctxNone'), icon: 'message-circle', checked: context().kind === 'none', run: () => { ctxMode = 'none'; renderCtx(); } },
      '-', { label: t('ai.ctxAuto'), checked: !ctxMode, run: () => { ctxMode = null; renderCtx(); } },
    ], { anchor: b, alignRight: true });
  } else if (a === 'model') {
    const items = [];
    const list = profiles();
    if (list.length > 1) {
      items.push({ h: t('ai.profiles') });
      const act = activeProfile();
      list.forEach(p => items.push({ label: profileLabel(p), note: shortModel(p.model), checked: p.id === act?.id, run: async () => { await useProfile(p.id); render(false); toast(t('set.profSwitched', { name: profileLabel(p) }), { icon: 'sparkles' }); } }));
      items.push('-');
    }
    items.push({ h: t('ai.model') });
    let models = [];
    try { models = [...await loadModels()]; } catch { }
    const cur = settings.get('ai.model');
    if (cur && !models.includes(cur)) models.unshift(cur);
    models.slice(0, 60).forEach(m => items.push({ label: m, checked: m === cur, run: () => { settings.set('ai.model', m); render(false); } }));
    items.push('-', { icon: 'pencil', label: t('ai.otherModel'), run: async () => { const v = await prompt({ title: t('ai.model'), value: cur }); if (v) { settings.set('ai.model', v.trim()); render(false); } } },
      { icon: 'settings-2', label: t('ai.manageProfiles'), run: () => run('ai.settings') });
    openMenu(items, { anchor: b, cls: 'font-dd' });
  } else if (a === 'provider') providerMenu(b, () => render(false));
  else if (a === 'connect') connect();
  else if (a === 'getKey') { const P = PROVIDERS[settings.get('ai.provider')]; if (P?.keyUrl) host.send('sys.openUrl', { url: P.keyUrl }); }
});

// remember only the user's own clicks (a re-render with [open] also fires 'toggle')
document.addEventListener('click', e => { const d = e.target.closest?.('details.think > summary')?.parentElement; if (d && chat[+d.dataset.think]) chat[+d.dataset.think].thinkOpen = !d.open; }, true);

bus.on('cursor', debounce(() => { if (sideOpen('ai')) renderCtx(); }, 150));
bus.on('active', () => { if (sideOpen('ai')) { ctxMode = null; renderCtx(); renderMsgs(); } });
bus.on('ai.proposal', debounce(() => { if (sideOpen('ai')) renderMsgs(); }, 30));
bus.on('ai.clickChange', id => {
  if (!sideOpen('ai')) openSide('ai');
  const row = $(`.chg[data-chg="${id}"]`, sideEl());
  if (row) { row.scrollIntoView({ block: 'nearest' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 900); }
});
bus.on('lang', () => { if (sideOpen('ai')) render(false); });
settings.on('ai', () => { if (sideOpen('ai')) render(false); });
