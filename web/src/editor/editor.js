// The CodeMirror editor: one EditorView, one EditorState per tab, compartments for everything configurable.
import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import {
  EditorView, keymap, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, lineNumbers,
  highlightSpecialChars, rectangularSelection, crosshairCursor, placeholder, ViewPlugin, Decoration,
} from '@codemirror/view';
import { history, defaultKeymap, historyKeymap, indentWithTab, undo, redo, selectAll, toggleComment, undoDepth, redoDepth } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel, closeSearchPanel, highlightSelectionMatches, searchPanelOpen, gotoLine } from '@codemirror/search';
import { syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags as tg } from '@lezer/highlight';
import { showMinimap } from '@replit/codemirror-minimap';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { settings } from '../settings.js';
import { t, onLang } from '../i18n.js';
import { bus, throttle } from '../util.js';
import { langExtension, isProse } from './langs.js';
import { mdLive, headings, resetMarkCache } from './mdlive.js';
import { proofField, proofPlugin } from './proof.js';
import { proposalField, flashField } from './aidiff.js';

const hl = HighlightStyle.define([
  { tag: [tg.keyword, tg.controlKeyword, tg.moduleKeyword, tg.operatorKeyword, tg.definitionKeyword, tg.modifier, tg.self], class: 'sy-k' },
  { tag: [tg.typeName, tg.className, tg.namespace, tg.tagName, tg.standard(tg.typeName)], class: 'sy-t' },
  { tag: [tg.string, tg.special(tg.string), tg.regexp, tg.character, tg.attributeValue, tg.docString], class: 'sy-s' },
  { tag: [tg.comment, tg.lineComment, tg.blockComment, tg.docComment], class: 'sy-c' },
  { tag: [tg.number, tg.bool, tg.null, tg.atom, tg.unit, tg.color], class: 'sy-n' },
  { tag: [tg.function(tg.variableName), tg.function(tg.propertyName), tg.macroName, tg.function(tg.definition(tg.variableName))], class: 'sy-m' },
  { tag: [tg.attributeName, tg.propertyName, tg.labelName, tg.definition(tg.propertyName)], class: 'sy-a' },
  { tag: [tg.punctuation, tg.bracket, tg.operator, tg.separator, tg.derefOperator], class: 'sy-p' },
  { tag: tg.heading, class: 'sy-h' },
  { tag: tg.strong, class: 'sy-b' },
  { tag: tg.emphasis, class: 'sy-i' },
  { tag: tg.strikethrough, class: 'sy-st' },
  { tag: tg.link, class: 'sy-l' },
  { tag: tg.url, class: 'sy-u' },
  { tag: tg.monospace, class: 'sy-mono' },
  { tag: tg.quote, class: 'sy-q' },
  { tag: [tg.meta, tg.processingInstruction, tg.contentSeparator], class: 'sy-mk' },
  { tag: tg.invalid, class: 'sy-inv' },
  { tag: tg.inserted, class: 'sy-ins' },
  { tag: tg.deleted, class: 'sy-del' },
]);

const C = {
  lang: new Compartment(), mode: new Compartment(), wrap: new Compartment(), tab: new Compartment(),
  pairs: new Compartment(), phrases: new Compartment(), ph: new Compartment(), focus: new Compartment(), readonly: new Compartment(),
};

function phrases() {
  return EditorState.phrases.of({
    'Find': t('cm.find'), 'Replace': t('cm.replace'), 'next': t('cm.next'), 'previous': t('cm.prev'), 'all': t('cm.all'),
    'match case': t('cm.case'), 'regexp': t('cm.regexp'), 'by word': t('cm.word'), 'replace': t('cm.replaceOne'),
    'replace all': t('cm.replaceAll'), 'close': t('cm.close'), 'Go to line': t('cm.gotoLine'), 'go': 'OK',
    'current match': t('cm.current'), 'on line': t('cm.onLine'), 'Folded lines': t('cm.folded'), 'Unfolded lines': t('cm.unfolded'),
    'to': '→', 'folded code': t('cm.foldedCode'), 'unfold': t('cm.unfold'), 'Fold line': t('cm.fold'), 'Unfold line': t('cm.unfold'),
    'Control character': t('cm.ctrlChar'), 'Selection deleted': '', 'replaced match on line $': t('cm.replacedOn'), 'replaced $ matches': t('cm.replacedN'),
  });
}

