// "Standard" mode: live Markdown styling – headings with hanging #, dim markers, task checkboxes, bullets, chips.
import { ViewPlugin, Decoration, WidgetType, EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { RangeSet } from '@codemirror/state';
import { settings } from '../settings.js';

const HSIZE = { 1: 1.72, 2: 1.3, 3: 1.13, 4: 1.02, 5: 1, 6: 1 };
let ctx = null;
const widthCache = new Map();
function markWidth(level, text) {
  const base = (settings.get('fontSize') || 16) * (settings.get('zoom') || 1);
  const fam = getComputedStyle(document.documentElement).getPropertyValue('--text-font') || 'Inter';
  const font = `500 ${(base * HSIZE[level]).toFixed(2)}px ${fam}`;
  const key = font + '|' + text;
  let w = widthCache.get(key);
  if (w === undefined) {
    ctx ??= document.createElement('canvas').getContext('2d');
    ctx.font = font;
    w = Math.round(ctx.measureText(text).width * 100) / 100;
    widthCache.set(key, w);
  }
  return w;
}
export function resetMarkCache() { widthCache.clear(); }

class CheckWidget extends WidgetType {
  constructor(on) { super(); this.on = on; }
  eq(o) { return o.on === this.on; }
  toDOM(view) {
    const s = document.createElement('span');
    s.className = 'cm-cb' + (this.on ? ' on' : '');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
    s.addEventListener('mousedown', e => {
      e.preventDefault();
      const pos = view.posAtDOM(s);
      const line = view.state.doc.lineAt(pos);
      const m = /^(\s*[-*+]\s+)\[([ xX])\]/.exec(line.text);
      if (!m) return;
      const at = line.from + m[1].length + 1;
      view.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle' });
    });
    return s;
  }
  ignoreEvent() { return false; }
}
const CHECK_ON = new CheckWidget(true), CHECK_OFF = new CheckWidget(false);

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-bul'; s.textContent = '•'; return s; }
}
const BULLET = new BulletWidget();

const KEYCAP = /^(Ctrl|Alt|Shift|Win|Enter|Esc|Tab|Space|Del|Delete|Backspace|Home|End|PgUp|PgDn|Insert|F\d{1,2}|[A-Z0-9]|[↑↓←→]|Fn|Cmd|Option|Caps ?Lock)$/;

const mk = c => Decoration.mark({ class: c });
const M = {
  mk: mk('cm-mk'), emk: mk('cm-emk'), em: mk('cm-em'), strong: mk('cm-strong'), strike: mk('cm-strike'),
  icode: mk('cm-icode'), kbd: mk('cm-kbd'), link: mk('cm-link'), url: mk('cm-lurl'), hl: mk('cm-hl'), done: mk('cm-done'), olmk: mk('cm-olmk'),
};
const lineCache = new Map();
const lineDeco = (cls, style) => {
  const k = cls + '|' + (style || '');
  let d = lineCache.get(k);
  if (!d) { d = Decoration.line(style ? { class: cls, attributes: { style } } : { class: cls }); lineCache.set(k, d); }
  return d;
};

