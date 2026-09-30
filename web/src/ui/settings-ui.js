// Settings window: sections on the left, live-applied controls on the right.
import { $, $$, el, esc, I, on, debounce, clamp } from '../util.js';
import { t, LANG_NAMES, LANGS } from '../i18n.js';
import { settings, DEFAULTS } from '../settings.js';
import { host } from '../host.js';
import { modal, toast, confirm, prompt } from './dialogs.js';
import { openMenu } from './menu.js';
import { allCommands, titleOf, keysOf, prettyKeys, rebuildKeymap, eventKey, getCommand, altKeys } from '../commands.js';
import { caps } from '../theme.js';
import { PROVIDERS, aiState, refreshKey, complete } from '../ai/ai.js';
import { THEMES } from './menus.js';
import { keyCaps } from './tools.js';
import { clearSpellCache } from '../editor/proof.js';

export const APP = { version: '1.0.0', sys: {}, spellLangs: [], fonts: null };

const SECTIONS = [
  ['general', 'settings-2'], ['appearance', 'palette'], ['editor', 'pen-line'], ['reader', 'book-open'], ['encodings', 'file-code'],
  ['proof', 'spell-check'], ['ai', 'sparkles'], ['keys', 'keyboard'], ['updates', 'refresh-cw'], ['advanced', 'wrench'],
];
const EMBEDDED = { ui: ['Inter'], text: ['Inter', 'Literata', 'JetBrains Mono'], mono: ['JetBrains Mono'], read: ['Literata', 'Inter'] };
const ENC_OPTS = ['utf-8', 'utf-16le', 'windows-1251', 'cp866', 'koi8-r', 'windows-1252', 'windows-1250', 'gb18030', 'big5', 'shift_jis', 'euc-kr'];

let dlg = null, section = 'general';

export function openSettings(sec) {
  if (sec && SECTIONS.some(s => s[0] === sec)) section = sec;
  if (dlg) { renderSection(); return; }
  const box = el(`<div class="settings"><nav class="s-nav"><div class="ttl">${esc(t('set.title'))}</div><div class="its"></div><div class="foot">Folio ${esc(APP.version)}<br>${esc(t('set.autosaved'))}</div></nav><div class="s-main"><div class="s-head"></div><div class="s-body"></div><div class="s-foot"><button class="btn ghost sm" data-reset-sec>${I('rotate-ccw', 'xs')}${esc(t('set.resetSection'))}</button><span class="grow"></span><button class="btn primary" data-close>${esc(t('set.done'))}</button></div></div></div>`);
  dlg = modal(box, { cls: 'm-settings', label: t('set.title'), onClose: () => { dlg = null; stopCapture(); } });
  on(box, 'click', '.s-nav [data-sec]', (e, b) => { section = b.dataset.sec; renderSection(); });
  on(box, 'click', '[data-reset-sec]', async () => { if (await confirm({ title: t('set.resetSectionQ'), text: t('set.resetSectionText'), ok: t('set.reset'), danger: true, icon: 'rotate-ccw' })) { resetSection(section); renderSection(); } });
  box.addEventListener('keydown', e => { if (capture) { e.preventDefault(); e.stopPropagation(); onCapture(e); } }, true);
  renderSection();
}

function renderNav() {
  $('.s-nav .its', dlg.el).innerHTML = SECTIONS.map(([id, ic]) => `<button class="it ${id === section ? 'on' : ''}" data-sec="${id}">${I(ic)}<span>${esc(t('set.' + id))}</span></button>`).join('');
}

function renderSection() {
  if (!dlg) return;
  renderNav();
  $('.s-head', dlg.el).innerHTML = `<div><h2>${esc(t('set.' + section))}</h2><p>${esc(t('set.' + section + '.d'))}</p></div><button class="icon-btn x" data-close title="${esc(t('dlg.close'))}">${I('x')}</button>`;
  const body = $('.s-body', dlg.el);
  body.innerHTML = SEC[section]();
  body.scrollTop = 0;
  wire(body);
  AFTER[section]?.(body);
}

