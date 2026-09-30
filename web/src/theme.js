// Theme, fonts, sizes and text zoom → CSS variables on <html>. Tells the host about dark/light for the native frame.
import { settings } from './settings.js';
import { host } from './host.js';
import { bus, clamp } from './util.js';

const mq = matchMedia('(prefers-color-scheme: dark)');
export const DARK_THEMES = new Set(['graphite']);
export const caps = { win11: false };

export function resolvedTheme() {
  const th = settings.get('theme');
  if (th === 'system') return mq.matches ? (settings.get('themeDark') || 'graphite') : (settings.get('themeLight') || 'paper');
  return ['paper', 'graphite', 'sepia', 'glass'].includes(th) ? th : 'paper';
}
export const isDark = () => DARK_THEMES.has(resolvedTheme());

let first = true, themingTimer = 0;
export function applyTheme() {
  const root = document.documentElement;
  const th = resolvedTheme();
  const dark = DARK_THEMES.has(th);
  if (!first && root.dataset.theme !== th && settings.get('smoothTheme') !== false && settings.get('animations') !== false) {
    root.classList.add('theming');
    clearTimeout(themingTimer);
    themingTimer = setTimeout(() => root.classList.remove('theming'), 560);
  }
  root.dataset.theme = th;
  root.dataset.dark = dark ? '1' : '0';
  const cs = getComputedStyle(root);
  host.send('win.theme', { theme: th, dark, bg: cs.getPropertyValue('--solid').trim() || (dark ? '#1A1B1E' : '#F6F5F1') });
  first = false;
  bus.emit('theme', th);
}

/** Sun/moon button: flips between the preferred light and dark theme. */
export function toggleTheme() {
  const cur = resolvedTheme();
  if (DARK_THEMES.has(cur)) settings.set('theme', settings.get('themeLight') && !DARK_THEMES.has(settings.get('themeLight')) ? settings.get('themeLight') : 'paper');
  else { if (cur !== 'glass') settings.set('themeLight', cur); settings.set('theme', settings.get('themeDark') || 'graphite'); }
}

const FALLBACK = {
  ui: '"Noto Sans SC","Microsoft YaHei UI","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif',
  mono: '"Cascadia Mono","Noto Sans Mono CJK SC",Consolas,"Courier New",monospace',
  serif: '"Noto Serif SC","SimSun",Georgia,"Times New Roman",serif',
};
const q = f => (/^[\w-]+$/.test(f) ? f : `"${String(f).replace(/"/g, '')}"`);

export function applySizes() {
  const s = settings.all;
  const r = document.documentElement.style;
  const z = clamp(+s.zoom || 1, 0.5, 3);
  r.setProperty('--z', z);
  r.setProperty('--ui', `${q(s.fontUi || 'Inter')},${FALLBACK.ui}`);
  r.setProperty('--text-font', `${q(s.fontText || 'Inter')},${FALLBACK.ui}`);
  r.setProperty('--mono', `${q(s.fontMono || 'JetBrains Mono')},${FALLBACK.mono}`);
  r.setProperty('--serif', `${q(s.fontRead || 'Literata')},${FALLBACK.serif}`);
  r.setProperty('--fs', (s.fontSize || 16) + 'px');
  r.setProperty('--code-fs', (s.codeFontSize || 13.5) + 'px');
  r.setProperty('--lh', s.lineHeight || 1.75);
  r.setProperty('--sheet-w', (s.sheetWidth || 780) + 'px');
  r.setProperty('--read-fs', (s.reader?.fontSize || 16.5) + 'px');
  r.setProperty('--read-lh', s.reader?.lineHeight || 1.66);
  r.setProperty('--read-w', (s.reader?.width || 760) + 'px');
  document.documentElement.classList.toggle('static', s.animations === false);
  document.documentElement.classList.toggle('read-sans', s.reader?.serif === false);
}

// ---- text zoom (editor + reader); the UI scale is separate (host zoom factor) ----
const STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2, 2.25, 2.5, 3];
export function setZoom(z, showHud = true) {
  z = clamp(Math.round(z * 100) / 100, 0.5, 3);
  settings.set('zoom', z);
  if (showHud) import('./ui/dialogs.js').then(m => m.hud(Math.round(z * 100), (z - 0.5) / 2.5 * 100));
}
export function zoomStep(dir) {
  const z = settings.get('zoom') || 1;
  const next = dir > 0 ? STEPS.find(s => s > z + 0.001) ?? 3 : [...STEPS].reverse().find(s => s < z - 0.001) ?? 0.5;
  setZoom(next);
}

export function initTheme() {
  applySizes();
  applyTheme();
  mq.addEventListener('change', () => { if (settings.get('theme') === 'system') applyTheme(); });
  settings.on('*', path => {
    if (['theme', 'themeLight', 'themeDark'].includes(path) || path === '') applyTheme();
    if (/^(zoom|font|lineHeight|sheetWidth|codeFontSize|animations|reader)/.test(path) || path === '') applySizes();
    if (path === 'uiScale' || path === '') host.send('win.uiScale', { factor: settings.get('uiScale') || 1 });
  });
  // Ctrl + wheel = text zoom (the WebView's own zoom is disabled by the host)
  let acc = 0;
  addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (settings.get('wheelZoom') === false) return;
    acc += e.deltaY;
    if (Math.abs(acc) < 40) return;
    const z = settings.get('zoom') || 1;
    setZoom(z + (acc < 0 ? 0.1 : -0.1));
    acc = 0;
  }, { passive: false });
}
