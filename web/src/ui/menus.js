// Menu definitions (menubar, submenus, context menus). Items reference commands by id.
import { esc, I, basename, dirname, shortPath } from '../util.js';
import { t, lang, LANG_NAMES } from '../i18n.js';
import { settings } from '../settings.js';
import { host } from '../host.js';
import { docs, openPaths, setEncoding, setEol, reloadTab, saveTab, pinRecent, clearRecent, encName, isDirty, closeTab, closeOthers, activateTab, removeRecent } from '../docs.js';
import { editor } from '../editor/editor.js';
import { LANGS as CODE_LANGS, langName } from '../editor/langs.js';
import { run } from '../commands.js';
import { issueAt, applyIssue, ignoreWord, addToDictionary, removeIssue } from '../editor/proof.js';

export const MENUBAR = ['file', 'edit', 'view', 'enc', 'tools', 'ai', 'help'];

export const REOPEN_ENCODINGS = [
  ['utf-8', 'g.unicode'], ['utf-16le', 'g.unicode'], ['windows-1251', 'g.cyr'], ['cp866', 'g.cyrDos'], ['koi8-r', 'g.cyrUnix'], ['iso-8859-5', 'g.cyrIso'],
  ['windows-1252', 'g.west'], ['windows-1250', 'g.central'], ['gb18030', 'g.zh'], ['big5', 'g.zhTrad'], ['shift_jis', 'g.ja'], ['euc-kr', 'g.ko'],
];
export const SAVE_ENCODINGS = [['utf-8', false], ['utf-8', true], ['utf-16le', true], ['utf-16be', true], ['windows-1251', false], ['cp866', false], ['koi8-r', false], ['windows-1252', false], ['gb18030', false], ['big5', false], ['shift_jis', false]];

export const THEMES = [
  ['paper', '#FDFCFA'], ['graphite', '#1F2024'], ['sepia', '#F2E6CC'], ['glass', 'linear-gradient(135deg,#7DAEFF,#C492FF,#FF9DC0)'],
];

const tab = () => docs.active;

function recentItems() {
  const list = docs.recent;
  if (!list.length) return [{ label: t('menu.noRecent'), disabled: true, icon: 'history' }];
  const row = r => ({
    icon: /\.(md|markdown)$/i.test(r.path) ? 'file-text' : 'file',
    label: basename(r.path), two: shortPath(dirname(r.path), 54), cls: 'rf-mi',
    right: `<span class="rt"><span class="badge ${r.encoding && !r.encoding.startsWith('utf-') ? 'b-amber' : 'b-gray'}">${esc(encName(r.encoding || 'utf-8'))}</span></span>${r.pinned ? `<span class="pin">${I('pin', 'xs')}</span>` : ''}`,
    run: () => openPaths([r.path]),
  });
  const pinned = list.filter(r => r.pinned), rest = list.filter(r => !r.pinned);
  const items = [];
  if (pinned.length) items.push({ h: t('menu.pinned') }, ...pinned.map(row));
  if (rest.length) items.push({ h: t('menu.recent') }, ...rest.slice(0, 15).map(row));
  items.push('-', { icon: settings.get('restoreSession') !== false ? 'check' : '', checked: settings.get('restoreSession') !== false, label: t('menu.restoreSession'), run: () => settings.toggle('restoreSession') });
  items.push({ icon: 'trash-2', label: t('menu.clearRecent'), run: () => clearRecent() });
  return items;
}

function saveEncItems() {
  const cur = tab();
  return SAVE_ENCODINGS.map(([id, bom]) => ({
    label: encName(id) + (bom && id === 'utf-8' ? ' ' + t('enc.withBom') : ''),
    checked: cur && cur.encoding === id && (!!cur.bom === bom || !id.startsWith('utf-')),
    run: async () => { setEncoding(cur, id, bom); await saveTab(cur, { encoding: id, bom }); },
  })).concat(['-', { icon: 'search', label: t('menu.allEncodings'), run: () => run('enc.all', 'save') }]);
}

