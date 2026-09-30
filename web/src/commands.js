// Command registry + keyboard shortcuts. Menus, palette and hotkeys all go through here.
import { settings } from './settings.js';
import { t } from './i18n.js';

const cmds = new Map();
let keymap = new Map();

/** def: {id, title (i18n key) | label(), keys, icon, run(arg), enabled(), checked(), palette:false, global:true} */
export function command(def) { cmds.set(def.id, def); }
export function commands(list) { list.forEach(command); rebuildKeymap(); }
export const getCommand = id => cmds.get(id);
export const allCommands = () => [...cmds.values()];

export function run(id, arg) {
  const c = cmds.get(id);
  if (!c) { console.warn('unknown command', id); return; }
  if (c.enabled && !c.enabled()) return;
  try { return c.run(arg); } catch (e) { console.error(id, e); import('./ui/dialogs.js').then(m => m.toastError(e)); }
}

export function titleOf(c) { return c.label ? c.label() : t(c.title || c.id); }

export function keysOf(id) {
  const over = settings.get('keys')?.[id];
  if (over !== undefined) return over || '';
  return cmds.get(id)?.keys || '';
}

/** Alternative shortcuts are separated by " / " (with spaces), so "Ctrl+/" stays one key. */
export const altKeys = k => String(k || '').split(/\s+\/\s+/).map(x => x.trim()).filter(Boolean);

export function rebuildKeymap() {
  keymap = new Map();
  for (const c of cmds.values()) {
    const k = keysOf(c.id);
    if (!k) continue;
    for (const one of altKeys(k)) keymap.set(normalize(one), c.id);
  }
}

export function normalize(k) {
  const parts = k.split('+').map(p => p.trim()).filter(Boolean);
  const mods = [];
  let key = '';
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'ctrl' || l === 'control') mods.push('Ctrl');
    else if (l === 'alt') mods.push('Alt');
    else if (l === 'shift') mods.push('Shift');
    else if (l === 'win' || l === 'meta') mods.push('Win');
    else key = p.length === 1 ? p.toUpperCase() : p;
  }
  const order = ['Ctrl', 'Alt', 'Shift', 'Win'];
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (key === '−') key = '-';
  if (key === 'Plus') key = '=';
  return [...mods, key].join('+');
}

const CODE_KEYS = {
  Escape: 'Esc', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Minus: '-', Equal: '=', Backquote: '`', Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
  NumpadAdd: '=', NumpadSubtract: '-', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', PageUp: 'PageUp', PageDown: 'PageDown',
  Home: 'Home', End: 'End', Insert: 'Insert',
};

export function eventKey(e) {
  let key;
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^Numpad\d$/.test(c)) key = c.slice(6);
  else if (/^F\d{1,2}$/.test(c)) key = c;
  else key = CODE_KEYS[c] || (e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (!key || ['Control', 'Shift', 'Alt', 'Meta', 'OS'].includes(key)) return '';
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Win');
  return [...mods, key].join('+');
}

export function commandForEvent(e) {
  const k = eventKey(e);
  return k ? keymap.get(k) : undefined;
}

/** Shows shortcuts the way Windows users expect them. */
export function prettyKeys(k) {
  if (!k) return '';
  return (altKeys(k)[0] || '').replace(/\+-$/, '+−').replace(/\+Plus$/, '++').replace(/\+=$/, '++');
}