// ---------- row builders ----------
const val = k => settings.get(k);
function tg(key, { hint = true, disabled = false, label, invert = false } = {}) {
  const on = invert ? !val(key) : val(key) !== false && val(key) != null && val(key) !== 0;
  const h = hint ? t('set.' + key + '.h') : '';
  return `<button class="trow ${disabled ? 'dis' : ''}" data-tg="${key}" ${invert ? 'data-inv="1"' : ''} ${disabled ? 'disabled' : ''}><span class="lb">${esc(label || t('set.' + key))}${h && h !== 'set.' + key + '.h' ? `<small>${esc(h)}</small>` : ''}</span><span class="tg ${on ? 'on' : ''}"></span></button>`;
}
function sel(key, opts, { label } = {}) {
  const cur = val(key);
  const o = opts.find(x => String(x[0]) === String(cur));
  return `<div class="frow"><span class="lb">${esc(label || t('set.' + key))}</span><button class="select" data-sel="${key}" data-opts='${esc(JSON.stringify(opts))}'><span>${esc(o ? o[1] : String(cur))}</span>${I('chevron-down', 'sm')}</button><span class="pv">${esc(o?.[2] || '')}</span></div>`;
}
function slider(key, min, max, step, fmt = v => v, { label } = {}) {
  const v = +val(key);
  const p = ((v - min) / (max - min)) * 100;
  return `<div class="frow"><span class="lb">${esc(label || t('set.' + key))}</span><div class="slider"><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-sl="${key}" style="--p:${p}%"></div><b class="sv" data-sv="${key}">${esc(fmt(v))}</b></div>`;
}
function txt(key, { placeholder = '', label, btn } = {}) {
  return `<div class="frow wide"><span class="lb">${esc(label || t('set.' + key))}</span><input class="inp" data-tx="${key}" value="${esc(val(key) || '')}" placeholder="${esc(placeholder)}" spellcheck="false">${btn || ''}</div>`;
}
const sec = (title, inner, cls = '') => `<div class="s-sec ${cls}">${title ? `<h3>${esc(t(title))}</h3>` : ''}${inner}</div>`;
const grid = (...rows) => `<div class="tgrid">${rows.join('')}</div>`;
const pct = v => Math.round(v * 100) + '%';

