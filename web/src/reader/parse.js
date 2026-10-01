// Splits a document into reader blocks: chat messages (ChatGPT / Claude / Telegram / "User:" logs / JSON) or document sections.
const USER = /^(вы сказали|вы|you said|you|user|пользователь|я|me|human|человек|вопрос|question|q)$/i;
const BOT = /^(chatgpt сказал|chatgpt said|chatgpt|gpt-?[\w.-]*|assistant|ассистент|помощник|ии|ai|claude|gemini|copilot|bard|deepseek|grok|model|модель|bot|бот|ответ|answer|a|yandexgpt|gigachat|алиса|qwen|mistral|llama)$/i;

function role(name) {
  const n = name.trim().replace(/[*_:]+/g, '').trim();
  if (USER.test(n)) return 'user';
  if (BOT.test(n)) return 'assistant';
  return null;
}

/** Tries several chat formats; returns messages or null. */
export function parseChat(text) {
  const src = text.replace(/\r\n?/g, '\n');
  return parseJson(src) || parseWebCopy(src) || parseHeaded(src) || parseTelegram(src);
}

function parseJson(src) {
  const s = src.trim();
  if (!/^[[{]/.test(s)) return null;
  try {
    let d = JSON.parse(s);
    if (d.messages) d = d.messages;
    if (d.mapping) { // ChatGPT conversations.json item
      d = Object.values(d.mapping).map(n => n.message).filter(m => m?.content?.parts).sort((a, b) => (a.create_time || 0) - (b.create_time || 0))
        .map(m => ({ role: m.author?.role, content: m.content.parts.filter(p => typeof p === 'string').join('\n'), time: m.create_time ? m.create_time * 1000 : null }));
    }
    if (!Array.isArray(d)) return null;
    const msgs = d.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .map(m => ({ role: m.role, who: null, text: typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.map(c => c.text || '').join('\n') : ''), time: m.time || null }));
    return msgs.length >= 2 ? msgs : null;
  } catch { return null; }
}

// "Вы сказали:" / "ChatGPT сказал:" (copying a whole ChatGPT page), also "You said:" / "ChatGPT said:"
function parseWebCopy(src) {
  const re = /^(Вы сказали|ChatGPT сказал|You said|ChatGPT said)\s*:?\s*$/gim;
  const marks = [...src.matchAll(re)];
  if (marks.length < 2) return null;
  const msgs = [];
  marks.forEach((m, k) => {
    const start = m.index + m[0].length;
    const end = k + 1 < marks.length ? marks[k + 1].index : src.length;
    const body = src.slice(start, end).trim();
    if (body) msgs.push({ role: /^(вы|you)/i.test(m[1]) ? 'user' : 'assistant', who: null, text: body, time: null });
  });
  return msgs.length >= 2 ? Object.assign(msgs, { bot: 'ChatGPT' }) : null;
}

// "## User" / "### Assistant" headings, "**User:**" or "User:" at the start of a line
function parseHeaded(src) {
  const re = /^(?:#{1,4}\s*|\*\*|__)?([\p{L}][\p{L}\p{N} .\-]{0,24}?)(?:\*\*|__)?\s*(?:\(([^)]{3,40})\))?\s*:?(?:\*\*|__)?\s*(?:\n|:\s*(?=\S)|$)/gmu;
  const marks = [];
  for (const m of src.matchAll(re)) {
    const r = role(m[1]);
    if (!r) continue;
    const lineStart = src.lastIndexOf('\n', m.index - 1) + 1;
    if (lineStart !== m.index) continue;
    const head = m[0];
    if (!/^(#{1,4}\s*|\*\*|__)/.test(head) && !/:/.test(head)) continue;
    marks.push({ index: m.index, end: m.index + head.length, role: r, who: m[1].trim(), time: m[2] || null });
  }
  if (marks.length < 2 || !marks.some(x => x.role === 'user') || !marks.some(x => x.role === 'assistant')) return null;
  const msgs = [];
  marks.forEach((m, k) => {
    const body = src.slice(m.end, k + 1 < marks.length ? marks[k + 1].index : src.length).replace(/^(\*\*|__)\s*/, '').trim().replace(/\n-{3,}\s*$/, '').trim();
    if (body) msgs.push({ role: m.role, who: m.who, text: body, time: m.time });
  });
  const pre = src.slice(0, marks[0].index).trim();
  return msgs.length >= 2 ? Object.assign(msgs, { preface: pre }) : null;
}

// Telegram desktop copy: "Имя, [30.09.2026 14:05]" or "[30.09.2026 14:05] Имя: текст"
function parseTelegram(src) {
  const a = /^(.{1,40}), \[(\d{1,2}\.\d{1,2}\.\d{2,4}[ ,]+\d{1,2}:\d{2}(?::\d{2})?)\]\s*$/gm;
  const b = /^\[(\d{1,2}\.\d{1,2}\.\d{2,4}[ ,]+\d{1,2}:\d{2}(?::\d{2})?)\]\s+([^:\n]{1,40}):\s?/gm;
  let marks = [...src.matchAll(a)].map(m => ({ index: m.index, end: m.index + m[0].length, who: m[1].trim(), time: m[2] }));
  if (marks.length < 2) marks = [...src.matchAll(b)].map(m => ({ index: m.index, end: m.index + m[0].length, who: m[2].trim(), time: m[1] }));
  if (marks.length < 2) return null;
  const names = [...new Set(marks.map(m => m.who))];
  const first = names[0];
  return marks.map((m, k) => ({
    role: role(m.who) || (m.who === first ? 'user' : 'assistant'), who: m.who, time: m.time,
    text: src.slice(m.end, k + 1 < marks.length ? marks[k + 1].index : src.length).trim(),
  })).filter(m => m.text);
}

/**
 * Document mode: one block per logical section — a heading (#, ##, ###) with everything under it.
 * A heading with nothing under it joins the next section ("# Title" + "## Intro"); text without headings is grouped
 * by paragraphs into blocks of a comfortable size; only a very long section is split, and only between paragraphs
 * (never inside a list, table, quote or code block).
 */
const SOFT = 1400, HARD = 3200;
export function parseDoc(text) {
  const src = text.replace(/\r\n?/g, '\n');
  const blocks = [];
  let cur = [];
  let inCode = false;
  const body = () => cur.join('\n').trim();
  const onlyHeadings = () => cur.every(l => !l.trim() || /^#{1,6}\s/.test(l));
  const push = () => {
    const s = body();
    if (s) {
      const first = s.split('\n')[0];
      blocks.push({ role: 'doc', text: s, heading: /^#{1,6}\s/.test(first) ? first.replace(/^#+\s*/, '').replace(/\s+#+\s*$/, '') : null });
    }
    cur = [];
  };
  const headingSection = () => /^#{1,3}\s/.test(cur.find(l => l.trim()) || '');
  const inStructure = () => {
    const last = cur[cur.length - 1] || '';
    return /^\s*([-*+]|\d+[.)])\s/.test(last) || /^\s*\|/.test(last) || /^\s*>/.test(last);
  };
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inCode = !inCode;
    if (!inCode && /^#{1,3}\s/.test(line)) {
      if (!onlyHeadings()) push();
      cur.push(line);
      continue;
    }
    if (!inCode && !line.trim() && cur.length && !inStructure()) {
      const len = body().length;
      // plain text (no headings): paragraphs grouped into ~SOFT blocks; a heading section only breaks when it is huge
      const limit = headingSection() ? HARD : SOFT;
      const next = lines.slice(i + 1).find(l => l.trim()) || '';
      if (len > limit && !/^\s*([-*+]|\d+[.)]|\|)\s?/.test(next)) {
        const head = headingSection() ? cur.find(l => l.trim()) : null;
        push();
        if (head) cur.push(head.replace(/^(#+\s*)(.*?)\s*$/, '$1$2 ·'), ''); // continuation keeps its section title
        continue;
      }
    }
    cur.push(line);
  }
  push();
  return blocks.map(b => (b.heading && / ·$/.test(b.heading) ? { ...b, heading: b.heading.replace(/ ·$/, ''), cont: true } : b));
}

export function parse(text) {
  const chat = parseChat(text);
  if (chat) return { kind: 'chat', blocks: chat, preface: chat.preface || '', bot: chat.bot || '' };
  return { kind: 'doc', blocks: parseDoc(text) };
}
