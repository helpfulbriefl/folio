// Self-test: a scripted tour through the app. The Windows build runs it on CI (Folio.exe --selftest) and
// takes screenshots of every step; in a browser it runs with ?selftest.
import { $, $$, sleep } from './util.js';
import { host } from './host.js';
import { settings } from './settings.js';
import { t } from './i18n.js';
import { run } from './commands.js';
import { docs, openPaths, isDirty } from './docs.js';
import { editor } from './editor/editor.js';
import { issuesOf } from './editor/proof.js';
import * as reader from './reader/reader.js';
import { openMenubar } from './ui/chrome.js';
import { closeMenus } from './ui/menu.js';
import { closeTopModal, modalOpen } from './ui/dialogs.js';
import { openPalette, closePalette } from './ui/palette.js';
import { hasProposal, acceptAll } from './ui/aipanel.js';
import { closeSide } from './ui/side.js';
import { openSettings } from './ui/settings-ui.js';
import { openAbout } from './ui/about.js';
import { aiState } from './ai/ai.js';
import { SAMPLES } from './samples.js';
import { openWelcome, setView, setMode } from './app.js';

const R = { started: new Date().toISOString(), ua: navigator.userAgent, checks: [], shots: [], errors: [], steps: [] };
const log = (...a) => console.log('[selftest]', ...a);

async function until(fn, ms = 5000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return true; } catch { } await sleep(step); }
  return false;
}
function check(name, ok, detail = '') { R.checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) }); log(ok ? 'PASS' : 'FAIL', name, detail); }
async function shot(name, wait = 500) {
  await sleep(wait);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    if (window.folioShot) await window.folioShot(name);
    else await host.call('selftest.shot', { name });
    R.shots.push(name);
  } catch (e) { R.errors.push('shot ' + name + ': ' + (e.message || e)); }
}
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); R.steps.push({ name, ok: true, ms: Date.now() - t0 }); }
  catch (e) { R.steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.stack || e?.message || e).slice(0, 600) }); log('step failed', name, e); }
  closeMenus();
  while (modalOpen()) closeTopModal();
}
const byName = frag => docs.tabs.find(x => (x.path || x.name || '').includes(frag));
const hover = node => node?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

