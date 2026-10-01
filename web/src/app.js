// App wiring: command registry, global keyboard, window/host events, close & quit flows, autosave, drag & drop.
import { $, bus, I, esc } from './util.js';
import { host } from './host.js';
import { settings } from './settings.js';
import { t, lang, setLang, pickLang, addLang } from './i18n.js';
import { commands, run, getCommand, commandForEvent, keysOf, normalize, rebuildKeymap, altKeys } from './commands.js';
import { docs, encName, newDoc, openDialog, openPaths, saveTab, saveAll, closeTab, reopenClosed, cycleTab, activateTab, reloadTab, setEncoding, isDirty, tabName, sessionSnapshot, saveSession, confirmClose } from './docs.js';
import { editor } from './editor/editor.js';
import { isProse } from './editor/langs.js';
import * as reader from './reader/reader.js';
import { win, renderTitleButtons, openMenubar, menubarNav } from './ui/chrome.js';
import { openMenu, closeMenus, isOpen as menuOpen, menuKey } from './ui/menu.js';
import { MENUBAR, editorContextMenu } from './ui/menus.js';
import { modalOpen, closeTopModal, toast, toastError, prompt } from './ui/dialogs.js';
import { openPalette, paletteOpen, closePalette } from './ui/palette.js';
import { toggleAi, runTask, acceptAll, rejectAll, hasProposal } from './ui/aipanel.js';
import { toggleProof, fixAll, nextIssue } from './ui/proofpanel.js';
import { sideOpen, openSide, closeSide } from './ui/side.js';
import { toggleLogs, logsOpen } from './ui/logs.js';
import { openSettings, capturing } from './ui/settings-ui.js';
import { openAbout, checkUpdates, reportBug, SITE } from './ui/about.js';
import * as tools from './ui/tools.js';
import { toggleTheme, zoomStep, setZoom } from './theme.js';
import { welcomeText, welcomeName } from './samples.js';

export const app = { primary: true, locale: 'en', quitting: false };

const cur = () => docs.active;
const hasPath = () => !!docs.active?.path;
const editing = () => docs.active?.view !== 'read';
const isUtf = () => !!docs.active?.encoding?.startsWith('utf-');

// ---------------------------------------------------------------- view & mode
export function setView(view) {
  const tab = cur();
  if (!tab) return;
  if (tab.view !== view) {
    if (view === 'read') editor.closeFind();
    tab.view = view;
    bus.emit('mode');
    saveSession();
  }
  applyView(true);
}

function applyView(focus = false) {
  const tab = cur();
  if (!tab) return;
  const read = tab.view === 'read';
  document.body.classList.toggle('reading', read);
  $('#ed').hidden = read;
  $('#reader').hidden = !read;
  if (read) {
    reader.show(tab);
    if (focus) $('#reader .stage')?.focus({ preventScroll: true });
  } else {
    requestAnimationFrame(() => editor.view?.requestMeasure());
    if (focus) editor.focus();
  }
}

export function setMode(mode) {
  const tab = cur();
  if (!tab) return;
  if (tab.view === 'read') { tab.view = 'edit'; applyView(); }
  const prev = tab.mode;
  if (prev !== mode) {
    editor.setMode(tab, mode);
    if (prev === 'proof' && sideOpen('proof')) closeSide();
    if (mode === 'proof' && !sideOpen() && innerWidth >= 960) openSide('proof');
  }
  bus.emit('mode');
  saveSession();
  editor.focus();
}

function setDocLang(id) {
  const tab = cur();
  if (!tab || !id) return;
  editor.setLang(tab, id);
  if (isProse(id) && tab.mode === 'coder') editor.setMode(tab, 'standard');
  else if (!isProse(id) && tab.mode === 'standard') editor.setMode(tab, 'coder');
  bus.emit('mode');
  bus.emit('tabs');
  saveSession();
}