// ---------- sections ----------
const SEC = {
  general: () => sec('set.langH', sel('lang', [['auto', t('lang.auto')], ...Object.entries(LANG_NAMES)])) +
    sec('set.startH', grid(tg('restoreSession'), tg('hotExit'), tg('closeToTray'), tg('trayIcon'), tg('startWithWindows'), tg('startMinimized'), tg('escToTray'))) +
    sec('set.saveH', sel('autosave', [['off', t('set.autosave.off')], ['focus', t('set.autosave.focus')], ['30s', t('set.autosave.30s')]]) + slider('recentMax', 5, 50, 1)) +
    sec('set.notesH', `<div class="frow"><span class="lb">${esc(t('set.hotkeyQuickNote'))}</span><button class="keycap" data-hk="hotkeyQuickNote">${keyCaps(val('hotkeyQuickNote') || '—')}</button><span class="pv">${esc(t('set.global'))}</span></div>
      <div class="frow"><span class="lb">${esc(t('set.hotkeyShow'))}</span><button class="keycap" data-hk="hotkeyShow">${keyCaps(val('hotkeyShow') || '—')}</button><span class="pv">${esc(t('set.global'))}</span></div>` +
      txt('quickNotesFile', { placeholder: (APP.sys.notesDir || 'Documents\\Folio') + '\\' + t('qn.defaultFile'), btn: `<button class="btn ghost sm" data-act="pickNotes">${esc(t('set.browse'))}</button>` })),

  appearance: () => sec('set.themeH', `<div class="themes">${THEMES.map(([id]) => themeCard(id)).join('')}</div>` +
      grid(tg('systemTheme', { label: t('theme.system'), hint: false }), tg('smoothTheme'), tg('animations'), tg('backdrop', { disabled: !caps.backdrop }))) +
    (val('theme') === 'system' ? sec('', sel('themeLight', [['paper', t('theme.paper')], ['sepia', t('theme.sepia')], ['glass', t('theme.glass')]]) + sel('themeDark', [['graphite', t('theme.graphite')]])) : '') +
    sec('set.fontsH', fontRow('fontUi', 'ui') + fontRow('fontText', 'text') + fontRow('fontMono', 'mono') + fontRow('fontRead', 'read')) +
    sec('set.sizesH', slider('fontSize', 12, 26, 0.5, v => v + ' px') + slider('lineHeight', 1.2, 2.2, 0.05, v => (+v).toFixed(2)) + slider('sheetWidth', 560, 1400, 20, v => v + ' px') + slider('codeFontSize', 10, 22, 0.5, v => v + ' px') +
      sel('uiScale', [[0.9, '90%'], [1, '100%'], [1.1, '110%'], [1.25, '125%'], [1.5, '150%']])),

  editor: () => sec('set.showH', grid(tg('wrap'), tg('wrapCode'), tg('lineNumbers'), tg('lineNumbersCode'), tg('minimap'), tg('toc'), tg('statusBar'), tg('highlightLine'), tg('wheelZoom'))) +
    sec('set.typingH', grid(tg('autoPairs'), tg('insertSpaces'), tg('markdownInTxt')) + sel('tabSize', [[2, '2'], [4, '4'], [8, '8']]) +
      sel('defaultMode', [['auto', t('set.defaultMode.auto')], ['standard', t('mode.standard')], ['coder', t('mode.coder')], ['proof', t('mode.proof')]])),

  reader: () => sec('set.readLayoutH', sel('reader.layout', [['book', t('reader.book')], ['feed', t('reader.feed')]], { label: t('set.readLayout') }) +
      slider('reader.width', 560, 1100, 20, v => v + ' px', { label: t('set.readWidth') }) + slider('reader.fontSize', 13, 24, 0.5, v => v + ' px', { label: t('set.readFont') }) +
      slider('reader.lineHeight', 1.3, 2.1, 0.02, v => (+v).toFixed(2), { label: t('set.readLh') }) +
      grid(tg('reader.serif', { label: t('set.readSerif'), hint: false }), tg('reader.showTime', { label: t('set.readTime'), hint: false }))) +
    sec('set.copyH', sel('copy.format', [['markdown', t('fmt.markdown')], ['plain', t('fmt.plain')], ['quote', t('fmt.quote')]], { label: t('set.copyFormat') }) +
      grid(tg('copy.names', { label: t('reader.optNames'), hint: false }), tg('copy.separator', { label: t('reader.optSep'), hint: false }), tg('copy.time', { label: t('reader.optTime'), hint: false }))),

  encodings: () => sec('set.newFilesH', sel('encDefault', ENC_OPTS.map(e => [e, encN(e)])) + grid(tg('bomDefault')) +
      sel('eolDefault', [['crlf', 'CRLF', 'Windows'], ['lf', 'LF', 'Unix, macOS'], ['cr', 'CR', 'Mac OS 9']])) +
    sec('set.detectH', sel('fallbackEncoding', [['auto', t('set.fallback.auto')], ...ENC_OPTS.filter(e => !e.startsWith('utf')).map(e => [e, encN(e)])]) + grid(tg('legacyBanner'))),

  proof: () => sec('set.spellLangsH', `<div class="langs">${(APP.spellLangs.length ? APP.spellLangs : ['en-US']).map(l => `<button class="chip ${(val('spellLangs') || []).includes(l) ? 'on' : ''}" data-spl="${esc(l)}">${esc(l)}</button>`).join('')}</div>
      <p class="hint">${I('info', 'xs')}${esc(t('set.spellHint'))}</p>`) +
    sec('set.rulesH', grid(tg('punctuation'), tg('spellInStandard'))) +
    sec('set.dictH', `<div class="dict"><div class="dict-add"><input class="inp" data-dict-in placeholder="${esc(t('set.dictAdd'))}" spellcheck="false"><button class="btn ghost sm" data-act="dictAdd">${I('plus', 'xs')}${esc(t('set.add'))}</button></div><div class="dict-list">${(val('dictionary') || []).map(w => `<span class="chip">${esc(w)}<i data-dict-rm="${esc(w)}">${I('x', 'xs')}</i></span>`).join('') || `<span class="mut">${esc(t('set.dictEmpty'))}</span>`}</div></div>`),

  ai: () => {
    const p = val('ai.provider'), P = PROVIDERS[p] || PROVIDERS.custom;
    return sec('set.aiConnH', sel('ai.provider', Object.entries(PROVIDERS).map(([id, x]) => [id, id === 'custom' ? t('ai.custom') : x.name, x.local ? t('ai.local') : '']), { label: t('ai.provider') }) +
      txt('ai.baseUrl', { label: t('ai.baseUrl'), placeholder: 'https://…/v1' }) +
      txt('ai.model', { label: t('ai.model'), btn: `<button class="btn ghost sm" data-act="models">${esc(t('set.list'))}</button>` }) +
      (P.noKey ? '' : `<div class="frow wide"><span class="lb">${esc(t('ai.key'))}</span><input class="inp" type="password" data-key placeholder="${esc(aiState.hasKey ? t('ai.keySaved') : 'sk-…')}" autocomplete="off" spellcheck="false"><button class="btn ghost sm" data-act="saveKey">${esc(t('set.save'))}</button>${aiState.hasKey ? `<button class="btn ghost sm" data-act="delKey">${esc(t('set.remove'))}</button>` : ''}</div>`) +
      `<div class="frow"><span class="lb"></span><button class="btn soft sm" data-act="testAi">${I('plug-zap', 'xs')}${esc(t('set.testAi'))}</button><span class="pv" data-test-res>${esc(aiState.hasKey || P.noKey ? '' : t('ai.noKey'))}</span></div>`) +
      sec('set.aiBehH', slider('ai.temperature', 0, 1.5, 0.05, v => (+v).toFixed(2), { label: t('set.temperature') }) +
        sel('ai.answerLang', [['auto', t('set.answer.auto')], ['ui', t('set.answer.ui')], ['Russian', 'Русский'], ['English', 'English'], ['Simplified Chinese', '中文']], { label: t('set.answerLang') }) +
        sel('ai.context', [['page', t('ai.ctxDoc')], ['none', t('ai.ctxNone')]], { label: t('set.aiContext') }) +
        sel('ai.maxChars', [[20000, '20 000'], [60000, '60 000'], [120000, '120 000'], [400000, '400 000']], { label: t('set.maxChars') }) +
        grid(tg('ai.stream', { label: t('set.stream'), hint: false }))) +
      `<p class="hint">${I('lock', 'xs')}${esc(t('ai.privacy'))}</p>`;
  },

  keys: () => `<label class="search">${I('search', 'sm')}<input data-kq placeholder="${esc(t('keys.search'))}" spellcheck="false"></label><div class="klist"></div><p class="hint">${I('info', 'xs')}${esc(t('set.keysHint'))}</p>`,

  updates: () => sec('', `<div class="upd-card card"><div class="uh">${I('refresh-cw')}<div><b>Folio ${esc(APP.version)}</b><span data-upd-status>${esc(t('upd.idle'))}</span></div><span class="grow"></span><button class="btn primary sm" data-act="checkUpd">${esc(t('upd.check'))}</button></div></div>`) +
    sec('', grid(tg('updates.auto', { label: t('set.updAuto'), hint: false }), tg('updates.beta', { label: t('set.updBeta'), hint: false }))) +
    `<p class="hint">${I('info', 'xs')}${esc(t('set.updHint'))}</p>`,

  advanced: () => sec('set.dataH', `<div class="frow wide"><span class="lb">${esc(t('set.dataDir'))}</span><code class="path">${esc(APP.sys.dataDir || '')}</code><button class="btn ghost sm" data-act="openData">${I('folder-open', 'xs')}${esc(t('set.open'))}</button></div>
      <div class="frow wide"><span class="lb">${esc(t('set.logs'))}</span><button class="btn ghost sm" data-act="logs">${I('scroll-text', 'xs')}${esc(t('cmd.help.logs'))}</button><button class="btn ghost sm" data-act="logsFolder">${I('folder-open', 'xs')}${esc(t('set.open'))}</button></div>`) +
    sec('set.backupH', `<div class="btn-row"><button class="btn ghost" data-act="export">${I('download', 'sm')}${esc(t('set.export'))}</button><button class="btn ghost" data-act="import">${I('upload', 'sm')}${esc(t('set.import'))}</button><button class="btn ghost" data-act="exportLang">${I('languages', 'sm')}${esc(t('set.langTemplate'))}</button></div>`) +
    sec('set.dangerH', `<div class="btn-row"><button class="btn danger" data-act="resetAll">${I('rotate-ccw', 'sm')}${esc(t('set.resetAll'))}</button></div>`),
};

