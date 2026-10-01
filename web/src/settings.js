// Settings: defaults live here, values are persisted by the host in %AppData%\Folio\settings.json
import { host } from './host.js';
import { Emitter, debounce } from './util.js';

export const DEFAULTS = {
  lang: 'auto',
  theme: 'paper',            // paper | graphite | sepia | glass | system
  themeLight: 'paper',
  themeDark: 'graphite',
  smoothTheme: true,
  animations: true,
  nativeFrame: false,
  compatMode: false,         // no GPU acceleration (host: compat-mode flag file); takes effect after a restart
  zoom: 1,
  wheelZoom: true,
  fontUi: 'Inter',
  fontText: 'Inter',
  fontMono: 'JetBrains Mono',
  fontRead: 'Literata',
  fontSize: 16,
  codeFontSize: 13.5,
  lineHeight: 1.75,
  sheetWidth: 780,
  wrap: true,
  wrapCode: false,
  lineNumbers: false,
  lineNumbersCode: true,
  minimap: true,
  toc: true,
  statusBar: true,
  highlightLine: true,
  tabSize: 4,
  insertSpaces: true,
  autoPairs: true,
  smartQuotes: false,
  markdownInTxt: true,
  defaultMode: 'auto',       // auto | standard | coder | proof
  spellLangs: ['ru-RU', 'en-US'],
  punctuation: true,
  spellInStandard: false,
  encDefault: 'utf-8',
  bomDefault: false,
  eolDefault: 'crlf',
  fallbackEncoding: 'auto',  // used when detection has no idea: auto = by Windows language
  legacyBanner: true,
  autosave: 'off',           // off | focus | 30s
  hotExit: true,
  restoreSession: true,
  closeToTray: true,
  trayIcon: true,
  startWithWindows: false,
  startMinimized: false,
  hotkeyQuickNote: 'Ctrl+Alt+N',
  hotkeyShow: 'Win+Alt+F',
  quickNotesFile: '',
  topmost: false,
  escToTray: true,
  uiScale: 1,
  focusMode: false,
  lastDir: '',
  welcomeShown: false,
  trayHintShown: false,
  recentMax: 20,
  tabsMode: 'multi',         // multi | single (opening a file replaces the current tab)
  colorIcons: true,          // colored file-type icons on tabs (developer-icons)
  reader: { layout: 'book', width: 900, fontSize: 16.5, lineHeight: 1.66, showTime: true, serif: true },
  copy: { format: 'markdown', names: true, separator: true, lineNumbers: false, time: false },
  ai: {
    provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
    temperature: 0.3, stream: true, context: 'page', answerLang: 'auto', maxChars: 60000, maxTokens: 0, showThinking: true,
    profiles: [], active: '',  // [{id, name, provider, baseUrl, model, keyId}] – see ai.js
  },
  updates: { auto: true, beta: false },
  keys: {},
  dictionary: [],
};

const bus = new Emitter();
let S = structuredClone(DEFAULTS);

function merge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(over)) {
    if (!(k in base)) { base[k] = over[k]; continue; }
    const b = base[k], o = over[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object' && !Array.isArray(o)) merge(b, o);
    else if (o !== undefined && o !== null) base[k] = o;
  }
  return base;
}

const persist = debounce(() => host.send('settings.save', { settings: S }), 350);

export const settings = {
  load(saved) { S = merge(structuredClone(DEFAULTS), saved || {}); return S; },
  get all() { return S; },
  get(path) { return path.split('.').reduce((o, k) => o?.[k], S); },
  set(path, value, { silent = false } = {}) {
    const keys = path.split('.');
    let o = S;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
    const last = keys[keys.length - 1];
    if (JSON.stringify(o[last]) === JSON.stringify(value)) return;
    o[last] = value;
    persist();
    if (!silent) { bus.emit(path, value); bus.emit(keys[0], S[keys[0]]); bus.emit('*', path, value); }
  },
  toggle(path) { this.set(path, !this.get(path)); },
  on(path, fn) { return bus.on(path, fn); },
  reset() { const keep = { dictionary: S.dictionary }; S = merge(structuredClone(DEFAULTS), keep); persist(); bus.emit('*', '', null); },
  flush() { persist.flush(); },
};