// Focus mode: dim everything except the paragraph with the cursor
const dimLine = Decoration.line({ class: 'cm-dim' });
const focusDim = ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = this.build(v); }
  update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = this.build(u.view); }
  build(view) {
    const { doc } = view.state;
    const head = view.state.selection.main.head;
    const cur = doc.lineAt(head).number;
    let a = cur, b = cur;
    while (a > 1 && doc.line(a - 1).text.trim() !== '') a--;
    while (b < doc.lines && doc.line(b + 1).text.trim() !== '') b++;
    const r = [];
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const l = doc.lineAt(pos);
        if (l.number < a || l.number > b) r.push(dimLine.range(l.from));
        pos = l.to + 1;
      }
    }
    return Decoration.set(r);
  }
}, { decorations: v => v.decorations });

const minimapExt = showMinimap.compute(['doc'], () => ({
  create: () => { const dom = document.createElement('div'); dom.className = 'cm-mm-host'; return { dom }; },
  displayText: 'blocks', showOverlay: 'always', gutters: [],
}));

const markers = indentationMarkers({ thickness: 1, colors: { light: 'var(--line)', dark: 'var(--line)', activeLight: 'var(--line-2)', activeDark: 'var(--line-2)' } });

function isMd(tab) { return tab.lang === 'markdown' || (tab.lang === 'text' && settings.get('markdownInTxt')); }

function modeExt(tab) {
  const mode = tab.mode || 'standard';
  const coder = mode === 'coder';
  const md = isMd(tab);
  const ext = [EditorView.editorAttributes.of({ class: `m-${mode} ${isProse(tab.lang) ? 'prose' : 'code'}` })];
  if (coder) {
    if (settings.get('lineNumbersCode') !== false) ext.push(lineNumbers(), highlightActiveLineGutter());
    ext.push(foldGutter({ markerDOM: open => { const s = document.createElement('span'); s.className = 'cm-fold ' + (open ? 'open' : 'closed'); s.innerHTML = open ? '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>' : '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>'; return s; } }));
    ext.push(bracketMatching(), highlightSelectionMatches(), markers);
    if (settings.get('minimap')) ext.push(minimapExt);
  } else {
    if (settings.get('lineNumbers')) ext.push(lineNumbers());
    if (md) ext.push(mdLive);
  }
  if (settings.get('highlightLine') !== false) ext.push(highlightActiveLine());
  if (mode === 'proof' || (settings.get('spellInStandard') && mode === 'standard' && isProse(tab.lang))) ext.push(proofPlugin(() => tab.lang));
  return ext;
}

const wrapExt = tab => ((tab.mode === 'coder' ? settings.get('wrapCode') : settings.get('wrap')) ? EditorView.lineWrapping : []);
const tabExt = () => { const n = settings.get('tabSize') || 4; return [EditorState.tabSize.of(n), indentUnit.of(settings.get('insertSpaces') === false ? '\t' : ' '.repeat(n))]; };

let view = null;
let current = null;
const emitCursor = throttle(() => bus.emit('cursor', current), 80);
const emitDoc = throttle(() => bus.emit('doc.change', current), 150);