export function openWelcome() {
  const name = welcomeName();
  const ex = docs.tabs.find(x => !x.path && x.name === name);
  if (ex) { activateTab(ex); return ex; }
  const only = docs.tabs.length === 1 ? docs.tabs[0] : null;
  const blank = only && !only.path && editor.doc(only).length === 0 ? only : null;
  const text = welcomeText();
  const tab = newDoc({ name, text, savedText: text, lang: 'markdown', mode: 'standard' });
  if (blank) { docs.tabs.splice(docs.tabs.indexOf(blank), 1); bus.emit('tabs'); saveSession(); }
  setTimeout(() => editor.scrollToTop(), 0);
  return tab;
}

// ---------------------------------------------------------------- clipboard helpers
function domSelectionText() {
  const s = window.getSelection?.();
  if (!s || s.isCollapsed) return '';
  const a = s.anchorNode?.parentElement;
  if (a?.closest?.('.cm-editor')) return '';
  return s.toString();
}

const cleanPaste = s => s
  .replace(/\r\n?/g, '\n')
  .replace(/[\u00A0\u202F\u2007]/g, ' ')
  .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
  .replace(/[\u2028\u2029]/g, '\n')
  .replace(/[ \t]+$/gm, '');

async function copy(cut = false) {
  if (!editing()) {
    const txt = domSelectionText();
    if (txt) await host.call('clipboard.write', { text: txt });
    return;
  }
  const sel = editor.selection();
  if (sel.empty) return;
  await host.call('clipboard.write', { text: sel.text });
  if (cut) editor.replaceSelection('', 'delete.cut');
}

async function paste(plain = false) {
  if (!editing()) return;
  const r = await host.call('clipboard.read').catch(() => null);
  const text = r?.text ?? '';
  if (!text) return;
  editor.replaceSelection(plain ? cleanPaste(text) : text.replace(/\r\n?/g, '\n'), 'input.paste');
}