export async function runSelfTest(init) {
  const origErr = console.error;
  console.error = (...a) => { R.errors.push(a.map(x => (x?.stack || x?.message || String(x))).join(' ').slice(0, 500)); origErr(...a); };
  addEventListener('error', e => R.errors.push('onerror: ' + e.message));
  log('start', init?.version);
  settings.set('animations', false);
  settings.set('updates.auto', false);
  settings.set('theme', 'paper');
  const paths = {};

  await step('samples', async () => {
    for (const s of SAMPLES) {
      const r = await host.call('selftest.writeFile', { path: s.path, text: s.text, encoding: s.encoding, bom: false });
      paths[s.path.split('\\').pop()] = r?.path || s.path;
    }
    check('samples.written', Object.keys(paths).length === SAMPLES.length, Object.values(paths).join(' | '));
  });

  await step('welcome', async () => {
    openWelcome();
    await sleep(300);
    check('welcome.open', docs.active && !docs.active.path && editor.text().length > 200);
    check('welcome.clean', !isDirty(docs.active));
    check('welcome.headings', editor.headings().length >= 3, editor.headings().length);
    await shot('01-welcome');
  });

  await step('legacy-encoding', async () => {
    await openPaths([paths['письмо.txt']]);
    const tab = docs.active;
    check('enc.detect1251', tab?.encoding === 'windows-1251', tab?.encoding + ' ' + tab?.confidence);
    check('enc.crlf', tab?.eol === 'crlf', tab?.eol);
    check('enc.text', editor.text().startsWith('Здравствуйте, Ирина Сергеевна!'), editor.text().slice(0, 40));
    check('enc.banner', tab?.banner?.kind === 'legacy', tab?.banner?.kind);
    await shot('02-legacy-1251');
    openMenubar('enc');
    await sleep(150);
    const item = $$('.dd.main .mi').find(n => n.textContent.includes(t('menu.reopenWith')));
    hover(item);
    await until(() => $('.dd.sub'), 1500);
    await sleep(500);
    await shot('03-encoding-menu', 200);
    closeMenus();
  });

  await step('convert-utf8', async () => {
    const tab = docs.active;
    const before = editor.text();
    await run('enc.toUtf8');
    await until(() => !isDirty(tab), 3000);
    check('utf8.saved', !isDirty(tab) && tab.encoding === 'utf-8', tab.encoding);
    const r = await host.call('file.read', { path: tab.path });
    check('utf8.roundtrip', r.encoding === 'utf-8' && r.text === before, `${r.encoding} ${r.text.length}/${before.length}`);
    check('utf8.bannerGone', !tab.banner, tab.banner?.kind);
  });

  await step('coder', async () => {
    settings.set('theme', 'graphite');
    await openPaths([paths['stats.js']]);
    check('coder.mode', docs.active?.mode === 'coder', docs.active?.mode);
    check('coder.lang', docs.active?.lang === 'javascript', docs.active?.lang);
    editor.gotoLine(12);
    await sleep(300);
    check('coder.gutter', !!$('#ed .cm-lineNumbers'));
    await shot('04-coder-graphite', 700);
  });

  await step('proof', async () => {
    settings.set('theme', 'paper');
    await openPaths([paths['Черновик статьи.txt']]);
    setMode('proof');
    const ok = await until(() => issuesOf(editor.view.state).length > 0, 8000, 200);
    const n = issuesOf(editor.view.state).length;
    check('proof.issues', ok, n + ' issues: ' + issuesOf(editor.view.state).slice(0, 8).map(i => i.word || i.msg).join(', '));
    check('proof.panel', !!$('#side .proof-panel'));
    await shot('05-proof', 600);
  });

  await step('ai-fix', async () => {
    if (init?.sys?.selftestAi) {
      settings.set('ai.provider', 'custom');
      settings.set('ai.baseUrl', init.sys.selftestAi);
      settings.set('ai.model', 'folio-selftest');
      aiState.hasKey = true; aiState.checked = true;
    } else if (!init?.sys?.mock) {
      check('ai.skipped', true, 'no test endpoint');
      return;
    } else { aiState.hasKey = true; aiState.checked = true; }
    closeSide();
    setMode('standard');
    editor.gotoPos(0);
    run('ai.fix');
    const ok = await until(() => hasProposal(), 15000, 150);
    check('ai.proposal', ok);
    await shot('06-ai-diff', 700);
    if (ok) {
      acceptAll();
      await sleep(300);
      const txt = editor.text();
      check('ai.accepted', txt.includes('В принципе') && txt.includes('receive') && !txt.includes('recieve'), txt.slice(0, 80));
    }
    closeSide();
  });

  await step('reader', async () => {
    settings.set('theme', 'sepia');
    await openPaths([paths['Диалог с ChatGPT.md']]);
    setView('read');
    await sleep(500);
    const info = reader.readerInfo();
    check('reader.chat', info?.kind === 'chat', JSON.stringify(info));
    check('reader.blocks', info?.blocks >= 4, info?.blocks);
    check('reader.pages', info?.pages >= 1, info?.pages);
    await shot('07-reader-book', 700);
    reader.togglePickMode(true);
    await sleep(200);
    const cbs = $$('#reader .stage .bcb');
    cbs.slice(0, 2).forEach(b => b.click());
    await sleep(250);
    await shot('08-reader-pick', 500);
    run('reader.copy');
    await sleep(400);
    const clip = await host.call('clipboard.read').catch(() => ({ text: '' }));
    check('reader.copy', (clip?.text || '').length > 20, (clip?.text || '').slice(0, 80));
    reader.togglePickMode(false);
    reader.setLayout('feed');
    await sleep(300);
    await shot('09-reader-feed', 500);
    reader.setLayout('book');
    setView('edit');
  });

  await step('palette-glass', async () => {
    settings.set('theme', 'glass');
    await openPaths([paths['Планы на неделю.md']]);
    await sleep(300);
    await shot('10-glass', 600);
    openPalette('');
    await sleep(200);
    const inp = $('.pal input');
    if (inp) { inp.value = 'со'; inp.dispatchEvent(new Event('input')); }
    await shot('11-palette', 400);
    closePalette();
  });

  await step('menus', async () => {
    settings.set('theme', 'paper');
    await sleep(300);
    openMenubar('file');
    await sleep(200);
    await shot('12-menu-file', 300);
    closeMenus();
    openMenubar('view');
    await sleep(150);
    await shot('13-menu-view', 300);
    closeMenus();
  });

  await step('dialogs', async () => {
    openSettings('appearance');
    await sleep(300);
    await shot('14-settings', 400);
    closeTopModal();
    openSettings('ai');
    await sleep(300);
    await shot('15-settings-ai', 400);
    closeTopModal();
    openAbout();
    await sleep(300);
    await shot('16-about', 400);
    closeTopModal();
    run('help.keys');
    await sleep(300);
    await shot('17-keys', 400);
    closeTopModal();
  });

  await step('dark-proof', async () => {
    settings.set('theme', 'graphite');
    const tab = byName('Черновик');
    if (tab) (await import('./docs.js')).activateTab(tab);
    setMode('proof');
    await sleep(900);
    await shot('18-graphite-proof', 500);
    closeSide();
    settings.set('theme', 'paper');
  });

  await step('keyboard', async () => {
    const key = (code, key, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...o }));
    key('Digit2', '2', { ctrlKey: true });
    await sleep(200);
    check('keys.ctrl2', docs.active?.view === 'read', docs.active?.view);
    key('Digit1', '1', { ctrlKey: true });
    await sleep(200);
    check('keys.ctrl1', docs.active?.view === 'edit', docs.active?.view);
    const n = docs.tabs.length;
    key('KeyN', 'n', { ctrlKey: true });
    await sleep(200);
    check('keys.ctrlN', docs.tabs.length === n + 1, docs.tabs.length);
  });

  R.finished = new Date().toISOString();
  R.ok = R.checks.every(c => c.ok) && R.steps.every(s => s.ok);
  R.summary = `${R.checks.filter(c => c.ok).length}/${R.checks.length} checks, ${R.steps.filter(s => s.ok).length}/${R.steps.length} steps, ${R.errors.length} errors`;
  log('done', R.summary);
  window.__selftest = R;
  settings.flush();
  await host.call('selftest.done', { report: R }).catch(() => { });
}
