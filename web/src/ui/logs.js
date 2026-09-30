// Event log panel at the bottom of the window (Help → Event log).
import { $, esc, I, on } from '../util.js';
import { t, lang } from '../i18n.js';
import { host } from '../host.js';
import { toast } from './dialogs.js';

let open = false, lines = [], filter = 'all', off = null, path = '';

export const logsOpen = () => open;
export async function toggleLogs(force) {
  open = force ?? !open;
  const box = $('#logs');
  if (!open) { box.innerHTML = ''; off?.(); off = null; return; }
  try { const r = await host.call('log.read', { max: 800 }); lines = r?.lines || []; path = r?.path || ''; } catch { lines = []; }
  off = host.on('log.entry', d => { lines.push(d); if (lines.length > 2000) lines.shift(); renderBody(true); });
  render();
}

function render() {
  const box = $('#logs');
  const f = k => `<button class="chip sm ${filter === k ? 'on' : ''}" data-lf="${k}">${esc(t('logs.' + k))}</button>`;
  box.innerHTML = `<div class="logs enter"><div class="logs-h"><span class="ttl">${I('scroll-text', 'sm')}${esc(t('cmd.help.logs'))}</span>${f('all')}${f('info')}${f('warn')}${f('error')}<span class="grow"></span>
    <button class="icon-btn" data-la="copy" title="${esc(t('reader.copy'))}">${I('copy', 'sm')}</button><button class="icon-btn" data-la="folder" title="${esc(path)}">${I('folder-open', 'sm')}</button><button class="icon-btn" data-la="clear" title="${esc(t('logs.clear'))}">${I('trash-2', 'sm')}</button><button class="icon-btn" data-la="close" title="${esc(t('dlg.close'))}">${I('x', 'sm')}</button></div><div class="logs-b"></div></div>`;
  renderBody();
}

const lvl = l => (l === 'warning' ? 'warn' : l === 'err' ? 'error' : l || 'info');
function renderBody(stick = false) {
  const b = $('#logs .logs-b');
  if (!b) return;
  const atEnd = b.scrollTop + b.clientHeight >= b.scrollHeight - 8;
  const list = lines.filter(x => filter === 'all' || lvl(x.level) === filter).slice(-600);
  b.innerHTML = list.length ? list.map(x => {
    const d = new Date(x.t);
    const tm = isNaN(d) ? String(x.t || '') : d.toLocaleTimeString(lang() === 'en' ? 'en-GB' : lang(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<div class="lg ${lvl(x.level)}"><span class="tm">${esc(tm)}</span><span class="lv">${esc(lvl(x.level).toUpperCase())}</span><span class="tx" title="${esc(x.msg)}">${esc(x.msg)}</span></div>`;
  }).join('') : `<div class="lg empty"><span class="tx">${esc(t('logs.empty'))}</span></div>`;
  if (!stick || atEnd) b.scrollTop = b.scrollHeight;
}

document.addEventListener('click', async e => {
  const f = e.target.closest('#logs [data-lf]');
  if (f) { filter = f.dataset.lf; render(); return; }
  const a = e.target.closest('#logs [data-la]');
  if (!a) return;
  const k = a.dataset.la;
  if (k === 'close') toggleLogs(false);
  else if (k === 'folder') host.send('log.openFolder');
  else if (k === 'clear') { await host.call('log.clear'); lines = []; renderBody(); }
  else if (k === 'copy') { await host.call('clipboard.write', { text: lines.map(x => `${x.t} [${lvl(x.level)}] ${x.msg}`).join('\r\n') }); toast(t('toast.copied')); }
});
