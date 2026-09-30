// AI requests go through the host (the API key never reaches the web layer). OpenAI-compatible chat completions.
import { host } from '../host.js';
import { settings } from '../settings.js';
import { lang } from '../i18n.js';
import { uid } from '../util.js';

export const PROVIDERS = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', keyUrl: 'https://openrouter.ai/keys' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  mistral: { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', keyUrl: 'https://console.mistral.ai/api-keys' },
  ollama: { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', noKey: true, local: true },
  lmstudio: { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', model: 'local-model', noKey: true, local: true },
  custom: { name: 'Custom', baseUrl: '', model: '' },
};

export const aiState = { hasKey: false, checked: false };

export async function refreshKey() {
  try { const r = await host.call('ai.hasKey', { provider: settings.get('ai.provider') }); aiState.hasKey = !!r?.has; } catch { aiState.hasKey = false; }
  aiState.checked = true;
  return aiState.hasKey;
}
export const needsKey = () => !PROVIDERS[settings.get('ai.provider')]?.noKey;
export const configured = () => (!needsKey() || aiState.hasKey) && !!settings.get('ai.baseUrl') && !!settings.get('ai.model');

const LANGN = { ru: 'Russian', en: 'English', zh: 'Simplified Chinese' };
function langRule() {
  const a = settings.get('ai.answerLang') || 'auto';
  if (a === 'auto') return 'Answer in the language of the user\'s message (if unclear, in the language of the text).';
  return `Always answer in ${a === 'ui' ? LANGN[lang()] || 'English' : a}.`;
}
const EDIT_RULES = 'Return ONLY the resulting text: no quotes, no comments, no explanations, no code fences around it. Keep the original formatting exactly (Markdown, line breaks, lists, code blocks, links). Keep the original language.';

export function taskPrompt(task, arg) {
  switch (task) {
    case 'fix': return 'Task: fix\nYou are a meticulous proofreader. Fix spelling, grammar, punctuation and typos in the text. Do not rephrase and do not change the meaning, style, terminology or formatting. If there are no errors, return the text unchanged. ' + EDIT_RULES;
    case 'shorten': return 'Task: shorten\nYou are an editor. Make the text about 30–40% shorter while keeping all key facts, names, numbers and the author\'s voice. ' + EDIT_RULES;
    case 'polite': return 'Task: polite\nYou are an editor. Rewrite the text so it sounds more polite, warm and professional, keeping the meaning and roughly the length. ' + EDIT_RULES;
    case 'translate': return `Task: translate\nTranslate the text into ${arg}. Keep Markdown formatting, code, URLs and names unchanged. Return ONLY the translation, without comments.`;
    case 'continue': return 'Task: continue\nContinue the text naturally in the same language, style and formatting: write one or two paragraphs that follow from its end. Return ONLY the continuation, do not repeat the given text.';
    case 'explain': return 'Task: explain\nExplain clearly and concisely what this text or code does and means. Use short paragraphs or a list, Markdown allowed. ' + langRule();
    case 'summary': return 'Task: summary\nSummarize the text in 3–6 short bullet points with the key ideas. ' + langRule();
    default: return 'Task: chat\nYou are the writing assistant built into Folio, a notepad for Windows. The user\'s document (or the selected fragment) is given inside <document> tags. Help with writing, editing and questions about the text; be concise and use Markdown. ' + langRule() + ' If, and only if, the user asks you to change the text: write one short sentence about what you changed, then output the complete new version of the given fragment inside <folio-edit></folio-edit> tags (the whole fragment, not only the changed part).';
  }
}

export const EDIT_TASKS = new Set(['fix', 'shorten', 'polite', 'translate', 'continue']);

/** Streams a completion. onDelta(fullTextSoFar). Returns {text, model}. */
export function complete(messages, { onDelta, signal } = {}) {
  const a = settings.get('ai');
  const id = uid('ai');
  let acc = '';
  const off = host.on('ai.delta', d => { if (d.id === id) { acc += d.text; onDelta?.(acc); } });
  if (signal) signal.onabort = () => host.send('ai.cancel', { id });
  return host.call('ai.request', {
    id, provider: a.provider, baseUrl: a.baseUrl, model: a.model, messages,
    temperature: a.temperature ?? 0.3, stream: a.stream !== false, maxTokens: a.maxTokens || 0,
  }).then(r => { off(); return { text: r?.text ?? acc, model: r?.model || a.model }; }, e => { off(); throw e; });
}

/** Cleans a rewritten text: drops code fences / tags models sometimes add around the whole answer. */
export function cleanEdit(out, original) {
  let s = out.replace(/^\s*<text>\s*\n?|\n?\s*<\/text>\s*$/g, '');
  const fence = /^\s*```[\w-]*\n([\s\S]*?)\n```\s*$/.exec(s);
  if (fence && !/^\s*```/.test(original)) s = fence[1];
  if (!/^\s/.test(original)) s = s.replace(/^\s+/, '');
  if (/\n$/.test(original) && !/\n$/.test(s)) s += '\n';
  if (!/\n$/.test(original)) s = s.replace(/\s+$/, '');
  return s;
}

export function parseEdit(text) {
  const m = /<folio-edit>\n?([\s\S]*?)\n?<\/folio-edit>/.exec(text);
  if (!m) return null;
  return { note: text.replace(m[0], '').trim(), text: m[1] };
}
