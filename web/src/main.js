// Entry point: asks the host for the initial state, builds the UI, restores the session.
import { $, esc } from './util.js';
import { host } from './host.js';
import { settings } from './settings.js';
import { setLang, pickLang, addLang, t } from './i18n.js';
import { buildChrome } from './ui/chrome.js';
import { editor } from './editor/editor.js';
import { initReader } from './reader/reader.js';
import { initToc } from './ui/toc.js';
import { initTheme, caps } from './theme.js';
import { docs, restoreSession } from './docs.js';
import { proofAvailable } from './editor/proof.js';
import { APP } from './ui/settings-ui.js';
import { aiState } from './ai/ai.js';
import { initApp, app, openWelcome, sendNativeStrings } from './app.js';
import { checkUpdates } from './ui/about.js';

function report(level, msg) {
  try { host.send('log.write', { level, msg: String(msg).slice(0, 4000) }); } catch { }
}
addEventListener('error', e => report('error', `${e.message} @ ${e.filename?.split('/').pop()}:${e.lineno}:${e.colno}${e.error?.stack ? '\n' + e.error.stack : ''}`));
addEventListener('unhandledrejection', e => { const r = e.reason; if (r?.code === 'cancelled') return; report('error', 'unhandled: ' + (r?.stack || r?.message || JSON.stringify(r))); });

function fatal(e) {
  console.error(e);
  report('error', 'startup failed: ' + (e?.stack || e?.message || e));
  document.body.innerHTML = `<div class="fatal"><h1>Folio</h1><p>Не удалось запустить интерфейс / The interface failed to start.</p><pre>${esc(e?.stack || e?.message || String(e))}</pre></div>`;
}

async function boot() {
  const init = await host.call('app.init');
  settings.load(init.settings || {});
  app.locale = init.locale || navigator.language;
  app.primary = init.sys?.primary !== false;
  for (const l of init.langs || []) { try { addLang(l.code, l.name, l.table || {}); } catch (e) { console.warn('lang', l?.code, e); } }
  setLang(pickLang(settings.get('lang'), app.locale));
  Object.assign(APP, { version: init.version || APP.version, sys: init.sys || {}, spellLangs: init.spell?.langs || [] });
  caps.win11 = !!init.sys?.win11;
  caps.backdrop = (init.sys?.build || 0) >= 22621;
  proofAvailable(init.spell?.langs || []);
  aiState.hasKey = !!init.hasAiKey;
  aiState.checked = init.hasAiKey !== undefined;
  docs.recent = init.recent || [];
  document.documentElement.classList.toggle('secondary', !app.primary);
  document.documentElement.classList.toggle('mock', !!init.sys?.mock);

  initTheme();
  buildChrome($('#app'));
  editor.init($('#ed'));
  initReader($('#reader'));
  initToc();
  initApp();
  sendNativeStrings();
  await restoreSession(app.primary ? init.session : null, init.args || []);
  if (init.flags?.firstRun && !init.flags?.selftest && app.primary && !(init.args || []).length) openWelcome();
  if (settings.get('topmost')) host.send('win.topmost', { on: true });
  host.send('app.ready', { theme: document.documentElement.dataset.theme });
  requestAnimationFrame(() => document.documentElement.classList.add('ready'));
  if (init.flags?.selftest) {
    window.__folio = { settings, docs }; // lets the host part of the self-test switch themes
    const m = await import('./selftest.js');
    m.runSelfTest(init);
  } else if (settings.get('updates.auto') !== false && !init.sys?.mock) {
    setTimeout(() => checkUpdates(), 6000);
  }
  if (!init.flags?.selftest && app.primary && init.sys?.hotkeyFailed?.length) {
    const { toast } = await import('./ui/dialogs.js');
    toast(t('hk.failed', { keys: init.sys.hotkeyFailed.join(', ') }), { icon: 'keyboard', kind: 'err', ms: 7000 });
  }
}

boot().catch(fatal);