export function reopenItems(forBanner = false) {
  const cur = tab();
  const scores = new Map((cur?.candidates || []).map(c => [c.key ?? c.Key ?? c[0], c.value ?? c.Value ?? c[1]]));
  let best = null, bestScore = 0;
  for (const [k, v] of scores) if (v > bestScore) { best = k; bestScore = v; }
  const items = [{ html: `<div class="mh mh2"><span>${esc(t('menu.reopenAs'))}</span><span>${esc(t('menu.preview'))}</span></div>` }];
  for (const [id, g] of REOPEN_ENCODINGS) {
    items.push({
      label: encName(id), group: t(g), cls: 'encrow-mi' + (id === best ? ' good' : ''),
      checked: cur?.encoding === id,
      right: `<span class="pv" data-pv="${id}">…</span>`,
      run: () => reloadTab(cur, id),
    });
  }
  items.push('-', { icon: 'search', label: t('menu.allEncodings'), run: () => run('enc.all', 'reopen') });
  return items;
}

async function fillPreviews(menuEl) {
  const cur = tab();
  if (!cur?.path) { menuEl.querySelectorAll('[data-pv]').forEach(x => (x.textContent = '')); return; }
  try {
    const list = await host.call('file.previews', { path: cur.path, ids: REOPEN_ENCODINGS.map(x => x[0]) });
    for (const p of list) {
      const node = menuEl.querySelector(`[data-pv="${p.id}"]`);
      if (!node) continue;
      node.textContent = p.preview || '—';
      node.title = p.preview;
      node.closest('.mi')?.classList.toggle('bad', p.bad > 0);
    }
  } catch { menuEl.querySelectorAll('[data-pv]').forEach(x => (x.textContent = '')); }
}

function themeItems() {
  const cur = settings.get('theme');
  return [
    ...THEMES.map(([id, sw]) => ({ label: t('theme.' + id), swatch: sw, checked: cur === id, run: () => settings.set('theme', id) })),
    '-',
    { icon: 'monitor', label: t('theme.system'), note: t('theme.systemNote'), checked: cur === 'system', run: () => settings.set('theme', 'system') },
    { icon: 'sparkle', label: t('theme.smooth'), checked: settings.get('smoothTheme') !== false, run: () => settings.toggle('smoothTheme') },
  ];
}

function viewModeItems() {
  const cur = tab();
  const v = cur?.view, m = cur?.mode;
  return [
    { h: t('menu.viewH') },
    { cmd: 'view.edit', two: t('cmd.view.edit.d'), checked: v === 'edit', icon: '' },
    { cmd: 'view.read', two: t('cmd.view.read.d'), checked: v === 'read', icon: '' },
    '-',
    { h: t('menu.modeH') },
    { cmd: 'mode.standard', two: t('mode.standard.d'), checked: v === 'edit' && m === 'standard', icon: '' },
    { cmd: 'mode.coder', two: t('mode.coder.d'), checked: v === 'edit' && m === 'coder', icon: '' },
    { cmd: 'mode.proof', two: t('mode.proof.d'), checked: v === 'edit' && m === 'proof', icon: '' },
    '-',
    { cmd: 'view.focus' },
    { cmd: 'view.fullscreen' },
  ];
}

export function langMenu() {
  const cur = settings.get('lang');
  const items = [{ h: t('menu.uiLang') }];
  items.push({ label: t('lang.auto'), checked: cur === 'auto', run: () => settings.set('lang', 'auto') });
  for (const [code, name] of Object.entries(LANG_NAMES)) items.push({ label: name, keys: code.toUpperCase(), checked: cur === code || (cur === 'auto' && false), run: () => settings.set('lang', code) });
  items.push('-', { icon: 'plus', label: t('menu.addLang'), run: () => run('app.addLang') });
  return items;
}

const zoomItems = () => [{ cmd: 'view.zoomIn' }, { cmd: 'view.zoomOut' }, { cmd: 'view.zoomReset' }, '-', { label: t('zoom.wheelToggle'), checked: settings.get('wheelZoom') !== false, run: () => settings.toggle('wheelZoom') }];

const caseItems = () => [
  { label: t('case.upper'), run: () => run('tools.case', 'upper') },
  { label: t('case.lower'), run: () => run('tools.case', 'lower') },
  { label: t('case.title'), run: () => run('tools.case', 'title') },
  { label: t('case.sentence'), run: () => run('tools.case', 'sentence') },
  { label: t('case.invert'), run: () => run('tools.case', 'invert') },
];