function selectAll() {
  if (editing()) { editor.selectAll(); return; }
  const stage = $('#reader .stage');
  if (!stage) return;
  const r = document.createRange();
  r.selectNodeContents(stage);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

// ---------------------------------------------------------------- tray / close / quit
function trayAvailable() { return app.primary && settings.get('trayIcon') !== false; }

async function flushSession() {
  if (!app.primary) return;
  saveSession.cancel();
  try { await host.call('session.save', { session: sessionSnapshot(true) }); docs.lastBackup = Date.now(); } catch (e) { console.warn('session', e); }
}

export async function hideToTray() {
  closeMenus();
  if (!trayAvailable()) { host.send('win.minimize'); return; }
  await flushSession();
  settings.flush();
  host.send('win.hide');
  if (!settings.get('trayHintShown')) {
    settings.set('trayHintShown', true);
    host.send('tray.balloon', { title: t('tray.balloonTitle'), text: t('tray.balloonText', { keys: settings.get('hotkeyShow') || '' }) });
  }
}

export function closeWindow() {
  if (trayAvailable() && settings.get('closeToTray') !== false) return hideToTray();
  return quit();
}

/** Quits the app. Hot exit keeps unsaved texts in the session; otherwise asks about each unsaved tab. */
export async function quit({ force = false } = {}) {
  if (app.quitting) return;
  app.quitting = true;
  try {
    closeMenus();
    const hot = app.primary && settings.get('hotExit') !== false;
    if (!hot && !force) {
      for (const tab of [...docs.tabs]) {
        if (!isDirty(tab)) continue;
        host.send('win.show');
        if (!(await confirmClose(tab))) { app.quitting = false; return; }
      }
    }
    if (app.primary) {
      saveSession.cancel();
      await host.call('session.save', { session: sessionSnapshot(true, force) }).catch(e => console.warn('session', e));
      host.send('recent.save', { list: docs.recent });
    }
    settings.flush();
    host.send('app.exit');
  } catch (e) {
    app.quitting = false;
    toastError(e);
  }
}

// ---------------------------------------------------------------- autosave + backups
function autosave(reason) {
  const mode = settings.get('autosave') || 'off';
  if (mode === 'off') return;
  if (reason === 'timer' && mode !== '30s') return;
  for (const tab of docs.tabs) {
    if (!tab.path || tab.readOnly || !isDirty(tab)) continue;
    if (tab.banner && (tab.banner.kind === 'external' || tab.banner.kind === 'deleted')) continue;
    saveTab(tab, { silent: true });
  }
}

let backupTimer = 0;
function scheduleBackup() {
  if (backupTimer) return;
  backupTimer = setTimeout(() => { backupTimer = 0; saveSession(); }, 2000);
}

let lastTitle = '';
function updateTitle() {
  const tab = cur();
  if (!tab) return;
  const title = `${isDirty(tab) ? '● ' : ''}${tabName(tab)} — Folio`;
  if (title === lastTitle) return;
  lastTitle = title;
  host.send('win.setTitle', { title });
}

// ---------------------------------------------------------------- language
const NATIVE_KEYS = ['tray.show', 'tray.quickNote', 'tray.newNote', 'tray.newWindow', 'tray.settings', 'tray.quit', 'tray.tip',
  'qn.title', 'qn.placeholder', 'qn.hint', 'qn.save', 'qn.saved', 'qn.open', 'qn.pin', 'qn.close', 'qn.defaultFile', 'qn.error', 'hk.failed', 'upd.installing',
  'dlg.filterText', 'dlg.filterAll', 'dlg.filterSupported', 'dlg.filterJson',
  'win.minimize', 'win.maximize', 'win.restore', 'win.close',
  'splash.loading', 'splash.slow', 'splash.failed', 'splash.compat', 'splash.restart', 'splash.logs', 'splash.quit'];

export function sendNativeStrings() {
  host.send('app.strings', { lang: lang(), strings: Object.fromEntries(NATIVE_KEYS.map(k => [k, t(k)])) });
}

function applyLang() {
  setLang(pickLang(settings.get('lang'), app.locale));
  bus.emit('lang');
  sendNativeStrings();
  lastTitle = '';
  updateTitle();
}

async function importLang() {
  try {
    const r = await host.call('lang.import');
    if (!r || r.cancelled || !r.code) return;
    addLang(r.code, r.name || r.code, r.table || {});
    settings.set('lang', r.code);
    toast(t('toast.langAdded', { name: r.name || r.code }), { icon: 'languages' });
  } catch (e) { toastError(e); }
}

// ---------------------------------------------------------------- commands
function translateDefault() {
  const txt = editor.selection().text || editor.doc().sliceString(0, 3000);
  const cyr = (txt.match(/[\u0400-\u04FF]/g) || []).length;
  const lat = (txt.match(/[A-Za-z]/g) || []).length;
  if (cyr > lat) return 'English';
  return lang() === 'zh' ? '中文' : lang() === 'en' ? 'Русский' : 'Русский';
}

const COMMANDS = [
  // file
  { id: 'file.new', keys: 'Ctrl+N', icon: 'file-plus', kw: 'new note document', run: () => newDoc() },
  { id: 'file.newWindow', keys: 'Ctrl+Shift+N', icon: 'app-window', run: () => host.send('app.newWindow') },
  { id: 'file.open', keys: 'Ctrl+O', icon: 'folder-open', run: () => openDialog() },
  { id: 'file.save', keys: 'Ctrl+S', icon: 'save', run: () => saveTab() },
  { id: 'file.saveAs', keys: 'Ctrl+Shift+S', icon: 'save', run: () => saveTab(cur(), { as: true }) },
  { id: 'file.saveAll', keys: 'Ctrl+Alt+S', icon: 'save-all', run: () => saveAll() },
  { id: 'file.close', keys: 'Ctrl+W / Ctrl+F4', icon: 'x', run: () => closeTab() },
  { id: 'file.reopenClosed', keys: 'Ctrl+Shift+T', icon: 'rotate-ccw', enabled: () => docs.closed.length > 0, run: () => reopenClosed() },
  { id: 'file.versions', icon: 'history', enabled: hasPath, run: () => tools.versionsDialog() },
  { id: 'file.reveal', icon: 'folder-search', enabled: hasPath, run: () => host.send('file.reveal', { path: cur().path }) },
  { id: 'file.copyPath', icon: 'clipboard-copy', enabled: hasPath, run: async () => { await host.call('clipboard.write', { text: cur().path }); toast(t('toast.pathCopied'), { icon: 'clipboard-check' }); } },
  { id: 'file.print', keys: 'Ctrl+P', icon: 'printer', run: () => tools.printDoc() },
  { id: 'file.nextTab', keys: 'Ctrl+Tab / Ctrl+PageDown', icon: 'arrow-right', palette: false, run: () => cycleTab(1) },
  { id: 'file.prevTab', keys: 'Ctrl+Shift+Tab / Ctrl+PageUp', icon: 'arrow-left', palette: false, run: () => cycleTab(-1) },
  // app
  { id: 'app.tray', keys: 'Esc', icon: 'arrow-down-to-line', enabled: () => app.primary, run: () => hideToTray() },
  { id: 'app.close', icon: 'x', palette: false, run: () => closeWindow() },
  { id: 'app.quit', keys: 'Ctrl+Q', icon: 'power', run: () => quit() },
  { id: 'app.settings', keys: 'Ctrl+,', icon: 'settings', run: sec => openSettings(typeof sec === 'string' ? sec : undefined) },
  { id: 'app.quickNote', icon: 'notebook-pen', kw: 'quick note', run: () => host.send('qn.open') },
  { id: 'app.addLang', icon: 'languages', palette: false, run: () => importLang() },
  { id: 'app.show', icon: 'app-window', palette: false, run: () => host.send('win.show') },
  // edit
  { id: 'edit.undo', keys: 'Ctrl+Z', icon: 'undo-2', native: true, enabled: editing, run: () => editor.undo() },
  { id: 'edit.redo', keys: 'Ctrl+Y / Ctrl+Shift+Z', icon: 'redo-2', native: true, enabled: editing, run: () => editor.redo() },
  { id: 'edit.cut', keys: 'Ctrl+X', icon: 'scissors', native: true, enabled: editing, run: () => copy(true) },
  { id: 'edit.copy', keys: 'Ctrl+C', icon: 'copy', native: 'copy', run: () => copy(false) },
  { id: 'edit.paste', keys: 'Ctrl+V', icon: 'clipboard-paste', native: true, enabled: editing, run: () => paste(false) },
  { id: 'edit.pastePlain', keys: 'Ctrl+Shift+V', icon: 'clipboard-type', native: 'field', enabled: editing, run: () => paste(true) },
  { id: 'edit.find', keys: 'Ctrl+F', icon: 'search', run: () => (editing() ? editor.find(false) : reader.focusSearch()) },
  { id: 'edit.replace', keys: 'Ctrl+H', icon: 'replace', run: () => { if (!editing()) setView('edit'); editor.find(true); } },
  { id: 'edit.goto', keys: 'Ctrl+G', icon: 'arrow-down-to-line', run: () => { if (!editing()) setView('edit'); tools.gotoLineDialog(); } },
  { id: 'edit.selectAll', keys: 'Ctrl+A', icon: 'text-select', native: true, run: () => selectAll() },
  { id: 'edit.insertDate', keys: 'F5', icon: 'calendar-clock', enabled: editing, run: () => tools.insertDate() },
  { id: 'edit.comment', icon: 'message-square-code', enabled: () => editing() && cur()?.mode === 'coder', run: () => editor.toggleComment() },
  // view
  { id: 'view.edit', keys: 'Ctrl+1', icon: 'pen-line', run: () => setView('edit') },
  { id: 'view.read', keys: 'Ctrl+2', icon: 'book-open', run: () => setView('read') },
  { id: 'mode.standard', keys: 'Alt+1', icon: 'type', run: () => setMode('standard') },
  { id: 'mode.coder', keys: 'Alt+2', icon: 'code', run: () => setMode('coder') },
  { id: 'mode.proof', keys: 'Alt+3', icon: 'spell-check', run: () => setMode('proof') },
  { id: 'view.focus', keys: 'F9', icon: 'focus', checked: () => !!settings.get('focusMode'), run: () => settings.toggle('focusMode') },
  { id: 'view.fullscreen', keys: 'F11', icon: 'maximize', checked: () => !!win.fullscreen, run: () => host.send('win.fullscreen', { on: !win.fullscreen }) },
  { id: 'view.topmost', keys: 'Ctrl+Alt+T', icon: 'pin', checked: () => !!settings.get('topmost'), run: () => settings.toggle('topmost') },
  { id: 'view.wrap', keys: 'Alt+Z', icon: 'wrap-text', checked: () => !!settings.get(cur()?.mode === 'coder' ? 'wrapCode' : 'wrap'), run: () => settings.toggle(cur()?.mode === 'coder' ? 'wrapCode' : 'wrap') },
  { id: 'view.lineNumbers', icon: 'list-ordered', checked: () => settings.get(cur()?.mode === 'coder' ? 'lineNumbersCode' : 'lineNumbers') !== false && !!settings.get(cur()?.mode === 'coder' ? 'lineNumbersCode' : 'lineNumbers'), run: () => settings.toggle(cur()?.mode === 'coder' ? 'lineNumbersCode' : 'lineNumbers') },
  { id: 'view.minimap', icon: 'map', checked: () => !!settings.get('minimap'), run: () => settings.toggle('minimap') },
  { id: 'view.toc', icon: 'list-tree', checked: () => settings.get('toc') !== false, run: () => settings.toggle('toc') },
  { id: 'view.statusBar', icon: 'panel-bottom', checked: () => settings.get('statusBar') !== false, run: () => settings.toggle('statusBar') },
  { id: 'view.themeToggle', icon: 'sun-moon', run: () => toggleTheme() },
  { id: 'view.zoomIn', keys: 'Ctrl+Plus / Ctrl+Shift+Plus', icon: 'zoom-in', run: () => zoomStep(1) },
  { id: 'view.zoomOut', keys: 'Ctrl+- / Ctrl+Shift+-', icon: 'zoom-out', run: () => zoomStep(-1) },
  { id: 'view.zoomReset', keys: 'Ctrl+0', icon: 'scan-search', run: () => setZoom(1) },
  { id: 'view.zoomSet', icon: 'zoom-in', palette: false, run: z => setZoom(+z || 1, false) },
  // encoding
  { id: 'enc.toUtf8', icon: 'file-check', enabled: () => !!cur() && !(cur().encoding === 'utf-8' && !cur().bom), run: async () => { const tab = cur(); const old = tab.encoding; setEncoding(tab, 'utf-8', false); if (tab.path && await saveTab(tab)) toast(t('toast.convertedUtf8', { enc: encName(old) }), { icon: 'file-check' }); } },
  { id: 'enc.bom', icon: 'binary', enabled: isUtf, checked: () => !!cur()?.bom, run: () => { const tab = cur(); setEncoding(tab, tab.encoding, !tab.bom); } },
  { id: 'enc.detect', icon: 'scan-search', enabled: hasPath, run: async () => { const tab = cur(); if (isDirty(tab) && !(await confirmReload(tab))) return; await reloadTab(tab, null, { silent: true }); toast(t('toast.detected', { enc: tab.encoding.toUpperCase(), n: Math.round((tab.confidence || 0) * 100) }), { icon: 'scan-search' }); } },
  { id: 'enc.all', icon: 'languages', run: p => tools.encodingsDialog(typeof p === 'string' ? p : 'reopen') },
  // tools
  { id: 'tools.sort', icon: 'arrow-down-a-z', enabled: editing, run: () => tools.sortLines(false) },
  { id: 'tools.sortDesc', icon: 'arrow-up-z-a', enabled: editing, run: () => tools.sortLines(true) },
  { id: 'tools.dedupe', icon: 'list-x', enabled: editing, run: () => tools.dedupe() },
  { id: 'tools.removeEmpty', icon: 'list-minus', enabled: editing, run: () => tools.removeEmpty() },
  { id: 'tools.trim', icon: 'eraser', enabled: editing, run: () => tools.trimSpaces() },
  { id: 'tools.case', icon: 'case-sensitive', palette: false, enabled: editing, run: k => tools.changeCase(k || 'upper') },
  { id: 'tools.upper', icon: 'case-upper', enabled: editing, run: () => tools.changeCase('upper') },
  { id: 'tools.lower', icon: 'case-lower', enabled: editing, run: () => tools.changeCase('lower') },
  { id: 'tools.formatJson', keys: 'Shift+Alt+F', icon: 'braces', enabled: editing, run: () => tools.formatJson() },
  { id: 'tools.compare', icon: 'git-compare', enabled: hasPath, run: () => tools.compareWithSaved() },
  { id: 'tools.stats', icon: 'chart-no-axes-column', run: () => tools.statsDialog() },
  // AI
  { id: 'ai.panel', keys: 'Ctrl+I', icon: 'sparkles', checked: () => sideOpen('ai'), run: () => toggleAi() },
  { id: 'ai.fix', keys: 'Ctrl+Shift+E', icon: 'wand-sparkles', run: () => runTask('fix') },
  { id: 'ai.shorten', icon: 'scissors-line-dashed', run: () => runTask('shorten') },
  { id: 'ai.polite', icon: 'smile', run: () => runTask('polite') },
  { id: 'ai.translate', icon: 'languages', run: arg => runTask('translate', typeof arg === 'string' ? arg : translateDefault()) },
  { id: 'ai.continue', icon: 'pen-tool', run: () => runTask('continue') },
  { id: 'ai.explain', icon: 'lightbulb', run: () => runTask('explain') },
  { id: 'ai.summary', icon: 'list-collapse', run: () => runTask('summary') },
  { id: 'ai.acceptAll', keys: 'Ctrl+Shift+Enter', icon: 'check-check', enabled: hasProposal, run: () => acceptAll() },
  { id: 'ai.rejectAll', keys: 'Ctrl+Shift+Backspace', icon: 'undo-dot', enabled: hasProposal, run: () => rejectAll() },
  { id: 'ai.settings', icon: 'plug-zap', run: () => openSettings('ai') },
  // proofreading
  { id: 'proof.panel', keys: 'F7', icon: 'spell-check-2', checked: () => sideOpen('proof'), run: () => toggleProof() },
  { id: 'proof.next', keys: 'F8', icon: 'arrow-down', enabled: () => editing() && cur()?.mode === 'proof', run: () => nextIssue(1) },
  { id: 'proof.prev', keys: 'Shift+F8', icon: 'arrow-up', enabled: () => editing() && cur()?.mode === 'proof', run: () => nextIssue(-1) },
  { id: 'proof.fixAll', icon: 'wand-sparkles', enabled: () => editing() && cur()?.mode === 'proof', run: () => fixAll() },
  // reader
  { id: 'reader.book', icon: 'book-marked', enabled: () => !editing(), run: () => reader.setLayout('book') },
  { id: 'reader.feed', icon: 'scroll-text', enabled: () => !editing(), run: () => reader.setLayout('feed') },
  { id: 'reader.pick', icon: 'square-check', enabled: () => !editing(), checked: () => !!cur()?.reader?.pick, run: () => reader.togglePickMode() },
  { id: 'reader.copy', keys: 'Ctrl+Shift+C', icon: 'copy-check', enabled: () => !editing(), run: () => reader.copySelection() },
  // misc
  { id: 'palette', keys: 'Ctrl+K / Ctrl+Shift+P', icon: 'search', palette: false, run: () => openPalette() },
  { id: 'doc.setLang', icon: 'code', palette: false, run: id => setDocLang(id) },
  // help
  { id: 'help.keys', keys: 'Ctrl+/', icon: 'keyboard', run: () => tools.keysDialog() },
  { id: 'help.logs', icon: 'scroll-text', checked: () => logsOpen(), run: () => toggleLogs() },
  { id: 'help.welcome', icon: 'hand', run: () => openWelcome() },
  { id: 'help.updates', icon: 'download', run: () => { openAbout(); checkUpdates({ manual: true }); } },
  { id: 'help.report', icon: 'bug', run: () => reportBug() },
  { id: 'help.site', icon: 'globe', run: () => host.send('sys.openUrl', { url: SITE }) },
  { id: 'help.about', icon: 'info', run: () => openAbout() },
];

async function confirmReload(tab) {
  const { confirm } = await import('./ui/dialogs.js');
  return confirm({ title: t('dlg.reloadTitle'), text: t('dlg.reloadText', { name: esc(tabName(tab)) }), ok: t('dlg.reload'), icon: 'refresh-cw', danger: true });
}

// ---------------------------------------------------------------- keyboard
const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const inEditor = e => !!e.target?.closest?.('.cm-editor');
const inField = e => { const n = e.target; return !!n?.closest?.(FIELD) && !n.closest('.cm-content'); };
const stop = e => { e.preventDefault(); e.stopPropagation(); };

function escChain(e) {
  if (modalOpen()) { closeTopModal(); return true; }
  if (editing() && editor.searchOpen()) { editor.closeFind(); editor.focus(); return true; }
  if (editing() && editor.hasFocus()) {
    const s = editor.view.state.selection;
    if (s.ranges.length > 1 || !s.main.empty) return false; // CodeMirror collapses the selection
  }
  if (sideOpen()) { closeSide(); if (editing()) editor.focus(); return true; }
  if (logsOpen()) { toggleLogs(false); return true; }
  if (!editing() && cur()?.reader?.pick) { reader.togglePickMode(false); return true; }
  if (settings.get('focusMode')) { settings.set('focusMode', false); return true; }
  if (win.fullscreen) { host.send('win.fullscreen', { on: false }); return true; }
  const trayKeys = altKeys(keysOf('app.tray')).map(normalize);
  if (settings.get('escToTray') !== false && trayKeys.includes('Esc') && trayAvailable()) { hideToTray(); return true; }
  return false;
}

let altAlone = false;
function onKeyDown(e) {
  if (capturing()) return;
  if (e.isComposing || e.keyCode === 229) return;
  const key = e.key;
  altAlone = key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.repeat;
  if (key === 'Control') document.documentElement.classList.add('ctrl');
  if (menuOpen()) {
    const r = menuKey(e);
    if (r === 'nav+1' || r === 'nav-1') { menubarNav(r === 'nav+1' ? 1 : -1); stop(e); return; }
    if (r) { stop(e); return; }
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) closeMenus();
  }
  if (paletteOpen()) {
    if (commandForEvent(e) === 'palette') { stop(e); closePalette(); }
    return;
  }
  if (key === 'Escape') {
    if (modalOpen()) { closeTopModal(); stop(e); return; }
    if (inField(e)) return;
    if (escChain(e)) stop(e);
    return;
  }
  if (modalOpen()) return;
  if (key === 'F10' && !e.ctrlKey && !e.altKey && !e.shiftKey) { stop(e); openMenubar(MENUBAR[0], true); return; }
  if (!editing() && !inField(e) && reader.readerKey(e)) { stop(e); return; }
  const id = commandForEvent(e);
  if (!id) return;
  const c = getCommand(id);
  if (!c) return;
  if (c.native === true && (inField(e) || inEditor(e))) return;
  if (c.native === 'field' && inField(e)) return;
  if (c.native === 'copy' && (inField(e) || inEditor(e) || domSelectionText())) return;
  if (inField(e) && !e.ctrlKey && !e.altKey && !/^F\d/.test(key)) return;
  if (c.enabled && !c.enabled()) return;
  stop(e);
  run(id);
}