const encN = e => ({ 'utf-8': 'UTF-8', 'utf-16le': 'UTF-16 LE', 'windows-1251': 'Windows-1251', cp866: 'CP866', 'koi8-r': 'KOI8-R', 'windows-1252': 'Windows-1252', 'windows-1250': 'Windows-1250', gb18030: 'GB18030', big5: 'Big5', shift_jis: 'Shift-JIS', 'euc-kr': 'EUC-KR' }[e] || e);

function themeCard(id) {
  const cur = val('theme') === id || (val('theme') === 'system' && false);
  return `<button class="th ${cur ? 'on' : ''}" data-theme-pick="${id}"><div class="pv th-${id}"><div class="bar"></div><div class="ln1"></div><div class="ln2"></div><div class="ln3"></div></div><div class="nm">${esc(t('theme.' + id))}${cur ? I('circle-check', 'sm') : ''}</div></button>`;
}

function fontRow(key, kind) {
  const list = [...EMBEDDED[kind], ...(APP.fonts || [])].filter((v, i, a) => a.indexOf(v) === i);
  const cur = val(key);
  const sample = kind === 'mono' ? 'const x = 42; // 0O1lI' : kind === 'read' ? 'Съешь же ещё этих мягких булок' : 'Быстрая заметка · Quick note';
  return `<div class="frow"><span class="lb">${esc(t('set.' + key))}</span><button class="select" data-font="${key}" data-kind="${kind}"><span>${esc(cur)}</span>${I('chevron-down', 'sm')}</button><span class="pv" style="font-family:'${esc(cur)}'">${esc(sample)}</span></div>`;
}