function baseExtensions(tab) {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(hl),
    highlightSpecialChars(),
    rectangularSelection(),
    crosshairCursor(),
    search({ top: true }),
    proofField,
    proposalField,
    flashField,
    C.pairs.of(settings.get('autoPairs') ? closeBrackets() : []),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap.filter(k => k.key !== 'Mod-/' && k.key !== 'Mod-Enter'), ...searchKeymap.filter(k => k.key !== 'Mod-f' && k.key !== 'Mod-Alt-g'), ...historyKeymap, ...foldKeymap, indentWithTab]),
    C.lang.of(langExtension(tab.lang, settings.get('markdownInTxt'))),
    C.mode.of(modeExt(tab)),
    C.wrap.of(wrapExt(tab)),
    C.tab.of(tabExt()),
    C.phrases.of(phrases()),
    C.ph.of(placeholder(t('editor.placeholder'))),
    C.focus.of(settings.get('focusMode') ? focusDim : []),
    EditorView.updateListener.of(u => {
      if (!current || u.state !== view.state) return;
      current.state = u.state;
      if (u.docChanged) emitDoc();
      if (u.selectionSet || u.docChanged) emitCursor();
      if (u.focusChanged) bus.emit('editor.focus', u.view.hasFocus);
    }),
    EditorView.domEventHandlers({
      contextmenu: (e, v) => {
        e.preventDefault();
        const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
        bus.emit('editor.contextmenu', { x: e.clientX, y: e.clientY, pos });
        return true;
      },
      mousedown: (e, v) => {
        if (e.button !== 0) return false;
        const ins = e.target.closest?.('ins.cm-ins, .cm-del');
        if (ins) bus.emit('ai.clickChange', +ins.dataset.chg);
        const sp = e.target.closest?.('.cm-sp');
        if (sp) {
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
          setTimeout(() => bus.emit('proof.click', { pos, x: e.clientX, y: e.clientY }), 0);
        }
        return false;
      },
    }),
  ];
}

