// Tabs/documents: open, save, close, session restore, external changes, recent files.
import { host } from './host.js';
import { settings } from './settings.js';
import { t } from './i18n.js';
import { bus, uid, basename, dirname, extname, debounce, esc } from './util.js';
import { editor } from './editor/editor.js';
import { langForPath, isProse } from './editor/langs.js';

export const docs = {
  tabs: [],
  active: null,
  closed: [],
  recent: [],
  untitledSeq: 0,
};

const CODE_MODE_LANGS = new Set(['markdown', 'text']);

function defaultMode(lang) {
  const pref = settings.get('defaultMode');
  if (pref && pref !== 'auto') return pref;
  return CODE_MODE_LANGS.has(lang) ? 'standard' : 'coder';
}

export function tabName(tab) { return tab.path ? basename(tab.path) : (tab.name || t('doc.untitled')); }
export function isDirty(tab) { return editor.isDirty(tab); }

function nextUntitled() {
  const used = new Set(docs.tabs.filter(x => !x.path).map(x => x.name));
  for (let n = 1; ; n++) {
    const name = n === 1 ? t('doc.untitled') : `${t('doc.untitled')} ${n}`;
    if (!used.has(name)) return name;
  }
}

export function createTab(o = {}) {
  const lang = o.lang || (o.path ? langForPath(o.path) : 'markdown');
  const tab = {
    id: o.id || uid('t'),
    path: o.path || null,
    name: o.path ? basename(o.path) : (o.name || nextUntitled()),
    encoding: o.encoding || settings.get('encDefault') || 'utf-8',
    bom: o.bom ?? (o.path ? false : !!settings.get('bomDefault')),
    eol: o.eol || settings.get('eolDefault') || 'crlf',
    mixedEol: !!o.mixedEol,
    confidence: o.confidence ?? 1,
    reason: o.reason || '',
    candidates: o.candidates || [],
    lang,
    mode: o.mode || defaultMode(lang),
    view: o.view || 'edit',
    mtime: o.mtime || null,
    size: o.size || 0,
    readOnly: !!o.readOnly,
    banner: null,
    reader: o.reader || null,
  };
  tab.state = editor.createState(tab, o.text || '', o.sel);
  if (o.savedText !== undefined) tab.savedDoc = editor.createState(tab, o.savedText).doc;
  else if (o.path) tab.savedDoc = tab.state.doc;
  else tab.savedDoc = null;
  if (o.forceDirty) tab.forceDirty = true;
  return tab;
}

export function addTab(tab, activate = true, index) {
  if (index == null) docs.tabs.push(tab); else docs.tabs.splice(index, 0, tab);
  if (activate) activateTab(tab);
  bus.emit('tabs');
  saveSession();
  return tab;
}

export function newDoc(o = {}) {
  const tab = createTab(o);
  addTab(tab, true, docs.active ? docs.tabs.indexOf(docs.active) + 1 : undefined);
  setTimeout(() => editor.focus(), 0);
  if (singleTab() && !o.keepOthers) closeAllBut(tab);
  return tab;
}

/** Settings → General → Tabs: "one tab" — opening a file or a new note replaces what was open. */
export const singleTab = () => settings.get('tabsMode') === 'single';
/** Closes every other tab; unsaved ones ask first (Cancel keeps that tab open next to the new one). */
export async function closeAllBut(keep) {
  for (const o of docs.tabs.filter(x => x !== keep)) { if (docs.tabs.includes(o)) await closeTab(o); }
  if (docs.tabs.includes(keep) && docs.active !== keep) activateTab(keep);
}

export function activateTab(tab) {
  if (!tab) return;
  docs.active = tab;
  editor.show(tab);
  bus.emit('active', tab);
  host.send('win.setTitle', { title: `${tabName(tab)} — Folio` });
  saveSession();
}

export function findTab(path) {
  if (!path) return null;
  const p = path.toLowerCase();
  return docs.tabs.find(x => x.path && x.path.toLowerCase() === p) || null;
}

function isBlankUntitled(tab) { return tab && !tab.path && editor.doc(tab).length === 0 && !tab.forceDirty; }