function build(view) {
  const ranges = [], atomic = [];
  const { state } = view;
  const doc = state.doc;
  const tree = syntaxTree(state);
  const codeRanges = [];
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from, to,
      enter(node) {
        const n = node.name;
        if (n.startsWith('ATXHeading')) {
          const level = +n.slice(10) || 1;
          const line = doc.lineAt(node.from);
          const m = /^(#{1,6})(\s+)/.exec(line.text);
          const style = m ? `--mkw:${markWidth(level, m[1] + ' ')}px` : '';
          ranges.push(lineDeco(`cm-h cm-h${level}`, style).range(line.from));
          if (m) ranges.push(M.mk.range(line.from, line.from + m[0].length));
          return;
        }
        if (n === 'SetextHeading1' || n === 'SetextHeading2') {
          const first = doc.lineAt(node.from), last = doc.lineAt(node.to);
          ranges.push(lineDeco(`cm-h cm-h${n.endsWith('1') ? 1 : 2}`).range(first.from));
          if (last.number > first.number) ranges.push(lineDeco('cm-setext').range(last.from));
          return false;
        }
        switch (n) {
          case 'HeaderMark': {
            const line = doc.lineAt(node.from);
            if (node.from > line.from + 6) ranges.push(M.mk.range(node.from, node.to)); // closing ###
            return;
          }
          case 'Emphasis': ranges.push(M.em.range(node.from, node.to)); return;
          case 'StrongEmphasis': ranges.push(M.strong.range(node.from, node.to)); return;
          case 'Strikethrough': ranges.push(M.strike.range(node.from, node.to)); return;
          case 'EmphasisMark': case 'StrikethroughMark': case 'QuoteMark': case 'CodeInfo':
            if (node.to > node.from) ranges.push(M.emk.range(node.from, node.to)); return;
          case 'InlineCode': {
            const text = doc.sliceString(node.from, node.to).replace(/^`+|`+$/g, '').trim();
            ranges.push((KEYCAP.test(text) ? M.kbd : M.icode).range(node.from, node.to));
            codeRanges.push([node.from, node.to]);
            return;
          }
          case 'CodeMark': if (node.to > node.from) ranges.push(M.emk.range(node.from, node.to)); return;
          case 'Link': ranges.push(M.link.range(node.from, node.to)); return;
          case 'URL': ranges.push(M.url.range(node.from, node.to)); return;
          case 'LinkMark': ranges.push(M.emk.range(node.from, node.to)); return;
          case 'Blockquote': {
            for (let l = doc.lineAt(node.from); ; l = doc.line(l.number + 1)) {
              ranges.push(lineDeco('cm-quote').range(l.from));
              if (l.to >= node.to || l.number >= doc.lines) break;
            }
            return;
          }
          case 'FencedCode': case 'CodeBlock': {
            const first = doc.lineAt(node.from), last = doc.lineAt(node.to);
            for (let i = first.number; i <= last.number; i++) {
              const l = doc.line(i);
              let c = 'cm-codeblock';
              if (i === first.number) c += ' cm-cb-first';
              if (i === last.number) c += ' cm-cb-last';
              ranges.push(lineDeco(c).range(l.from));
            }
            codeRanges.push([node.from, node.to]);
            if (n === 'CodeBlock') return false;
            return;
          }
          case 'HorizontalRule': ranges.push(lineDeco('cm-hr').range(doc.lineAt(node.from).from)); return;
          case 'Table': {
            const first = doc.lineAt(node.from), last = doc.lineAt(node.to);
            for (let i = first.number; i <= last.number; i++) ranges.push(lineDeco('cm-table').range(doc.line(i).from));
            return;
          }
          case 'ListItem': {
            const line = doc.lineAt(node.from);
            const text = line.text;
            const task = /^(\s*)([-*+])(\s+)\[([ xX])\](\s|$)/.exec(text);
            if (task && node.from === line.from + task[1].length) {
              const from = line.from + task[1].length;
              const to = from + task[2].length + task[3].length + 3 + (task[5] ? 1 : 0);
              const on = task[4] !== ' ';
              const w = Decoration.replace({ widget: on ? CHECK_ON : CHECK_OFF });
              ranges.push(w.range(from, to));
              atomic.push(w.range(from, to));
              ranges.push(lineDeco(on ? 'cm-task cm-task-on' : 'cm-task').range(line.from));
              if (on && line.to > to) ranges.push(M.done.range(to, line.to));
              return;
            }
            const bullet = /^(\s*)([-*+])(\s+)/.exec(text);
            if (bullet && node.from === line.from + bullet[1].length) {
              const from = line.from + bullet[1].length;
              const w = Decoration.replace({ widget: BULLET });
              ranges.push(w.range(from, from + 1));
              atomic.push(w.range(from, from + 1));
              ranges.push(lineDeco('cm-li').range(line.from));
              return;
            }
            const ol = /^(\s*)(\d{1,9}[.)])(\s+)/.exec(text);
            if (ol && node.from === line.from + ol[1].length) {
              ranges.push(M.olmk.range(line.from + ol[1].length, line.from + ol[1].length + ol[2].length));
              ranges.push(lineDeco('cm-li cm-oli').range(line.from));
            }
            return;
          }
        }
      },
    });
    // ==highlight== (not part of CommonMark)
    const text = doc.sliceString(from, to);
    const re = /==(?=\S)([^=\n]+?)==/g;
    let m;
    while ((m = re.exec(text))) {
      const a = from + m.index, b = a + m[0].length;
      if (codeRanges.some(([x, y]) => a < y && b > x)) continue;
      ranges.push(M.emk.range(a, a + 2), M.hl.range(a + 2, b - 2), M.emk.range(b - 2, b));
    }
  }
  return { deco: Decoration.set(ranges, true), atomic: RangeSet.of(atomic, true) };
}

export const mdLive = ViewPlugin.fromClass(class {
  constructor(view) { const r = build(view); this.decorations = r.deco; this.atomic = r.atomic; }
  update(u) {
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state) || u.geometryChanged) {
      const r = build(u.view); this.decorations = r.deco; this.atomic = r.atomic;
    }
  }
}, {
  decorations: v => v.decorations,
  provide: p => EditorView.atomicRanges.of(view => view.plugin(p)?.atomic || RangeSet.empty),
});

/** Headings of a markdown/text document: [{level, text, line, from}] */
export function headings(doc) {
  const out = [];
  let inFence = false;
  for (let i = 1; i <= doc.lines; i++) {
    const l = doc.line(i).text;
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`=~]/g, ''), line: i, from: doc.line(i).from });
  }
  return out;
}