// ---------- behaviour ----------
function wire(body) {
  on(body, 'click', '[data-tg]', (e, b) => {
    const k = b.dataset.tg;
    if (k === 'systemTheme') { settings.set('theme', val('theme') === 'system' ? (val('themeLight') || 'paper') : 'system'); renderSection(); return; }
    const cur = val(k);
    settings.set(k, !(cur !== false && cur != null && cur !== 0));
    b.querySelector('.tg').classList.toggle('on');
    afterSet(k);
  });
  on(body, 'click', '[data-sel]', (e, b) => {
    const k = b.dataset.sel;
    const opts = JSON.parse(b.dataset.opts);
    openMenu(opts.map(([v, label, note]) => ({ label, note, checked: String(val(k)) === String(v), run: () => { settings.set(k, v); afterSet(k); renderSection(); } })), { anchor: b });
  });
  on(body, 'click', '[data-font]', async (e, b) => {
    const k = b.dataset.font, kind = b.dataset.kind;
    if (!APP.fonts) { try { APP.fonts = (await host.call('sys.fonts'))?.fonts || []; } catch { APP.fonts = []; } }
    const list = [...EMBEDDED[kind], ...APP.fonts].filter((v, i, a) => a.indexOf(v) === i);
    const m = openMenu([{ h: t('set.embedded') }, ...EMBEDDED[kind].map(f => fontItem(k, f)), '-', { h: t('set.system') }, ...list.filter(f => !EMBEDDED[kind].includes(f)).map(f => fontItem(k, f))], { anchor: b, cls: 'font-dd' });
    m.querySelector('.mi.chk')?.scrollIntoView({ block: 'center' });
  });
  on(body, 'click', '[data-theme-pick]', (e, b) => { settings.set('theme', b.dataset.themePick); if (b.dataset.themePick !== 'glass') settings.set(b.dataset.themePick === 'graphite' ? 'themeDark' : 'themeLight', b.dataset.themePick); renderSection(); });
  body.querySelectorAll('[data-sl]').forEach(r => {
    const k = r.dataset.sl;
    const out = body.querySelector(`[data-sv="${k}"]`);
    const fmt = out.textContent.includes('px') ? v => v + ' px' : out.textContent.includes('%') ? pct : Number.isInteger(+r.step) ? v => v : v => (+v).toFixed(2);
    const apply = debounce(v => settings.set(k, v), 60);
    r.addEventListener('input', () => { const v = +r.value; r.style.setProperty('--p', ((v - r.min) / (r.max - r.min)) * 100 + '%'); out.textContent = fmt(v); apply(v); });
  });
  body.querySelectorAll('[data-tx]').forEach(i => i.addEventListener('change', () => { settings.set(i.dataset.tx, i.value.trim()); afterSet(i.dataset.tx); }));
  on(body, 'click', '[data-hk]', (e, b) => startCapture(b, b.dataset.hk, true));
  on(body, 'click', '[data-spl]', (e, b) => {
    const l = b.dataset.spl; const cur = val('spellLangs') || [];
    settings.set('spellLangs', cur.includes(l) ? cur.filter(x => x !== l) : [...cur, l]);
    b.classList.toggle('on'); clearSpellCache();
  });
  on(body, 'click', '[data-dict-rm]', (e, b) => { settings.set('dictionary', (val('dictionary') || []).filter(w => w !== b.dataset.dictRm)); host.send('dict.save', { words: val('dictionary') }); clearSpellCache(); renderSection(); });
  on(body, 'click', '[data-act]', (e, b) => ACT[b.dataset.act]?.(b, body));
  const dictIn = body.querySelector('[data-dict-in]');
  dictIn?.addEventListener('keydown', e => { if (e.key === 'Enter') ACT.dictAdd(null, body); });
}