export const editor = {
  C,
  get view() { return view; },
  get tab() { return current; },

  init(parent) {
    const dummy = { lang: 'markdown', mode: 'standard' };
    view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions: baseExtensions(dummy) }) });
    settings.on('*', path => this.onSetting(path));
    onLang(() => this.reconfigureAll());
    return view;
  },

  createState(tab, text, selection) {
    let sel;
    if (selection && typeof selection.anchor === 'number') {
      const len = text.length;
      sel = EditorSelection.single(Math.min(selection.anchor, len), Math.min(selection.head ?? selection.anchor, len));
    }
    return EditorState.create({ doc: text, selection: sel, extensions: baseExtensions(tab) });
  },

  show(tab) {
    if (current && current !== tab && current.state === view.state) {
      current.snap = view.scrollSnapshot();
    }
    current = tab;
    view.setState(tab.state);
    this.syncCompartments();
    if (tab.snap) { try { view.dispatch({ effects: tab.snap }); } catch { } }
    tab.state = view.state;
    bus.emit('cursor', tab);
  },

  syncCompartments() {
    const tab = current;
    if (!tab) return;
    view.dispatch({
      effects: [
        C.lang.reconfigure(langExtension(tab.lang, settings.get('markdownInTxt'))),
        C.mode.reconfigure(modeExt(tab)),
        C.wrap.reconfigure(wrapExt(tab)),
        C.tab.reconfigure(tabExt()),
        C.pairs.reconfigure(settings.get('autoPairs') ? closeBrackets() : []),
        C.phrases.reconfigure(phrases()),
        C.ph.reconfigure(placeholder(t('editor.placeholder'))),
        C.focus.reconfigure(settings.get('focusMode') ? focusDim : []),
      ],
    });
    if (current) current.state = view.state;
  },

  reconfigureAll() { this.syncCompartments(); },

  onSetting(path) {
    const keys = ['wrap', 'wrapCode', 'lineNumbers', 'lineNumbersCode', 'minimap', 'highlightLine', 'tabSize', 'insertSpaces', 'autoPairs', 'focusMode', 'markdownInTxt', 'spellInStandard', 'punctuation', 'spellLangs', 'dictionary'];
    if (keys.includes(path) || path === '') this.syncCompartments();
    if (['fontSize', 'zoom', 'fontText', 'lineHeight', 'sheetWidth', 'codeFontSize', 'fontMono'].includes(path)) { resetMarkCache(); this.remeasure(); }
  },

  remeasure() { if (!view) return; resetMarkCache(); view.requestMeasure(); this.refreshMode(); },

  /** re-creates mode extensions (e.g. heading mark widths after zoom) */
  refreshMode() { if (current) { view.dispatch({ effects: C.mode.reconfigure(modeExt(current)) }); current.state = view.state; } },

  setMode(tab, mode) {
    tab.mode = mode;
    if (tab === current) this.syncCompartments();
  },

  setLang(tab, lang) { tab.lang = lang; if (tab === current) this.syncCompartments(); },

  text(tab = current) { return (tab === current ? view.state : tab.state).doc.toString(); },
  doc(tab = current) { return (tab === current ? view.state : tab.state).doc; },
  stateOf(tab = current) { return tab === current ? view.state : tab.state; },

  /** Replaces the whole text (undoable). */
  setText(tab, text, userEvent = 'input.replace') {
    if (tab === current) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent });
      tab.state = view.state;
    } else {
      tab.state = tab.state.update({ changes: { from: 0, to: tab.state.doc.length, insert: text }, userEvent }).state;
    }
  },

  /** Loads new content without undo history (reload from disk). */
  resetText(tab, text) {
    const sel = this.stateOf(tab).selection.main;
    tab.state = this.createState(tab, text, { anchor: sel.anchor, head: sel.head });
    if (tab === current) { view.setState(tab.state); this.syncCompartments(); }
  },

  focus() { view?.focus(); },
  hasFocus() { return view?.hasFocus; },
  undo() { undo(view); }, redo() { redo(view); },
  canUndo() { return undoDepth(view.state) > 0; }, canRedo() { return redoDepth(view.state) > 0; },
  selectAll() { selectAll(view); view.focus(); },
  toggleComment() { toggleComment(view); },
  find(replace = false) {
    openSearchPanel(view);
    setTimeout(() => {
      const f = view.dom.querySelector(replace ? '.cm-search input[name=replace]' : '.cm-search input[name=search]');
      f?.focus(); f?.select();
    }, 0);
  },
  closeFind() { if (searchPanelOpen(view.state)) closeSearchPanel(view); },
  searchOpen() { return searchPanelOpen(view.state); },
  gotoLine(n, col = 1) {
    const doc = view.state.doc;
    const line = doc.line(Math.max(1, Math.min(doc.lines, n)));
    const pos = Math.min(line.to, line.from + Math.max(0, col - 1));
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    view.focus();
  },
  gotoPos(pos, end) {
    view.dispatch({ selection: { anchor: pos, head: end ?? pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    view.focus();
  },
  selection() {
    const s = view.state.selection.main;
    return { from: s.from, to: s.to, text: view.state.sliceDoc(s.from, s.to), empty: s.empty };
  },
  replaceSelection(text, userEvent = 'input') {
    view.dispatch(view.state.replaceSelection(text), { userEvent, scrollIntoView: true });
    view.focus();
  },
  replaceRange(from, to, text, userEvent = 'input') { view.dispatch({ changes: { from, to, insert: text }, userEvent }); },
  insertAtCursor(text) { this.replaceSelection(text); },
  cursorInfo() {
    const st = view.state;
    const s = st.selection.main;
    const line = st.doc.lineAt(s.head);
    let selLines = 0;
    if (!s.empty) selLines = st.doc.lineAt(s.to).number - st.doc.lineAt(s.from).number + 1;
    return { line: line.number, col: s.head - line.from + 1, sel: s.to - s.from, selLines, ranges: st.selection.ranges.length, lines: st.doc.lines, length: st.doc.length };
  },
  headings(tab = current) { return headings(this.doc(tab)); },
  lineCount(tab = current) { return this.doc(tab).lines; },
  scrollToTop() { const top = () => { view.scrollDOM.scrollTop = 0; }; top(); requestAnimationFrame(top); },
  coordsAt(pos) { return view.coordsAtPos(pos); },
  gotoLineDialog() { gotoLine(view); },
  isDirty(tab) {
    const st = this.stateOf(tab);
    if (!tab.savedDoc) return st.doc.length > 0 || !!tab.forceDirty;
    return !!tab.forceDirty || !st.doc.eq(tab.savedDoc);
  },
  markSaved(tab) { tab.savedDoc = this.stateOf(tab).doc; tab.forceDirty = false; },
};
