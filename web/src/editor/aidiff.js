// AI edit proposals: word-level diff shown inline (strike-through + inserted text), accept/reject per change.
import { StateField, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { bus } from '../util.js';

const TOKEN = /\r?\n|[^\S\r\n]+|[\p{L}\p{N}_]+[^\S\r\n]*|[^\s\p{L}\p{N}_][^\S\r\n]*/gu;
export const tokenize = s => s.match(TOKEN) || [];

/** Myers O(ND) diff on token arrays → list of ops ['=',tok] ['-',tok] ['+',tok] */
function myers(a, b, maxD = 4000) {
  const n = a.length, m = b.length, max = n + m;
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace = [];
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
      else x = v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, off, d);
    }
  }
  return null;
}

function backtrack(trace, a, b, off, dEnd) {
  const ops = [];
  let x = a.length, y = b.length;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    let pk;
    if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) pk = k + 1; else pk = k - 1;
    const px = v[off + pk], py = px - pk;
    while (x > px && y > py) { ops.push(['=', a[--x]]); y--; }
    if (x === px) ops.push(['+', b[--y]]); else ops.push(['-', a[--x]]);
  }
  while (x > 0 && y > 0) { ops.push(['=', a[--x]]); y--; }
  return ops.reverse();
}

/** Changes needed to turn `oldText` into `newText`, positions relative to oldText. */
export function diffText(oldText, newText) {
  const a = tokenize(oldText), b = tokenize(newText);
  // trim common prefix/suffix for speed
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf), bm = b.slice(pre, b.length - suf);
  let pos = 0;
  for (let i = 0; i < pre; i++) pos += a[i].length;
  const ops = myers(am, bm);
  const changes = [];
  if (!ops) {
    const len = am.join('').length;
    return [{ from: pos, to: pos + len, insert: bm.join('') }];
  }
  let cur = null;
  for (const [op, tok] of ops) {
    if (op === '=') {
      if (cur) { changes.push(cur); cur = null; }
      pos += tok.length;
    } else if (op === '-') {
      cur ??= { from: pos, to: pos, insert: '' };
      cur.to += tok.length; pos += tok.length;
    } else {
      cur ??= { from: pos, to: pos, insert: '' };
      cur.insert += tok;
    }
  }
  if (cur) changes.push(cur);
  return changes;
}

class InsWidget extends WidgetType {
  constructor(text, id) { super(); this.text = text; this.id = id; }
  eq(o) { return o.text === this.text && o.id === this.id; }
  toDOM() {
    const s = document.createElement('ins');
    s.className = 'cm-ins';
    s.dataset.chg = this.id;
    s.textContent = this.text;
    return s;
  }
  ignoreEvent() { return false; }
}

export const setProposal = StateEffect.define();
export const dropChange = StateEffect.define();
const setFlash = StateEffect.define();

function decorate(changes) {
  const r = [];
  for (const c of changes) {
    if (c.to > c.from) r.push(Decoration.mark({ class: 'cm-del', attributes: { 'data-chg': String(c.id) } }).range(c.from, c.to));
    if (c.insert) r.push(Decoration.widget({ widget: new InsWidget(c.insert, c.id), side: 1 }).range(c.to));
  }
  return Decoration.set(r, true);
}

export const proposalField = StateField.define({
  create: () => ({ changes: [], deco: Decoration.none, meta: null }),
  update(v, tr) {
    let { changes, meta } = v;
    let dirty = false;
    if (tr.docChanged && changes.length) {
      const next = [];
      for (const c of changes) {
        if (tr.changes.touchesRange(c.from, c.to) && !tr.annotation?.(acceptAnn)) { dirty = true; continue; }
        next.push({ ...c, from: tr.changes.mapPos(c.from, 1), to: tr.changes.mapPos(c.to, -1) });
      }
      changes = next; dirty = true;
    }
    for (const e of tr.effects) {
      if (e.is(setProposal)) { changes = e.value.changes; meta = e.value.meta; dirty = true; }
      if (e.is(dropChange)) { changes = changes.filter(c => !e.value.includes(c.id)); dirty = true; }
    }
    if (!dirty) return v;
    return { changes, deco: decorate(changes), meta };
  },
  provide: f => EditorView.decorations.from(f, v => v.deco),
});

// green fade over freshly accepted text
export const flashField = StateField.define({
  create: () => Decoration.none,
  update(v, tr) {
    v = v.map(tr.changes);
    for (const e of tr.effects) if (e.is(setFlash)) v = e.value;
    return v;
  },
  provide: f => EditorView.decorations.from(f, v => v),
});

import { Annotation } from '@codemirror/state';
const acceptAnn = Annotation.define();

export function propose(view, base, oldText, newText, meta = {}) {
  const raw = diffText(oldText, newText);
  let id = 0;
  const changes = raw.map(c => ({ id: ++id, from: base + c.from, to: base + c.to, insert: c.insert, old: oldText.slice(c.from, c.to) }));
  view.dispatch({ effects: setProposal.of({ changes, meta }) });
  bus.emit('ai.proposal', changes);
  if (changes.length) view.dispatch({ effects: EditorView.scrollIntoView(changes[0].from, { y: 'center' }) });
  return changes;
}

export const proposalOf = state => state.field(proposalField, false)?.changes || [];

export function accept(view, ids) {
  const all = proposalOf(view.state);
  const pick = ids ? all.filter(c => ids.includes(c.id)) : all;
  if (!pick.length) return 0;
  const spec = pick.map(c => ({ from: c.from, to: c.to, insert: c.insert }));
  const tr = view.state.update({ changes: spec, annotations: acceptAnn.of(true), userEvent: 'input.ai', effects: dropChange.of(pick.map(c => c.id)) });
  view.dispatch(tr);
  // flash inserted text
  const marks = [];
  for (const c of pick) {
    if (!c.insert) continue;
    const from = tr.changes.mapPos(c.from, -1);
    const to = from + c.insert.length;
    if (to > from && to <= view.state.doc.length) marks.push(Decoration.mark({ class: 'cm-flash' }).range(from, to));
  }
  if (marks.length) {
    view.dispatch({ effects: setFlash.of(Decoration.set(marks, true)) });
    setTimeout(() => view.dispatch({ effects: setFlash.of(Decoration.none) }), 2200);
  }
  bus.emit('ai.proposal', proposalOf(view.state));
  return pick.length;
}

export function reject(view, ids) {
  const all = proposalOf(view.state);
  const drop = ids || all.map(c => c.id);
  view.dispatch({ effects: dropChange.of(drop) });
  bus.emit('ai.proposal', proposalOf(view.state));
}