function fontItem(k, f) { return { label: f, checked: val(k) === f, cls: 'font-mi', html: undefined, run: () => { settings.set(k, f); renderSection(); } }; }

function afterSet(k) {
  if (k === 'startWithWindows') host.call('sys.autostart', { on: !!val(k) }).then(r => { if (r && r.ok === false) toast(t('set.autostartFail'), { kind: 'err', icon: 'triangle-alert' }); });
  if (k === 'trayIcon' || k === 'closeToTray') host.send('sys.tray', { icon: val('trayIcon') !== false, closeToTray: val('closeToTray') !== false });
  if (k === 'lang') setTimeout(renderSection, 30);
  if (k === 'ai.provider') { const P = PROVIDERS[val('ai.provider')]; if (P && val('ai.provider') !== 'custom') { settings.set('ai.baseUrl', P.baseUrl); settings.set('ai.model', P.model); } refreshKey().then(() => renderSection()); }
  if (k === 'punctuation' || k === 'spellInStandard') clearSpellCache();
}

function resetSection(s) {
  const keys = {
    general: ['lang', 'restoreSession', 'hotExit', 'closeToTray', 'trayIcon', 'startMinimized', 'escToTray', 'autosave', 'recentMax', 'hotkeyQuickNote', 'hotkeyShow', 'quickNotesFile'],
    appearance: ['theme', 'themeLight', 'themeDark', 'smoothTheme', 'animations', 'backdrop', 'fontUi', 'fontText', 'fontMono', 'fontRead', 'fontSize', 'lineHeight', 'sheetWidth', 'codeFontSize', 'uiScale'],
    editor: ['wrap', 'wrapCode', 'lineNumbers', 'lineNumbersCode', 'minimap', 'toc', 'statusBar', 'highlightLine', 'wheelZoom', 'autoPairs', 'insertSpaces', 'markdownInTxt', 'tabSize', 'defaultMode'],
    reader: ['reader', 'copy'], encodings: ['encDefault', 'bomDefault', 'eolDefault', 'fallbackEncoding', 'legacyBanner'],
    proof: ['spellLangs', 'punctuation', 'spellInStandard'], ai: ['ai'], keys: ['keys'], updates: ['updates'], advanced: [],
  }[s] || [];
  for (const k of keys) settings.set(k, structuredClone(DEFAULTS[k]));
  if (s === 'keys') rebuildKeymap();
  if (s === 'general') host.send('sys.hotkeys', { quickNote: val('hotkeyQuickNote'), show: val('hotkeyShow') });
}

