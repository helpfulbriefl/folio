// Interface language: ru / en / zh built in, more via JSON files (Settings → Language → Add).
import ru from './lang/ru.js';
import en from './lang/en.js';
import zh from './lang/zh.js';
import { Emitter } from './util.js';

export const LANGS = { ru, en, zh };
export const LANG_NAMES = { ru: 'Русский', en: 'English', zh: '中文（简体）' };
const bus = new Emitter();
let cur = 'en';
let dict = en;

export function setLang(code) {
  if (!LANGS[code]) code = 'en';
  cur = code;
  dict = LANGS[code];
  document.documentElement.lang = code === 'zh' ? 'zh-CN' : code;
  bus.emit('change', code);
}
export const lang = () => cur;
export const onLang = fn => bus.on('change', fn);

export function addLang(code, name, table) {
  LANGS[code] = { ...en, ...table };
  LANG_NAMES[code] = name;
}

/** t('key', {n: 5}) – {n} placeholders; {n|форма1|форма2|форма5} for plural forms */
export function t(key, vars) {
  let s = dict[key] ?? en[key] ?? ru[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)(\|[^}]*)?\}/g, (m, k, forms) => {
    const v = vars[k];
    if (forms) {
      const f = forms.slice(1).split('|');
      return pluralForm(Number(v), f);
    }
    return v ?? '';
  });
  return s;
}

function pluralForm(n, f) {
  if (cur === 'ru' || cur === 'uk') {
    const m = n % 10, h = n % 100;
    return (m === 1 && h !== 11 ? f[0] : (m >= 2 && m <= 4 && (h < 12 || h > 14)) ? f[1] : f[2] ?? f[1]) ?? '';
  }
  if (cur === 'zh') return f[0] ?? '';
  return (n === 1 ? f[0] : f[1] ?? f[0]) ?? '';
}

/** English by default; follow the Windows UI locale only when explicitly set to 'auto'. */
export function pickLang(pref, locale) {
  if (pref !== 'auto') return LANGS[pref] ? pref : 'en';
  const l = (locale || navigator.language || 'en').toLowerCase();
  if (l.startsWith('ru') || l.startsWith('uk') || l.startsWith('be') || l.startsWith('kk')) return 'ru';
  if (l.startsWith('zh')) return 'zh';
  return 'en';
}
