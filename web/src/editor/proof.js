// "Proof" mode: spelling through the Windows spell checker (host) + simple RU/EN punctuation rules.
import { StateField, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { host } from '../host.js';
import { settings } from '../settings.js';
import { t } from '../i18n.js';
import { bus, debounce } from '../util.js';
import { proposalField } from './aidiff.js';

export const setIssues = StateEffect.define();
const spellCache = new Map();   // "ru-RU:слово" → null | [suggestions]
const ignored = new Set();       // ignored for this session (lowercase)
let missingLangs = new Set();
let available = null;

export function proofAvailable(langs) { available = langs; }
export function missingLanguages() { return [...missingLangs]; }

const deco = {
  spell: Decoration.mark({ class: 'cm-sp' }),
  punct: Decoration.mark({ class: 'cm-sp p' }),
  active: Decoration.mark({ class: 'cm-sp on' }),
};

export const proofField = StateField.define({
  create: () => ({ issues: [], set: Decoration.none }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setIssues)) return e.value;
    if (!tr.docChanged) return v;
    const issues = [];
    for (const i of v.issues) {
      const from = tr.changes.mapPos(i.from, 1), to = tr.changes.mapPos(i.to, -1);
      if (to > from && !tr.changes.touchesRange(i.from, i.to)) issues.push({ ...i, from, to });
    }
    return { issues, set: v.set.map(tr.changes) };
  },
  // underlines are hidden where an AI proposal is pending, so the two don't overlap
  provide: f => EditorView.decorations.compute([f, proposalField], state => {
    const v = state.field(f);
    const chg = state.field(proposalField, false)?.changes || [];
    if (!chg.length) return v.set;
    return v.set.update({ filter: (from, to) => !chg.some(c => from <= Math.max(c.to, c.from + 1) && to >= c.from) });
  }),
});

export function issuesOf(state) { return state.field(proofField, false)?.issues || []; }

function makeSet(issues) {
  return Decoration.set(issues.map(i => (i.kind === 'spell' ? deco.spell : deco.punct).range(i.from, i.to)), true);
}

const LOOKALIKE = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };

const FUSED = {
  'впринципе': 'в принципе', 'вобщем': 'в общем', 'вообщем': 'в общем', 'врядли': 'вряд ли', 'навсякий': 'на всякий', 'покрайней': 'по крайней',
  'всмысле': 'в смысле', 'какбудто': 'как будто', 'темболее': 'тем более', 'тоесть': 'то есть', 'вцелом': 'в целом', 'вдальнейшем': 'в дальнейшем',
  'всвязи': 'в связи', 'изза': 'из-за', 'из за': 'из-за', 'почемуто': 'почему-то', 'чтото': 'что-то', 'когдато': 'когда-то', 'кудато': 'куда-то',
  'ктото': 'кто-то', 'гдето': 'где-то', 'както': 'как-то', 'вкратце': null, 'итак': null, 'зачастую': null, 'помоему': 'по-моему', 'потвоему': 'по-твоему',
  'поновому': 'по-новому', 'посвоему': 'по-своему', 'поправде': 'по правде', 'вобщемто': 'в общем-то', 'нехочу': 'не хочу', 'незнаю': 'не знаю', 'немогу': 'не могу',
};
const CONJ = /([\p{L}\p{N}»)"])([ \t]+)(но|а|однако|зато|чтобы|потому что|так как|поэтому|который|которая|которое|которые|которого|которой|которому|которым|которых|если|когда|хотя|пока|будто)(?=[\s,.!?]|$)/giu;
const NO_COMMA_BEFORE = new Set(['и', 'или', 'да', 'не', 'но', 'а', 'то', 'ни', 'же', 'в', 'на', 'с', 'к', 'по', 'о', 'об', 'от', 'до', 'из', 'за', 'для', 'при', 'про', 'без', 'чем', 'как', 'вот', 'именно', 'только', 'даже', 'лишь', 'хотя', 'то', 'ведь', 'ну', 'просто', 'между', 'тем']);

function tokenizeRanges(state, lang) {
  // Parts of the document that should be checked (skip code, URLs, front matter)
  const doc = state.doc;
  const skip = [];
  const tree = syntaxTree(state);
  const prose = lang === 'markdown' || lang === 'text';
  const only = [];
  tree.iterate({
    enter(n) {
      const name = n.name;
      if (prose) {
        if (name === 'FencedCode' || name === 'CodeBlock' || name === 'InlineCode' || name === 'URL' || name === 'HTMLBlock' || name === 'HTMLTag' || name === 'Autolink' || name === 'LinkReference' || name === 'CodeText') { skip.push([n.from, n.to]); return false; }
      } else if (/Comment|String/.test(name)) { only.push([n.from, n.to]); return false; }
    },
  });
  if (!prose) return only.length ? only : [];
  const out = [];
  let pos = 0;
  skip.sort((a, b) => a[0] - b[0]);
  for (const [a, b] of skip) { if (a > pos) out.push([pos, a]); pos = Math.max(pos, b); }
  if (pos < doc.length) out.push([pos, doc.length]);
  return out;
}

const WORD = /[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*/gu;
const URLISH = /(?:https?:\/\/|www\.)\S+|\S+@\S+\.\w+|[A-Za-z]:\\\S*|\S+\.(?:exe|dll|txt|md|json|js|cs|html|css|png|jpg|zip)\b/giu;

function scriptOf(w) {
  const cyr = /[\u0400-\u04FF]/.test(w), lat = /[A-Za-z]/.test(w);
  if (cyr && lat) return 'mixed';
  if (cyr) return 'ru-RU';
  if (lat) return 'en-US';
  return null;
}

async function analyze(view, lang) {
  const state = view.state;
  const doc = state.doc;
  const big = doc.length > 400000;
  let ranges = tokenizeRanges(state, lang);
  if (big) {
    const vis = view.visibleRanges;
    ranges = ranges.flatMap(([a, b]) => vis.map(v => [Math.max(a, v.from), Math.min(b, v.to)]).filter(([x, y]) => y > x));
  }
  const langs = settings.get('spellLangs') || ['ru-RU', 'en-US'];
  const dict = new Set((settings.get('dictionary') || []).map(w => w.toLowerCase()));
  const issues = [];
  const words = [];
  for (const [a, b] of ranges) {
    const text = doc.sliceString(a, b);
    const masked = text.replace(URLISH, m => ' '.repeat(m.length));
    WORD.lastIndex = 0;
    let m;
    while ((m = WORD.exec(masked))) {
      const w = m[0];
      const from = a + m.index;
      if (w.length < 2 || w.length > 40) continue;
      const lw = w.toLowerCase();
      if (dict.has(lw) || ignored.has(lw)) continue;
      const sc = scriptOf(w);
      if (!sc) continue;
      if (sc === 'mixed') {
        const fixed = [...w].map(ch => LOOKALIKE[ch] || ch).join('');
        if (!/[A-Za-z]/.test(fixed)) issues.push({ kind: 'spell', from, to: from + w.length, word: w, sugg: [fixed], msg: t('proof.mixed') });
        continue;
      }
      if (FUSED[lw] !== undefined) {
        if (FUSED[lw]) {
          const s = w[0] === w[0].toUpperCase() ? FUSED[lw][0].toUpperCase() + FUSED[lw].slice(1) : FUSED[lw];
          issues.push({ kind: 'spell', from, to: from + w.length, word: w, sugg: [s], msg: t('proof.fused') });
        }
        continue;
      }
      if (/[A-ZА-ЯЁ]/.test(w.slice(1)) && w !== w.toUpperCase()) continue; // camelCase, iPhone
      if (w === w.toUpperCase() && w.length <= 6) continue;                 // abbreviations
      if (!langs.includes(sc)) continue;
      words.push({ w, from, lang: sc });
    }
  }
  // ask the host about words we have not seen yet
  const need = new Map();
  for (const x of words) {
    const key = x.lang + ':' + x.w;
    if (!spellCache.has(key)) { if (!need.has(x.lang)) need.set(x.lang, new Set()); need.get(x.lang).add(x.w); }
  }
  for (const [l, set] of need) {
    const list = [...set];
    for (let i = 0; i < list.length; i += 400) {
      const chunk = list.slice(i, i + 400);
      try {
        const r = await host.call('spell.words', { lang: l, words: chunk });
        if (r.missing) { missingLangs.add(l); chunk.forEach(w => spellCache.set(l + ':' + w, null)); continue; }
        missingLangs.delete(l);
        for (const w of chunk) spellCache.set(l + ':' + w, r.bad?.[w] ? r.bad[w] : null);
      } catch (e) {
        console.warn('spell', e);
        chunk.forEach(w => spellCache.set(l + ':' + w, null));
      }
    }
  }
  for (const x of words) {
    const s = spellCache.get(x.lang + ':' + x.w);
    if (s) issues.push({ kind: 'spell', from: x.from, to: x.from + x.w.length, word: x.w, sugg: s.slice(0, 6), msg: t('proof.spelling') });
  }
  if (settings.get('punctuation') !== false) punctuation(doc, ranges, issues);
  issues.sort((a, b) => a.from - b.from || a.to - b.to);
  // drop overlaps
  const clean = [];
  let end = -1;
  for (const i of issues) { if (i.from >= end) { clean.push(i); end = i.to; } }
  return clean;
}

function punctuation(doc, ranges, issues) {
  for (const [a, b] of ranges) {
    const text = doc.sliceString(a, b);
    const cyr = /[\u0400-\u04FF]/.test(text);
    let m;
    const push = (from, to, word, sugg, msg) => issues.push({ kind: 'punct', from: a + from, to: a + to, word, sugg: [sugg], msg });
    const r1 = /(\S)( {2,})(?=\S)/g;
    while ((m = r1.exec(text))) {
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      if (/^\s*$/.test(text.slice(lineStart, m.index))) continue;
      if (text[m.index] === '|' || text[m.index + m[0].length] === '|') continue;
      push(m.index + 1, m.index + 1 + m[2].length, m[2], ' ', t('proof.doubleSpace'));
    }
    const r2 = /([\p{L}\p{N}»”)])( +)([,.;:!?])(?=\s|$)/gu;
    while ((m = r2.exec(text))) {
      if (m[3] === '.' && text.slice(m.index + m[0].length - 1, m.index + m[0].length + 2) === '...') continue;
      push(m.index + m[1].length, m.index + m[1].length + m[2].length + 1, m[2] + m[3], m[3], t('proof.spaceBefore'));
    }
    const r3 = /([\p{L}]{2,}),(?=[\p{L}])/gu;
    while ((m = r3.exec(text))) push(m.index + m[1].length, m.index + m[1].length + 1, ',', ', ', t('proof.spaceAfter'));
    if (cyr) {
      CONJ.lastIndex = 0;
      while ((m = CONJ.exec(text))) {
        const at = m.index + m[1].length;
        const before = text.slice(Math.max(0, at - 40), at);
        const prev = /([\p{L}]+)\s*$/u.exec(before)?.[1]?.toLowerCase();
        if (!prev || NO_COMMA_BEFORE.has(prev)) continue;
        const lineStart = text.lastIndexOf('\n', at) + 1;
        if (!/[\p{L}]/u.test(text.slice(lineStart, at))) continue;
        const word = m[3];
        push(at, at + m[2].length + word.length, m[2] + word, ', ' + word, t('proof.comma', { w: word.toLowerCase() }));
      }
      const r5 = /([\p{L}\p{N}»)])( - )(?=[\p{L}\p{N}«(])/gu;
      while ((m = r5.exec(text))) push(m.index + m[1].length, m.index + m[1].length + 3, ' - ', ' — ', t('proof.dash'));
    } else {
      const r8 = /(^|[\s(])(i)(?=[\s,.!?']|$)/gm;
      while ((m = r8.exec(text))) push(m.index + m[1].length, m.index + m[1].length + 1, 'i', 'I', t('proof.capitalI'));
    }
    const r6 = /(?<![\p{L}\p{N}])([\p{L}]{2,})(\s+)\1(?![\p{L}\p{N}])/giu;
    while ((m = r6.exec(text))) {
      if (m[1].toLowerCase() !== m[0].slice(m[1].length + m[2].length).toLowerCase()) continue;
      push(m.index, m.index + m[0].length, m[0], m[1], t('proof.repeat'));
    }
  }
}

/** ViewPlugin that re-runs the analysis after edits. */
export function proofPlugin(getLang) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.gen = 0;
      this.run = debounce(() => this.check(), 450);
      this.run();
    }
    update(u) { if (u.docChanged || (u.viewportChanged && u.state.doc.length > 400000)) this.run(); }
    async check() {
      const gen = ++this.gen;
      const view = this.view;
      const docAt = view.state.doc;
      let issues;
      try { issues = await analyze(view, getLang()); } catch (e) { console.warn(e); return; }
      if (gen !== this.gen || view.state.doc !== docAt) return; // stale
      view.dispatch({ effects: setIssues.of({ issues, set: makeSet(issues) }) });
      bus.emit('proof.issues', issues);
    }
    destroy() { this.run.cancel(); this.gen++; }
  });
}