// ---------- hotkey capture ----------
let capture = null;
/** True while a hotkey field is recording (the global key handler must stay out of the way). */
export const capturing = () => !!capture;
function startCapture(btn, key, global = false) {
  stopCapture();
  capture = { btn, key, global, old: btn.innerHTML };
  btn.classList.add('rec');
  btn.innerHTML = `<span class="rec-t">${esc(t('set.pressKeys'))}</span>`;
}
function stopCapture(restore = true) {
  if (!capture) return;
  if (restore) capture.btn.innerHTML = capture.old;
  capture.btn.classList.remove('rec');
  capture = null;
}
function onCapture(e) {
  const k = eventKey(e);
  if (!k) return;
  const c = capture;
  if (k === 'Esc') { stopCapture(); return; }
  if (k === 'Backspace' || k === 'Delete') { apply(c, ''); return; }
  if (c.global && !/^(Ctrl|Alt|Win)/.test(k)) return;
  apply(c, k);
}
async function apply(c, k) {
  stopCapture(false);
  if (c.global) {
    settings.set(c.key, k);
    const r = await host.call('sys.hotkeys', { quickNote: val('hotkeyQuickNote'), show: val('hotkeyShow') }).catch(() => null);
    if (r?.failed?.length) toast(t('set.hotkeyBusy', { k }), { kind: 'err', icon: 'triangle-alert', ms: 5000 });
  } else {
    const conflict = allCommands().find(x => x.id !== c.key && k && altKeys(keysOf(x.id)).includes(k));
    const keys = { ...(val('keys') || {}) };
    keys[c.key] = k;
    if (conflict) keys[conflict.id] = '';
    settings.set('keys', keys);
    rebuildKeymap();
    if (conflict) toast(t('set.keyMoved', { k, cmd: titleOf(conflict) }), { icon: 'info' });
  }
  renderSection();
}

// ---------- per-section post-render ----------
const AFTER = {
  keys: body => {
    const inp = $('[data-kq]', body);
    const list = $('.klist', body);
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      const over = val('keys') || {};
      list.innerHTML = allCommands().filter(c => c.palette !== false || c.keys).filter(c => !q || titleOf(c).toLowerCase().includes(q) || keysOf(c.id).toLowerCase().includes(q))
        .map(c => `<div class="krow"><span class="kt">${I(c.icon || 'terminal', 'xs')}${esc(titleOf(c))}</span><button class="keycap" data-kc="${c.id}">${keysOf(c.id) ? keyCaps(keysOf(c.id)) : `<span class="mut">${esc(t('set.noKey'))}</span>`}</button>${over[c.id] !== undefined ? `<button class="icon-btn xs" data-kr="${c.id}" title="${esc(t('set.reset'))}">${I('rotate-ccw', 'xs')}</button>` : '<span class="kr0"></span>'}</div>`).join('');
    };
    inp.addEventListener('input', draw);
    on(list, 'click', '[data-kc]', (e, b) => startCapture(b, b.dataset.kc));
    on(list, 'click', '[data-kr]', (e, b) => { const keys = { ...(val('keys') || {}) }; delete keys[b.dataset.kr]; settings.set('keys', keys); rebuildKeymap(); draw(); });
    draw();
  },
  updates: body => { const s = body.querySelector('[data-upd-status]'); if (APP.lastUpdate) s.textContent = APP.lastUpdate; },
};

