import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Supply only the native bridge shape: these tests do not simulate Windows.
globalThis.window = { chrome: { webview: { addEventListener() {} } } };
globalThis.document = { documentElement: { lang: 'en' } };
const { pickLang, setLang, lang, t, LANGS, addLang } = await import('../src/i18n.js');
const { settings, DEFAULTS } = await import('../src/settings.js');

test('the initial dictionary and HTML use English', () => {
  assert.equal(lang(), 'en');
  assert.equal(t('mb.file'), LANGS.en['mb.file']);
  assert.match(fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8'), /<html lang="en"/);
});
test('fresh settings use English even on non-English Windows', () => {
  assert.equal(DEFAULTS.lang, 'en');
  for (const locale of ['ru-RU', 'zh-CN', 'en-US', 'uk-UA']) {
    settings.load(null);
    assert.equal(pickLang(settings.get('lang'), locale), 'en');
    assert.equal(pickLang(undefined, locale), 'en');
  }
});
test('saved Russian, Chinese and auto preferences survive loading', () => {
  for (const pref of ['ru', 'zh', 'en', 'auto']) {
    settings.load({ lang: pref, theme: 'graphite' });
    assert.equal(settings.get('lang'), pref);
    assert.equal(settings.get('theme'), 'graphite');
  }
});
test('automatic language selection remains an explicit option', () => {
  for (const locale of ['ru-RU', 'uk-UA', 'be-BY', 'kk-KZ']) assert.equal(pickLang('auto', locale), 'ru');
  assert.equal(pickLang('auto', 'zh-CN'), 'zh');
  assert.equal(pickLang('auto', 'de-DE'), 'en');
});
test('explicit and imported languages take precedence; invalid codes fall back to English', () => {
  assert.equal(pickLang('ru', 'en-US'), 'ru');
  assert.equal(pickLang('zh', 'ru-RU'), 'zh');
  assert.equal(pickLang('invalid', 'ru-RU'), 'en');
  addLang('test', 'Test', { 'mb.file': 'Custom file' });
  assert.equal(pickLang('test', 'ru-RU'), 'test');
  setLang('test');
  assert.equal(t('mb.file'), 'Custom file');
  setLang('invalid');
  assert.equal(lang(), 'en');
  assert.equal(document.documentElement.lang, 'en');
});
test('switching languages updates the document and dictionary', () => {
  for (const [code, html] of [['ru', 'ru'], ['zh', 'zh-CN'], ['en', 'en']]) {
    setLang(code);
    assert.equal(lang(), code);
    assert.equal(document.documentElement.lang, html);
    assert.equal(t('mb.file'), LANGS[code]['mb.file']);
  }
});
test('all built-in language tables cover the English keys', () => {
  for (const code of ['ru', 'zh']) {
    const missing = Object.keys(LANGS.en).filter(key => !(key in LANGS[code]));
    assert.deepEqual(missing, [], `${code}: missing translation keys`);
  }
});
