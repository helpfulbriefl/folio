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

export const aiState = { hasKey: false, checked: false, keys: {}, models: {} };

// ---------- profiles: several connections (service + address + model + its own key), one of them active ----------
// The active profile is mirrored into ai.provider / ai.baseUrl / ai.model, so the rest of the app reads those as before.
export const profiles = () => settings.get('ai.profiles') || [];
export const activeProfile = () => { const l = profiles(); return l.find(p => p.id === settings.get('ai.active')) || l[0] || null; };
/** Id of the saved key for the active profile (old settings: the provider name). */
export const keyId = () => activeProfile()?.keyId || settings.get('ai.provider') || 'openai';
const providerName = id => (id === 'custom' ? '' : PROVIDERS[id]?.name) || hostOf(settings.get('ai.baseUrl')) || 'API';
const hostOf = u => { try { return new URL(u).hostname.replace(/^(www|api)\./, ''); } catch { return ''; } };

/** Creates the first profile from the old single connection (keeps the key that was saved for that provider). */
export function ensureProfiles() {
  const a = settings.get('ai') || {};
  if (Array.isArray(a.profiles) && a.profiles.length) {
    if (!a.profiles.some(p => p.id === a.active)) settings.set('ai', { ...structuredClone(a), active: a.profiles[0].id });
    return;
  }
  const id = uid('p');
  const name = a.provider === 'custom' ? hostOf(a.baseUrl) || 'Custom' : PROVIDERS[a.provider]?.name || 'OpenAI';
  settings.set('ai', { ...structuredClone(a), active: id, profiles: [{ id, name, provider: a.provider || 'openai', baseUrl: a.baseUrl || '', model: a.model || '', keyId: a.provider || 'openai' }] });
}

/** ai.provider / baseUrl / model changed (settings, setup card, model menu) → store it in the active profile too. */
function syncProfile() {
  const a = settings.get('ai');
  const list = a?.profiles;
  if (!Array.isArray(list) || !list.length) return;
  const i = list.findIndex(p => p.id === a.active);
  if (i < 0) return; // only ever write into the profile that is really active
  const p = list[i];
  if (p.provider === a.provider && p.baseUrl === a.baseUrl && p.model === a.model) return;
  const next = list.map((x, k) => (k === i ? { ...x, provider: a.provider, baseUrl: a.baseUrl, model: a.model } : x));
  settings.set('ai.profiles', next, { silent: true });
}
settings.on('ai', syncProfile);

export async function useProfile(id) {
  const p = profiles().find(x => x.id === id);
  if (!p) return;
  settings.set('ai', { ...structuredClone(settings.get('ai')), active: id, provider: p.provider, baseUrl: p.baseUrl, model: p.model });
  await refreshKey();
}

export function addProfile({ provider = 'openai', name } = {}) {
  ensureProfiles();
  const P = PROVIDERS[provider] || PROVIDERS.custom;
  const id = uid('p');
  const list = profiles();
  let base = name || (provider === 'custom' ? 'Custom' : P.name), nm = base, n = 2;
  while (list.some(x => x.name === nm)) nm = `${base} ${n++}`;
  const p = { id, name: nm, provider, baseUrl: P.baseUrl, model: P.model, keyId: 'key-' + id };
  settings.set('ai.profiles', [...list, p]);
  return useProfile(id).then(() => p);
}

export function renameProfile(id, name) {
  if (!name?.trim()) return;
  settings.set('ai.profiles', profiles().map(p => (p.id === id ? { ...p, name: name.trim().slice(0, 40) } : p)));
}

export async function removeProfile(id) {
  const list = profiles();
  const p = list.find(x => x.id === id);
  if (!p || list.length < 2) return false;
  // a key is only deleted when no other profile uses it
  if (!list.some(x => x.id !== id && x.keyId === p.keyId)) { try { await host.call('ai.setKey', { keyId: p.keyId, provider: p.provider, key: '' }); } catch { } }
  const rest = list.filter(x => x.id !== id);
  settings.set('ai.profiles', rest);
  if (settings.get('ai.active') === id) await useProfile(rest[0].id);
  return true;
}

export const profileLabel = p => (p ? p.name || providerName(p.provider) : '');

export async function refreshKey() {
  ensureProfiles();
  const ids = [...new Set(profiles().map(p => p.keyId).filter(Boolean))];
  try {
    const r = await host.call('ai.hasKey', { keyId: keyId(), provider: settings.get('ai.provider'), keyIds: ids });
    aiState.hasKey = !!r?.has;
    aiState.keys = r?.keys || { [keyId()]: aiState.hasKey };
  } catch { aiState.hasKey = false; }
  aiState.checked = true;
  return aiState.hasKey;
}

export async function saveKey(key) {
  await host.call('ai.setKey', { keyId: keyId(), provider: settings.get('ai.provider'), key });
  aiState.hasKey = !!key;
  aiState.keys[keyId()] = !!key;
  delete aiState.models[modelsCacheKey()];
}

// ---------- models of the active connection (GET /models with its key), cached per address + key ----------
const modelsCacheKey = () => (settings.get('ai.baseUrl') || '') + '|' + keyId();
export const cachedModels = () => aiState.models[modelsCacheKey()] || null;
export async function loadModels({ force = false } = {}) {
  const ck = modelsCacheKey();
  if (!force && aiState.models[ck]) return aiState.models[ck];
  const r = await host.call('ai.models', { provider: settings.get('ai.provider'), baseUrl: settings.get('ai.baseUrl'), keyId: keyId() });
  return (aiState.models[ck] = r?.models || []);
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
/** Streams a completion. onDelta(answerSoFar), onThink(reasoningSoFar) while the model "thinks". Returns {text, model, thoughts}. */
export function complete(messages, { onDelta, onThink, signal } = {}) {
  const a = settings.get('ai');
  const id = uid('ai');
  let acc = '', thoughts = '';
  // reasoning arrives either as separate deltas (reasoning_content) or inline as <think>…</think> at the start of the answer
  const emit = () => { const s = splitThink(acc); onDelta?.(s.text); if (s.think || thoughts) onThink?.(thoughts + s.think, s.open); };
  const off = host.on('ai.delta', d => { if (d.id === id) { acc += d.text; emit(); } });
  const offR = host.on('ai.reasoning', d => { if (d.id === id) { thoughts += d.text; onThink?.(thoughts, true); } });
  const done = () => { off(); offR(); };
  if (signal) signal.onabort = () => host.send('ai.cancel', { id });
  return host.call('ai.request', {
    id, provider: a.provider, keyId: keyId(), baseUrl: a.baseUrl, model: (a.model || '').trim(), messages,
    temperature: a.temperature ?? 0.3, stream: a.stream !== false, maxTokens: a.maxTokens || 0,
  }).then(r => {
    done();
    const s = splitThink(r?.text ?? acc);
    if (!s.text.trim()) throw Object.assign(new Error(thoughts || s.think ? 'only reasoning, no answer' : 'empty answer'), { code: 'empty' });
    return { text: s.text, model: r?.model || a.model, thoughts: thoughts + s.think };
  }, e => { done(); throw e; });
}

/** "<think>…</think>answer" → {think, text, open}; an unclosed <think> means the model is still thinking. */
export function splitThink(s) {
  const m = /^\s*<(think|thinking|reasoning)>([\s\S]*?)(<\/\1>|$)/i.exec(s || '');
  if (!m) return { think: '', text: s || '', open: false };
  return { think: m[2].trim(), text: (s.slice(m[0].length)).replace(/^\s+/, ''), open: !m[3] };
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