export const TRANSLATE_TO = [['en', 'English'], ['ru', 'Русский'], ['zh', '中文'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano'], ['ja', '日本語'], ['ko', '한국어'], ['uk', 'Українська'], ['tr', 'Türkçe'], ['pt', 'Português']];
const translateItems = () => TRANSLATE_TO.map(([c, n]) => ({ label: n, run: () => run('ai.translate', n) }));

export function menuItems(name) {
  const cur = tab();
  switch (name) {
    case 'file': return [
      { cmd: 'file.new' }, { cmd: 'file.newWindow' }, { cmd: 'file.open' },
      { label: t('menu.recentFiles'), icon: 'history', sub: recentItems, subCls: 'recent-dd' },
      '-',
      { cmd: 'file.save' }, { cmd: 'file.saveAs' }, { cmd: 'file.saveAll' },
      { label: t('menu.saveWithEnc'), icon: 'file-code', sub: saveEncItems },
      '-',
      { cmd: 'file.reopenClosed' }, { cmd: 'file.versions' }, { cmd: 'file.reveal' },
      '-',
      { cmd: 'file.print' },
      '-',
      { cmd: 'app.tray' }, { cmd: 'app.quit' },
    ];
    case 'edit': return [
      { cmd: 'edit.undo' }, { cmd: 'edit.redo' }, '-',
      { cmd: 'edit.cut' }, { cmd: 'edit.copy' }, { cmd: 'edit.paste' }, { cmd: 'edit.pastePlain' }, '-',
      { cmd: 'edit.find' }, { cmd: 'edit.replace' }, { cmd: 'edit.goto' }, '-',
      { cmd: 'edit.selectAll' }, { cmd: 'edit.insertDate' },
    ];
    case 'view': return [
      { label: t('menu.viewMode'), icon: 'app-window', sub: viewModeItems, subCls: 'w340' },
      { label: t('menu.theme'), icon: 'palette', sub: themeItems },
      { label: t('menu.zoom'), icon: 'zoom-in', sub: zoomItems, note: Math.round((settings.get('zoom') || 1) * 100) + '%' },
      { label: t('menu.uiLang'), icon: 'languages', sub: langMenu },
      '-',
      { h: t('menu.show') },
      { cmd: 'view.wrap' }, { cmd: 'view.lineNumbers' }, { cmd: 'view.minimap' }, { cmd: 'view.toc' }, { cmd: 'view.statusBar' },
      '-',
      { cmd: 'view.focus' }, { cmd: 'view.topmost' }, { cmd: 'view.fullscreen' },
    ];
    case 'enc': return [
      { html: `<div class="minfo">${t('menu.encNow', { enc: `<b>${esc(cur ? encName(cur.encoding) + (cur.bom ? ' BOM' : '') : '')}</b>` })}${cur?.path && cur.reason && cur.reason !== 'manual' ? `<br>${esc(encReason(cur))}` : ''}</div>` },
      { label: t('menu.reopenWith'), icon: 'refresh-cw', sub: () => reopenItems(), subCls: 'enc-dd', onSubOpen: fillPreviews, disabled: !cur?.path },
      { label: t('menu.saveWithEnc'), icon: 'save', sub: saveEncItems },
      { cmd: 'enc.toUtf8' },
      '-',
      { h: t('menu.eol') },
      ...eolItems(cur),
      '-',
      { cmd: 'enc.bom' }, { cmd: 'enc.detect' },
    ];
    case 'tools': return [
      { cmd: 'tools.sort' }, { cmd: 'tools.sortDesc' }, { cmd: 'tools.dedupe' }, { cmd: 'tools.removeEmpty' }, { cmd: 'tools.trim' },
      { label: t('menu.case'), icon: 'type', sub: caseItems },
      { cmd: 'tools.formatJson' }, '-',
      { cmd: 'tools.compare' }, { cmd: 'tools.stats' }, '-',
      { cmd: 'app.settings' },
    ];
    case 'ai': return [
      { cmd: 'ai.panel' }, '-',
      { cmd: 'ai.fix' }, { cmd: 'ai.shorten' }, { cmd: 'ai.polite' },
      { label: t('cmd.ai.translate'), icon: 'languages', sub: translateItems },
      { cmd: 'ai.continue' }, { cmd: 'ai.explain' }, { cmd: 'ai.summary' }, '-',
      { cmd: 'ai.settings' },
    ];
    case 'help': return [
      { cmd: 'help.keys' }, { cmd: 'help.logs' }, { cmd: 'help.welcome' }, '-',
      { cmd: 'help.updates' }, { cmd: 'help.report' }, { cmd: 'help.site' }, '-',
      { cmd: 'help.about' },
    ];
    case 'viewmode': return viewModeItems();
  }
  return [];
}

function encReason(tab) {
  const conf = Math.round((tab.confidence || 0) * 100);
  const r = tab.reason;
  if (r === 'bom') return t('enc.byBom');
  if (r === 'ascii' || r === 'utf8' || r === 'empty') return t('enc.byUtf8');
  return t('enc.auto', { n: conf });
}

function eolItems(cur) {
  return [['crlf', 'CRLF', 'Windows'], ['lf', 'LF', 'Unix, macOS'], ['cr', 'CR', 'Mac OS 9']].map(([id, n, note]) => ({
    label: n, note, checked: cur?.eol === id && !cur?.mixedEol, run: () => setEol(cur, id),
  }));
}

export function encodingMenu(cur, onlyReopen = false) {
  if (onlyReopen) return reopenItems(true);
  return [
    { label: t('menu.reopenWith'), icon: 'refresh-cw', sub: () => reopenItems(), subCls: 'enc-dd', onSubOpen: fillPreviews, disabled: !cur?.path },
    { label: t('menu.saveWithEnc'), icon: 'save', sub: saveEncItems },
    { cmd: 'enc.toUtf8' }, '-', { cmd: 'enc.bom' },
  ];
}
export function eolMenu(cur) { return [{ h: t('menu.eol') }, ...eolItems(cur)]; }

export function typeMenu(cur) {
  const ids = ['markdown', 'text', 'javascript', 'typescript', 'json', 'html', 'css', 'python', 'csharp', 'cpp', 'java', 'go', 'rust', 'php', 'sql', 'xml', 'yaml', 'shell', 'powershell', 'ini'];
  return [{ h: t('menu.syntax') }, ...ids.map(id => ({ label: id === 'text' ? t('lang.text') : langName(id), checked: cur?.lang === id, run: () => run('doc.setLang', id) }))];
}

export function tabMenu(tb) {
  return [
    { label: t('tab.close'), icon: 'x', keys: 'Ctrl+W', run: () => closeTab(tb) },
    { label: t('tab.closeOthers'), run: () => closeOthers(tb), disabled: docs.tabs.length < 2 },
    '-',
    { label: t('tab.copyPath'), icon: 'copy', disabled: !tb.path, run: () => host.send('clipboard.write', { text: tb.path }) },
    { label: t('cmd.file.reveal'), icon: 'folder-open', disabled: !tb.path, run: () => host.send('file.reveal', { path: tb.path }) },
    { label: t('cmd.file.versions'), icon: 'history', disabled: !tb.path, run: () => { activateTab(tb); run('file.versions'); } },
  ];
}

export function editorContextMenu(pos) {
  const view = editor.view;
  const items = [];
  const issue = pos != null ? issueAt(view.state, pos) : null;
  if (issue) {
    items.push({ h: issue.kind === 'spell' ? t('proof.spellingOf', { w: issue.word }) : issue.msg });
    if (issue.sugg?.length) issue.sugg.slice(0, 5).forEach((s, i) => items.push({ label: s === ' ' ? '␣' : s, icon: i === 0 ? 'wand-sparkles' : '', cls: i === 0 ? 'first' : '', run: () => applyIssue(view, issue, s) }));
    else items.push({ label: t('proof.noSugg'), disabled: true });
    items.push({ icon: 'eye-off', label: t('proof.ignore'), run: () => { ignoreWord(issue.word); removeIssue(view, issue); } });
    if (issue.kind === 'spell') items.push({ icon: 'book-marked', label: t('proof.addDict'), run: () => { addToDictionary(issue.word); removeIssue(view, issue); } });
    items.push('-');
  }
  const sel = editor.selection();
  items.push({ cmd: 'edit.cut', disabled: sel.empty }, { cmd: 'edit.copy', disabled: sel.empty }, { cmd: 'edit.paste' }, { cmd: 'edit.pastePlain' }, '-', { cmd: 'edit.selectAll' });
  if (!sel.empty) {
    items.push('-', { h: t('ai.h') });
    items.push({ cmd: 'ai.fix' }, { cmd: 'ai.shorten' }, { label: t('cmd.ai.translate'), icon: 'languages', sub: translateItems }, { cmd: 'ai.explain' });
    items.push('-', { label: t('menu.case'), icon: 'type', sub: caseItems });
  }
  return items;
}
