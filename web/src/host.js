// Bridge to the Windows host (WebView2). Requests: {id, m, p} → {id, ok, r | err}. Events: {ev, d}.
import { Emitter } from './util.js';
import { createMockHost } from './mockhost.js';

const wv = window.chrome?.webview;
const events = new Emitter();
const pending = new Map();
let seq = 0;

class HostError extends Error {
  constructor(err) { super(err?.message || String(err)); this.code = err?.code || 'error'; }
}

function onMessage(msg) {
  if (!msg) return;
  if (msg.ev) { events.emit(msg.ev, msg.d); return; }
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.ok) p.resolve(msg.r); else p.reject(new HostError(msg.err));
}

let mock = null;
if (wv) {
  wv.addEventListener('message', e => onMessage(typeof e.data === 'string' ? JSON.parse(e.data) : e.data));
} else {
  mock = createMockHost(ev => onMessage(ev));
}

export const host = {
  real: !!wv,
  call(m, p = {}) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const msg = { id, m, p };
      if (wv) wv.postMessage(JSON.stringify(msg));
      else mock.handle(msg);
    });
  },
  /** fire-and-forget */
  send(m, p = {}) { this.call(m, p).catch(e => console.warn(m, e)); },
  on(ev, fn) { return events.on(ev, fn); },
  /** Passes dropped File objects to the host so it can read their real paths. */
  postFiles(files) {
    if (wv?.postMessageWithAdditionalObjects) { wv.postMessageWithAdditionalObjects(JSON.stringify({ m: 'drop.files' }), files); return true; }
    if (mock) { mock.dropFiles(files); return true; }
    return false;
  },
  get mock() { return mock; },
  HostError,
};