function onKeyUp(e) {
  if (e.key === 'Control') document.documentElement.classList.remove('ctrl');
  if (e.key === 'Alt' && altAlone) {
    altAlone = false;
    if (capturing() || modalOpen() || paletteOpen()) return;
    e.preventDefault();
    if (menuOpen()) closeMenus(); else openMenubar(MENUBAR[0], true);
  }
}

// ---------------------------------------------------------------- drag & drop of files
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
function wireDrop() {
  const setDrop = on => document.body.classList.toggle('dropping', on);
  addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; setDrop(true); }, true);
  addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }, true);
  addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; setDrop(false); } }, true);
  addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    dragDepth = 0; setDrop(false);
    const files = [...e.dataTransfer.files];
    if (files.length && !host.postFiles(files)) toast(t('toast.dropFailed'), { icon: 'triangle-alert', kind: 'err' });
  }, true);
}

// ---------------------------------------------------------------- links (Ctrl+click in the editor)
const URL_RE = /\bhttps?:\/\/[^\s<>()"'`\]]+[^\s<>()"'`\].,;:!?]/g;
function wireLinks() {
  $('#ed').addEventListener('mousedown', e => {
    if (!e.ctrlKey || e.button !== 0 || !editor.view) return;
    const pos = editor.view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return;
    const line = editor.view.state.doc.lineAt(pos);
    for (const m of line.text.matchAll(URL_RE)) {
      const a = line.from + m.index, b = a + m[0].length;
      if (pos >= a && pos <= b) { e.preventDefault(); e.stopPropagation(); host.send('sys.openUrl', { url: m[0] }); return; }
    }
  }, true);
}

// ---------------------------------------------------------------- init
export function initApp() {
  commands(COMMANDS.map(c => ({ title: 'cmd.' + c.id, ...c })));
  addEventListener('keydown', onKeyDown, true);
  addEventListener('keyup', onKeyUp, true);
  addEventListener('blur', () => { altAlone = false; document.documentElement.classList.remove('ctrl'); });
  wireDrop();
  wireLinks();
  $('#app').insertAdjacentHTML('beforeend', `<div class="drop-ov"><div class="drop-card">${I('file-down', 'lg')}<b data-t="drop.title"></b><span data-t="drop.sub"></span></div></div>`);
  const dropText = () => { const ov = $('.drop-ov'); ov.querySelector('b').textContent = t('drop.title'); ov.querySelector('span').textContent = t('drop.sub'); };
  dropText();

  // views follow the active tab
  bus.on('active', () => { applyView(); updateTitle(); if (settings.get('autosave') === 'focus') autosave('switch'); });
  bus.on('doc.change', () => { scheduleBackup(); updateTitle(); });
  bus.on('saved', updateTitle);
  bus.on('tabs', updateTitle);
  bus.on('side', () => $('.ai-btn')?.classList.toggle('on', sideOpen('ai') === true || sideOpen() === 'ai'));
  bus.on('editor.contextmenu', ({ x, y, pos }) => openMenu(editorContextMenu(pos), { x, y }));
  bus.on('lang', dropText);

  settings.on('lang', applyLang);
  settings.on('keys', rebuildKeymap);
  settings.on('topmost', v => host.send('win.topmost', { on: !!v }));
  settings.on('focusMode', v => { document.documentElement.classList.toggle('focus-mode', !!v); bus.emit('mode'); });
  document.documentElement.classList.toggle('focus-mode', !!settings.get('focusMode'));

  // host → app
  host.on('win.state', s => {
    Object.assign(win, s || {});
    const html = document.documentElement;
    html.classList.toggle('inactive', win.active === false);
    html.classList.toggle('fullscreen', !!win.fullscreen);
    renderTitleButtons();
    if (s?.active === false) { closeMenus(); autosave('blur'); }
  });
  host.on('app.open', d => { if (d?.paths?.length) openPaths(d.paths, { encoding: d.encoding || null }); });
  host.on('app.command', d => { if (d?.id) run(d.id, d.arg); });
  host.on('app.closeRequest', () => closeWindow());
  host.on('app.quitRequest', d => quit(d || {}));
  host.on('app.endSession', () => quit({ force: true }));
  host.on('app.visible', d => { if (d && !d.visible) autosave('blur'); });

  setInterval(() => autosave('timer'), 30000);
  addEventListener('beforeunload', () => { if (app.primary && !app.quitting) host.send('session.save', { session: sessionSnapshot(true) }); });
}
