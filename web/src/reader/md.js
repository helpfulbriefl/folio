// Small, safe Markdown → HTML renderer for the reader (everything is escaped first).
import { esc, I } from '../util.js';
import { t } from '../i18n.js';

const KEYCAP = /^(ctrl|alt|shift|win|cmd|esc|enter|tab|space|del|delete|backspace|home|end|pgup|pgdn|f\d{1,2}|[a-z0-9]|↑|↓|←|→)(\+(ctrl|alt|shift|win|[a-z0-9]|f\d{1,2}|enter|esc|tab|space|del|delete|backspace|home|end|↑|↓|←|→|[=\-+/.,]))*$/i;

function inline(s) {
  // protect code spans first
  const codes = [];
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m, a, c) => { codes.push(c.trim()); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  // a tiny allow-list of harmless inline HTML often found in READMEs
  s = s.replace(/&lt;kbd&gt;([^&<]{1,24})&lt;\/kbd&gt;/gi, '<kbd class="kbdi">$1</kbd>')
    .replace(/&lt;(sup|sub|u|mark)&gt;([\s\S]*?)&lt;\/\1&gt;/gi, '<$1>$2</$1>')
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, alt) => `<span class="img-ph">${I('image', 'xs')}${alt || 'image'}</span>`);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)[^)]*\)/g, '<a class="lnk" data-href="$2" title="$2">$1</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a class="lnk" data-href="$2" title="$2">$2</a>');
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<b>$1</b>').replace(/__(?=\S)([\s\S]*?\S)__/g, '<b>$1</b>');
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<i>$2</i>').replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, '$1<i>$2</i>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>').replace(/==(?=\S)([^=]*?\S)==/g, '<mark class="hl">$1</mark>');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => {
    const c = codes[+i];
    return KEYCAP.test(c) && c.length < 24 ? c.split('+').map(k => `<kbd class="kbdi">${esc(k)}</kbd>`).join('+') : `<code>${esc(c)}</code>`;
  });
  return s;
}

/** Renders markdown to HTML. Code blocks get a header with the language and a copy button. */
export function renderMd(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if ((m = /^\s*(```+|~~~+)\s*([\w#+.-]*)/.exec(line))) {
      flush();
      const fence = m[1], lang = m[2];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
      i++;
      out.push(`<div class="codeblk"><div class="codeblk-h"><span class="lang">${esc(lang || t('reader.code'))}</span><span class="cnt">${t('reader.lines', { n: body.length })}</span><button class="cp" data-copy>${I('copy', 'xs')}<span>${esc(t('reader.copy'))}</span></button></div><pre>${esc(body.join('\n'))}</pre></div>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { flush(); out.push(`<h${Math.min(6, m[1].length + 1)} class="rh">${inline(m[2])}</h${Math.min(6, m[1].length + 1)}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMd(q.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+]|\d{1,9}[.)])\s+/.test(line)) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && (/^\s*([-*+]|\d{1,9}[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const l = lines[i++];
        if (/^\s*([-*+]|\d{1,9}[.)])\s+/.test(l)) items.push(l.replace(/^\s*([-*+]|\d{1,9}[.)])\s+/, ''));
        else items[items.length - 1] += '\n' + l.trim();
      }
      const li = items.map(x => {
        const task = /^\[([ xX])\]\s+/.exec(x);
        if (task) return `<li class="task ${task[1] !== ' ' ? 'on' : ''}"><span class="rcb">${task[1] !== ' ' ? I('check', 'xs') : ''}</span>${inline(x.slice(task[0].length))}</li>`;
        return `<li>${inline(x).replace(/\n/g, '<br>')}</li>`;
      }).join('');
      out.push(ordered ? `<ol>${li}</ol>` : `<ul>${li}</ul>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const row = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(row(lines[i++]));
      out.push(`<div class="tbl"><table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out.join('');
}

/** Plain text version of markdown (for copying without formatting). */
export function mdToPlain(src) {
  return src.replace(/\r\n?/g, '\n')
    .replace(/^\s*(```+|~~~+).*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1')
    .replace(/(^|[^*])\*(?=\S)([^*]*?\S)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/==(.*?)==/g, '$1').replace(/~~(.*?)~~/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\n{3,}/g, '\n\n').trim();
}