export function ignoreWord(w) { ignored.add(w.toLowerCase()); }
export function addToDictionary(w) {
  const d = settings.get('dictionary') || [];
  if (!d.includes(w)) settings.set('dictionary', [...d, w].sort((a, b) => a.localeCompare(b)));
  host.send('dict.save', { words: settings.get('dictionary') });
}
export function clearSpellCache() { spellCache.clear(); }

export function issueAt(state, pos) {
  return issuesOf(state).find(i => pos >= i.from && pos <= i.to);
}

export function applyIssue(view, issue, replacement) {
  const text = replacement ?? issue.sugg?.[0];
  if (text == null) return;
  view.dispatch({ changes: { from: issue.from, to: issue.to, insert: text }, userEvent: 'input.proof' });
}

export function applyAll(view) {
  const issues = issuesOf(view.state).filter(i => i.sugg?.length);
  if (!issues.length) return 0;
  view.dispatch({ changes: issues.map(i => ({ from: i.from, to: i.to, insert: i.sugg[0] })), userEvent: 'input.proof' });
  return issues.length;
}

export function removeIssue(view, issue) {
  const cur = issuesOf(view.state).filter(i => !(i.from === issue.from && i.to === issue.to));
  const w = issue.word?.toLowerCase();
  const rest = issue.kind === 'spell' && w ? cur.filter(i => i.word?.toLowerCase() !== w) : cur;
  view.dispatch({ effects: setIssues.of({ issues: rest, set: makeSet(rest) }) });
  bus.emit('proof.issues', rest);
}
