// About window, update check / download / install.
import { $, el, esc, I, LOGO, fmtSize } from '../util.js';
import { t, lang } from '../i18n.js';
import { settings } from '../settings.js';
import { host } from '../host.js';
import { modal, toast } from './dialogs.js';
import { renderMd } from '../reader/md.js';
import { APP } from './settings-ui.js';

export const REPO = 'https://github.com/helpfulbriefl/folio';
export const SITE = 'https://helpfulbriefl.github.io/';
let last = null, dlg = null, downloading = false;

export async function checkUpdates({ manual = false } = {}) {
  try {
    const r = await host.call('update.check', { beta: !!settings.get('updates.beta') });
    last = r;
    if (r?.newer && !manual) toast(t('upd.availableToast', { v: r.latest }), { icon: 'download', ms: 12000, action: { label: t('upd.more'), run: () => openAbout() } });
    renderUpd();
    return r;
  } catch (e) {
    last = { error: e.message || String(e) };
    renderUpd();
    return last;
  }
}

export function openAbout() {
  if (dlg) return;
  const sys = APP.sys || {};
  const box = el(`<div class="about">
    <div class="ab-top">${LOGO('big')}<div><h2>Folio</h2><p>${esc(t('about.version', { v: APP.version }))} · ${esc(sys.arch || 'x64')}${sys.webview ? ' · WebView2 ' + esc(sys.webview) : ''}</p></div></div>
    <div class="ab-desc">${esc(t('about.desc'))}</div>
    <div class="links">
      <button class="btn ghost sm" data-url="${REPO}">${I('github', 'xs')}GitHub</button>
      <button class="btn ghost sm" data-url="${REPO}/releases">${I('tag', 'xs')}${esc(t('about.releases'))}</button>
      <button class="btn ghost sm" data-report>${I('bug', 'xs')}${esc(t('cmd.help.report'))}</button>
      <button class="btn ghost sm" data-url="${SITE}">${I('globe', 'xs')}${esc(t('about.site'))}</button>
    </div>
    <div class="upd"></div>
    <div class="ab-foot"><span>© 2026 yumi · ${esc(t('about.license'))}</span><span class="grow"></span><span class="mut">${esc(sys.os || '')}</span><button class="btn primary sm" data-close>${esc(t('dlg.close'))}</button></div></div>`);
  dlg = modal(box, { cls: 'm-about', label: t('cmd.help.about'), onClose: () => { dlg = null; } });
  box.addEventListener('click', e => {
    const u = e.target.closest('[data-url]');
    if (u) host.send('sys.openUrl', { url: u.dataset.url });
    if (e.target.closest('[data-report]')) reportBug();
    if (e.target.closest('[data-upd-check]')) { last = { checking: true }; renderUpd(); checkUpdates({ manual: true }); }
    if (e.target.closest('[data-upd-get]')) download();
    if (e.target.closest('[data-upd-restart]')) host.send('update.install');
    if (e.target.closest('[data-upd-page]')) host.send('sys.openUrl', { url: last?.url || REPO + '/releases/latest' });
  });
  if (!last || last.error) { last = { checking: true }; checkUpdates({ manual: true }); }
  renderUpd();
}

function renderUpd() {
  const box = dlg && $('.upd', dlg.el);
  if (!box) return;
  const r = last || {};
  if (r.checking) { box.innerHTML = `<div class="hd">${I('refresh-cw', 'sm spin')}${esc(t('upd.checking'))}</div>`; return; }
  if (r.error) { box.innerHTML = `<div class="hd">${I('wifi-off', 'sm')}${esc(t('upd.error'))}<span class="grow"></span><button class="btn ghost sm" data-upd-check>${esc(t('upd.retry'))}</button></div><div class="meta"><span>${esc(r.error)}</span></div>`; return; }
  if (r.ready) { box.innerHTML = `<div class="hd">${I('circle-check', 'sm')}${esc(t('upd.ready', { v: r.latest }))}</div><div class="meta"><span>${esc(t('upd.readyHint'))}</span></div><button class="btn primary" data-upd-restart>${I('rotate-cw', 'sm')}${esc(t('upd.restart'))}</button>`; return; }
  if (r.progress != null) { box.innerHTML = `<div class="hd">${I('download', 'sm')}${esc(t('upd.downloading', { v: r.latest }))}</div><div class="pbar" style="margin-top:10px"><i style="width:${r.progress}%"></i></div><div class="meta"><span>${esc(r.total ? fmtSize(r.received || 0) + ' / ' + fmtSize(r.total) : '')}</span><span>${r.progress}%</span></div>`; return; }
  if (r.newer) {
    box.innerHTML = `<div class="hd">${I('sparkles', 'sm')}${esc(t('upd.available', { v: r.latest }))}<span class="badge b-teal">${esc(r.published ? new Date(r.published).toLocaleDateString(lang() === 'en' ? 'en-GB' : lang()) : '')}</span></div>
      ${r.notes ? `<div class="notes md">${renderMd(r.notes.slice(0, 3000))}</div>` : ''}
      <div class="row"><button class="btn primary" data-upd-get>${I('download', 'sm')}${esc(t('upd.install'))}${r.size ? ` · ${esc(fmtSize(r.size))}` : ''}</button><button class="btn ghost" data-upd-page>${esc(t('upd.page'))}</button></div>`;
    return;
  }
  box.innerHTML = `<div class="hd">${I('circle-check', 'sm')}${esc(t('upd.latest'))}<span class="grow"></span><button class="btn ghost sm" data-upd-check>${esc(t('upd.check'))}</button></div><div class="meta"><span>${esc(t('upd.channel'))}: ${esc(settings.get('updates.beta') ? 'beta' : 'stable')}</span><span>${esc(t('upd.auto'))}: ${esc(settings.get('updates.auto') !== false ? t('upd.on') : t('upd.off'))}</span></div>`;
}

host.on('update.progress', d => { if (last && downloading) { Object.assign(last, { progress: Math.round(d.pct || 0), received: d.received, total: d.total }); renderUpd(); } });

async function download() {
  if (downloading || !last?.newer) return;
  downloading = true;
  Object.assign(last, { progress: 0 });
  renderUpd();
  try {
    const r = await host.call('update.download', {});
    if (!r?.ok) throw new Error(r?.message || 'download failed');
    last = { ...last, progress: null, ready: true };
  } catch (e) {
    last = { ...last, progress: null, error: e.message || String(e) };
  } finally { downloading = false; renderUpd(); }
}

export function reportBug() {
  const sys = APP.sys || {};
  const body = `**${t('report.what')}**\n\n\n**${t('report.steps')}**\n1. \n\n---\nFolio ${APP.version} · ${sys.os || ''} · WebView2 ${sys.webview || ''} · ${lang()}`;
  host.send('sys.openUrl', { url: `${REPO}/issues/new?title=${encodeURIComponent(t('report.title'))}&body=${encodeURIComponent(body)}` });
}