/** Opens files (from dialog, command line, drop, recent list). */
export async function openPaths(paths, opts = {}) {
  let last = null;
  const single = singleTab() && !opts.newTab;
  if (single && paths.length > 1) paths = paths.slice(-1);
  for (const path of paths) {
    const existing = findTab(path);
    if (existing) { last = existing; continue; }
    try {
      const r = await host.call('file.read', { path, encoding: opts.encoding || null });
      if (r.binary && !opts.force) {
        const { confirm } = await import('./ui/dialogs.js');
        const ok = await confirm({ title: t('dlg.binaryTitle'), text: t('dlg.binaryText', { name: esc(basename(path)) }), ok: t('dlg.openAnyway'), icon: 'triangle-alert' });
        if (!ok) continue;
      }
      const replace = isBlankUntitled(docs.active) && docs.tabs.length === 1 ? docs.active : null;
      const tab = createTab({ path: r.path || path, text: r.text, encoding: r.encoding, bom: r.bom, eol: r.eol, mixedEol: r.mixedEol, confidence: r.confidence, reason: r.reason, candidates: r.candidates, mtime: r.mtime, size: r.size, readOnly: r.readOnly, mode: opts.mode });
      if (r.invalid > 0) tab.invalid = r.invalid;
      if (replace) { const i = docs.tabs.indexOf(replace); docs.tabs.splice(i, 1, tab); bus.emit('tabs'); activateTab(tab); }
      else addTab(tab, true);
      last = tab;
      pushRecent(tab);
      checkBanners(tab);
      bus.emit('file.opened', tab);
    } catch (e) {
      const { toastError } = await import('./ui/dialogs.js');
      toastError(e, t('err.open', { name: basename(path) }));
      if (e.code === 'notFound') removeRecent(path);
    }
  }
  if (last) activateTab(last);
  if (last && single) await closeAllBut(last);
  watchFiles();
  return last;
}

export async function openDialog() {
  const r = await host.call('file.openDialog', { dir: settings.get('lastDir') || '' });
  if (r?.paths?.length) {
    settings.set('lastDir', dirname(r.paths[0]));
    await openPaths(r.paths);
  }
}

function checkBanners(tab) {
  tab.banner = null;
  if (tab.invalid > 0 && tab.encoding === 'utf-8') tab.banner = { kind: 'invalid' };
  else if (tab.path && settings.get('legacyBanner') && !tab.encoding.startsWith('utf-') && tab.encoding !== 'us-ascii' && !tab.bannerDismissed) tab.banner = { kind: 'legacy' };
  else if (tab.mixedEol) tab.banner = { kind: 'mixedEol' };
  bus.emit('banner', tab);
}