const ACT = {
  async pickNotes() { const r = await host.call('file.saveDialog', { name: t('qn.defaultFile'), dir: APP.sys.notesDir || '', encoding: 'utf-8', noOverwritePrompt: true }); if (r?.path) { settings.set('quickNotesFile', r.path); renderSection(); } },
  dictAdd(b, body) { const i = body.querySelector('[data-dict-in]'); const w = i.value.trim(); if (!w) return; const d = val('dictionary') || []; if (!d.includes(w)) settings.set('dictionary', [...d, w].sort((a, b2) => a.localeCompare(b2))); host.send('dict.save', { words: val('dictionary') }); clearSpellCache(); renderSection(); setTimeout(() => $('[data-dict-in]')?.focus(), 20); },
  async models(b) {
    let models = [];
    try { models = (await host.call('ai.models', { provider: val('ai.provider'), baseUrl: val('ai.baseUrl') }))?.models || []; } catch (e) { toast(e.message, { kind: 'err', icon: 'triangle-alert' }); return; }
    if (!models.length) { toast(t('set.noModels'), { icon: 'info' }); return; }
    openMenu(models.slice(0, 40).map(m => ({ label: m, checked: m === val('ai.model'), run: () => { settings.set('ai.model', m); renderSection(); } })), { anchor: b });
  },
  async saveKey(b, body) { const k = body.querySelector('[data-key]').value.trim(); if (!k) return; await host.call('ai.setKey', { provider: val('ai.provider'), key: k }); aiState.hasKey = true; toast(t('ai.keySavedToast'), { icon: 'key-round' }); renderSection(); },
  async delKey() { await host.call('ai.setKey', { provider: val('ai.provider'), key: '' }); aiState.hasKey = false; renderSection(); },
  async testAi(b, body) {
    const res = body.querySelector('[data-test-res]');
    res.textContent = t('set.testing'); res.className = 'pv';
    const t0 = performance.now();
    try {
      const r = await complete([{ role: 'system', content: 'Task: ping\nReply with the single word OK.' }, { role: 'user', content: 'ping' }]);
      res.textContent = t('set.testOk', { ms: Math.round(performance.now() - t0), model: r.model || val('ai.model') }); res.className = 'pv ok';
    } catch (e) { res.textContent = (t('aiErr.' + (e.code || 'error')) || e.message) + (e.message && e.code !== 'auth' ? ` (${e.message})` : ''); res.className = 'pv err'; }
  },
  async checkUpd(b, body) {
    const s = body.querySelector('[data-upd-status]');
    s.textContent = t('upd.checking');
    const { checkUpdates } = await import('./about.js');
    const r = await checkUpdates({ manual: true });
    s.textContent = APP.lastUpdate = r?.newer ? t('upd.available', { v: r.latest }) : r?.error ? t('upd.error') : t('upd.latest');
  },
  openData() { host.send('sys.openDataDir'); },
  logs() { dlg?.close(); import('./logs.js').then(m => m.toggleLogs(true)); },
  logsFolder() { host.send('log.openFolder'); },
  async export() { const r = await host.call('settings.export', { settings: settings.all }); if (r?.path) toast(t('set.exported'), { icon: 'download' }); },
  async import() { const r = await host.call('settings.import'); if (r?.settings) { settings.load(r.settings); settings.set('zoom', settings.get('zoom'), {}); rebuildKeymap(); toast(t('set.imported'), { icon: 'upload' }); renderSection(); location.reload(); } },
  async exportLang() { const r = await host.call('lang.exportTemplate', { template: { code: 'xx', name: 'My language', basedOn: 'en', table: LANGS.en } }); if (r?.path) toast(t('set.exported'), { icon: 'download' }); },
  async resetAll() { if (await confirm({ title: t('set.resetAllQ'), text: t('set.resetAllText'), ok: t('set.reset'), danger: true, icon: 'rotate-ccw' })) { settings.reset(); rebuildKeymap(); renderSection(); toast(t('set.resetDone'), { icon: 'rotate-ccw' }); } },
};

export function settingsOpen() { return !!dlg; }