function suggestName(tab) {
  const doc = editor.doc(tab);
  let first = '';
  for (let i = 1; i <= Math.min(doc.lines, 20); i++) { const l = doc.line(i).text.trim(); if (l) { first = l; break; } }
  first = first.replace(/^#+\s*/, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48).trim();
  const md = /^#|\n#{1,3} |\n- \[|\*\*|```/.test(doc.sliceString(0, 4000));
  return (first || tab.name || 'note') + (md ? '.md' : '.txt');
}

/** Save. Returns true when the file was written. */
export async function saveTab(tab = docs.active, opts = {}) {
  if (!tab) return false;
  const { confirm, choose, toast, toastError } = await import('./ui/dialogs.js');
  let path = tab.path;
  if (opts.silent && (!path || opts.as || tab.readOnly)) return false;
  if (!path || opts.as) {
    const r = await host.call('file.saveDialog', { name: tab.path ? basename(tab.path) : suggestName(tab), dir: tab.path ? dirname(tab.path) : (settings.get('lastDir') || ''), encoding: tab.encoding });
    if (!r?.path) return false;
    path = r.path;
    settings.set('lastDir', dirname(path));
  }
  let encoding = opts.encoding || tab.encoding;
  let bom = opts.bom ?? tab.bom;
  const text = editor.text(tab);
  if (!encoding.startsWith('utf-')) {
    const chk = await host.call('file.checkEncodable', { text, encoding });
    if (chk.count > 0) {
      if (opts.silent) return false;
      const pick = await choose({
        title: t('dlg.lossyTitle', { enc: encName(encoding) }),
        text: t('dlg.lossyText', { n: chk.count, chars: esc(chk.chars), enc: encName(encoding) }),
        icon: 'triangle-alert',
        buttons: [{ id: 'utf8', label: t('dlg.saveUtf8'), primary: true }, { id: 'lossy', label: t('dlg.replaceQ') }, { id: 'cancel', label: t('dlg.cancel') }],
      });
      if (pick === 'utf8') { encoding = 'utf-8'; bom = false; }
      else if (pick !== 'lossy') return false;
    }
  }
  const r = await host.call('file.save', { path, text, encoding, bom, eol: tab.eol });
  if (!r.ok) {
    if (opts.silent) { if (!tab.autosaveWarned) { tab.autosaveWarned = true; toast(t('toast.autosaveFailed', { name: basename(path) }), { icon: 'triangle-alert', kind: 'err' }); } return false; }
    if ((r.error === 'readonly' || r.error === 'access') && !opts.as) {
      const ok = await confirm({ title: t('dlg.cantSaveTitle'), text: t(r.error === 'readonly' ? 'dlg.readonlyText' : 'dlg.accessText', { name: esc(basename(path)) }), ok: t('menu.saveAs'), icon: 'lock' });
      if (ok) return saveTab(tab, { ...opts, as: true });
      return false;
    }
    toastError(new host.HostError({ code: r.error, message: r.message }), t('err.save', { name: basename(path) }));
    return false;
  }
  const renamed = tab.path !== path;
  tab.path = path;
  tab.name = basename(path);
  tab.encoding = encoding;
  tab.bom = bom;
  tab.mtime = r.mtime;
  tab.size = r.size;
  tab.mixedEol = false;
  tab.readOnly = false;
  if (renamed) {
    const lang = langForPath(path);
    if (lang !== tab.lang) { tab.lang = lang; if (!isProse(lang) && tab.mode === 'standard') tab.mode = 'coder'; editor.setLang(tab, lang); }
  }
  editor.markSaved(tab);
  if (tab.banner?.kind === 'mixedEol' || tab.banner?.kind === 'invalid' || (tab.banner?.kind === 'legacy' && encoding.startsWith('utf-'))) tab.banner = null;
  if (tab.banner?.kind === 'external' || tab.banner?.kind === 'deleted') tab.banner = null;
  bus.emit('banner', tab);
  bus.emit('saved', tab, r);
  bus.emit('tabs');
  pushRecent(tab);
  watchFiles();
  saveSession();
  if (r.replaced > 0) toast(t('toast.savedLossy', { n: r.replaced }), { icon: 'triangle-alert' });
  if (tab === docs.active) host.send('win.setTitle', { title: `${tabName(tab)} — Folio` });
  return true;
}

export async function saveAll() {
  for (const tab of [...docs.tabs]) if (isDirty(tab)) { if (!tab.path) activateTab(tab); const ok = await saveTab(tab); if (!ok && !tab.path) return false; }
  return true;
}

/** Asks about unsaved changes. Returns true when the tab may be closed. */
export async function confirmClose(tab) {
  if (!isDirty(tab)) return true;
  if (docs.active !== tab) activateTab(tab);
  const { choose } = await import('./ui/dialogs.js');
  const pick = await choose({
    title: t('dlg.unsavedTitle'),
    text: t('dlg.unsavedText', { name: esc(tabName(tab)) }),
    icon: 'save',
    buttons: [{ id: 'save', label: t('dlg.save'), primary: true }, { id: 'discard', label: t('dlg.dontSave') }, { id: 'cancel', label: t('dlg.cancel') }],
  });
  if (pick === 'save') return saveTab(tab);
  return pick === 'discard';
}

export async function closeTab(tab = docs.active, { force = false } = {}) {
  if (!tab) return false;
  if (!force && !(await confirmClose(tab))) return false;
  const i = docs.tabs.indexOf(tab);
  if (i < 0) return false;
  docs.closed.push({ path: tab.path, name: tab.name, text: tab.path ? null : editor.text(tab), mode: tab.mode, index: i, encoding: tab.encoding });
  if (docs.closed.length > 30) docs.closed.shift();
  docs.tabs.splice(i, 1);
  if (!docs.tabs.length) { const n = createTab(); docs.tabs.push(n); }
  if (docs.active === tab) activateTab(docs.tabs[Math.min(i, docs.tabs.length - 1)]);
  bus.emit('tabs');
  watchFiles();
  saveSession();
  return true;
}

export async function closeOthers(keep) {
  for (const tab of [...docs.tabs]) if (tab !== keep) { if (!(await closeTab(tab))) return; }
}

export async function reopenClosed() {
  const c = docs.closed.pop();
  if (!c) return;
  if (c.path) await openPaths([c.path], { mode: c.mode });
  else newDoc({ text: c.text || '', name: c.name, mode: c.mode, forceDirty: !!c.text });
}

export function moveTab(tab, to) {
  const i = docs.tabs.indexOf(tab);
  if (i < 0 || to === i) return;
  docs.tabs.splice(i, 1);
  docs.tabs.splice(Math.max(0, Math.min(docs.tabs.length, to)), 0, tab);
  bus.emit('tabs');
  saveSession();
}

export function cycleTab(dir) {
  const i = docs.tabs.indexOf(docs.active);
  const n = docs.tabs.length;
  activateTab(docs.tabs[(i + dir + n) % n]);
}

/** Reload from disk, optionally forcing an encoding (Encoding → Reopen with…). */
export async function reloadTab(tab = docs.active, encoding = null, { silent = false } = {}) {
  if (!tab?.path) return;
  if (!silent && isDirty(tab)) {
    const { confirm } = await import('./ui/dialogs.js');
    if (!(await confirm({ title: t('dlg.reloadTitle'), text: t('dlg.reloadText', { name: esc(tabName(tab)) }), ok: t('dlg.reload'), icon: 'refresh-cw' }))) return;
  }
  try {
    const r = await host.call('file.read', { path: tab.path, encoding });
    Object.assign(tab, { encoding: r.encoding, bom: r.bom, eol: r.eol, mixedEol: r.mixedEol, confidence: r.confidence, reason: r.reason, candidates: r.candidates || tab.candidates, mtime: r.mtime, size: r.size, readOnly: r.readOnly, invalid: r.invalid });
    editor.resetText(tab, r.text);
    editor.markSaved(tab);
    if (encoding) { tab.bannerDismissed = true; tab.banner = null; bus.emit('banner', tab); }
    else checkBanners(tab);
    bus.emit('reloaded', tab);
    bus.emit('tabs');
    pushRecent(tab);
  } catch (e) {
    const { toastError } = await import('./ui/dialogs.js');
    toastError(e);
  }
}

export function setEncoding(tab, encoding, bom) {
  tab.encoding = encoding;
  tab.bom = bom ?? (encoding === 'utf-8' ? false : encoding.startsWith('utf-'));
  tab.forceDirty = true;
  tab.bannerDismissed = true;
  if (tab.banner?.kind === 'legacy') tab.banner = null;
  bus.emit('banner', tab);
  bus.emit('tabs');
  bus.emit('cursor', tab);
}

export function setEol(tab, eol) {
  if (tab.eol === eol && !tab.mixedEol) return;
  tab.eol = eol; tab.mixedEol = false; tab.forceDirty = true;
  if (tab.banner?.kind === 'mixedEol') { tab.banner = null; bus.emit('banner', tab); }
  bus.emit('tabs'); bus.emit('cursor', tab);
}

// ---- external changes ----
export function watchFiles() {
  host.send('file.watch', { files: docs.tabs.filter(x => x.path).map(x => ({ path: x.path, mtime: x.mtime, size: x.size })) });
}

host.on('file.changed', async d => {
  const tab = findTab(d.path);
  if (!tab) return;
  if (tab.mtime === d.mtime && tab.size === d.size) return;
  if (!isDirty(tab)) {
    await reloadTab(tab, tab.encoding === 'utf-8' ? null : tab.encoding, { silent: true });
    const { toast } = await import('./ui/dialogs.js');
    toast(t('toast.reloaded', { name: tabName(tab) }), { icon: 'refresh-cw' });
  } else {
    tab.banner = { kind: 'external' };
    bus.emit('banner', tab);
  }
});
host.on('file.deleted', d => {
  const tab = findTab(d.path);
  if (!tab) return;
  tab.banner = { kind: 'deleted' };
  tab.forceDirty = true;
  bus.emit('banner', tab);
  bus.emit('tabs');
});

// ---- recent files ----
export function pushRecent(tab) {
  if (!tab.path) return;
  const p = tab.path.toLowerCase();
  const old = docs.recent.find(r => r.path.toLowerCase() === p);
  docs.recent = docs.recent.filter(r => r.path.toLowerCase() !== p);
  docs.recent.unshift({ path: tab.path, encoding: tab.encoding, time: Date.now(), pinned: old?.pinned || false });
  trimRecent();
  saveRecent();
}
export function removeRecent(path) { docs.recent = docs.recent.filter(r => r.path.toLowerCase() !== path.toLowerCase()); saveRecent(); }
export function pinRecent(path, pinned) { const r = docs.recent.find(x => x.path === path); if (r) { r.pinned = pinned; saveRecent(); } }
export function clearRecent() { docs.recent = docs.recent.filter(r => r.pinned); saveRecent(); }
function trimRecent() {
  const max = settings.get('recentMax') || 20;
  const pinned = docs.recent.filter(r => r.pinned);
  const rest = docs.recent.filter(r => !r.pinned).slice(0, max);
  docs.recent = [...pinned, ...rest];
}
const saveRecent = debounce(() => { host.send('recent.save', { list: docs.recent }); bus.emit('recent'); }, 300);

// ---- session (hot exit) ----
export function sessionSnapshot(withText = true, force = false) {
  const hot = force || settings.get('hotExit') !== false;
  return {
    active: docs.active?.id,
    tabs: docs.tabs.map(tab => {
      const st = editor.stateOf(tab);
      const dirty = isDirty(tab);
      const o = {
        id: tab.id, path: tab.path, name: tab.name, encoding: tab.encoding, bom: tab.bom, eol: tab.eol, lang: tab.lang,
        mode: tab.mode, view: tab.view, sel: { anchor: st.selection.main.anchor, head: st.selection.main.head }, dirty,
        clean: !tab.path && !dirty, mtime: tab.mtime, size: tab.size, reader: tab.reader ? { page: tab.reader.page, layout: tab.reader.layout, bookmarks: tab.reader.bookmarks } : null,
      };
      if (withText && hot && (dirty || (!tab.path && st.doc.length))) {
        if (tab.textHash !== st.doc) { o.text = st.doc.toString(); tab.textHash = st.doc; }
        else o.backup = true;
      }
      return o;
    }),
  };
}
export const saveSession = debounce(() => {
  if (!docs.ready) return;
  host.send('session.save', { session: sessionSnapshot() });
  docs.lastBackup = Date.now();
  bus.emit('session.saved');
}, 1200);

export async function restoreSession(session, args) {
  const restore = settings.get('restoreSession') !== false && session?.tabs?.length;
  if (restore) {
    for (const s of session.tabs) {
      try {
        if (s.path && s.text == null) {
          const r = await host.call('file.read', { path: s.path, encoding: s.encoding?.startsWith('utf-') ? null : s.encoding });
          const tab = createTab({ ...s, text: r.text, encoding: r.encoding, bom: r.bom, eol: r.eol, mixedEol: r.mixedEol, confidence: r.confidence, reason: r.reason, mtime: r.mtime, size: r.size, readOnly: r.readOnly });
          docs.tabs.push(tab);
        } else if (s.text != null) {
          let saved;
          if (s.path) {
            try { const r = await host.call('file.read', { path: s.path, encoding: s.encoding }); saved = r.text; s.mtime = r.mtime; s.size = r.size; }
            catch { saved = ''; }
          }
          const tab = createTab({ ...s, savedText: s.path ? saved : (s.clean ? s.text : undefined) });
          if (!s.path && !s.clean) tab.savedDoc = null;
          tab.textHash = tab.state.doc;
          docs.tabs.push(tab);
        }
      } catch (e) {
        console.warn('restore', s.path, e);
      }
    }
  }
  if (!docs.tabs.length) docs.tabs.push(createTab());
  const act = docs.tabs.find(x => x.id === session?.active) || docs.tabs[docs.tabs.length - 1];
  docs.ready = true;
  activateTab(act);
  bus.emit('tabs');
  if (args?.length) await openPaths(args);
  for (const tab of docs.tabs) if (tab.path) checkBanners(tab);
  watchFiles();
}

export function encName(id) {
  const m = { 'utf-8': 'UTF-8', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE', 'utf-32le': 'UTF-32 LE', 'utf-32be': 'UTF-32 BE', 'windows-1251': 'Windows-1251', 'cp866': 'CP866', 'koi8-r': 'KOI8-R', 'koi8-u': 'KOI8-U', 'iso-8859-5': 'ISO-8859-5', 'x-mac-cyrillic': 'Mac Cyrillic', 'windows-1252': 'Windows-1252', 'iso-8859-1': 'ISO-8859-1', 'iso-8859-15': 'ISO-8859-15', 'windows-1250': 'Windows-1250', 'iso-8859-2': 'ISO-8859-2', 'gb18030': 'GB18030', 'gbk': 'GBK', 'big5': 'Big5', 'shift_jis': 'Shift-JIS', 'euc-jp': 'EUC-JP', 'euc-kr': 'EUC-KR', 'us-ascii': 'ASCII', 'cp437': 'CP437', 'cp850': 'CP850' };
  return m[id] || (id || '').toUpperCase();
}
export const encLabel = tab => encName(tab.encoding) + (tab.bom && tab.encoding.startsWith('utf-') ? ' BOM' : '');
