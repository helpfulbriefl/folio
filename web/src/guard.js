// Start-up guard, loaded before app.js (plain ES5, no imports). It reports script errors that happen before
// main.js installs its own handlers, and a start that does not finish, to the host log: a white window must
// always leave a trace in %LocalAppData%\Folio\logs. The host also reads window.__folioBoot when the start is slow.
(function () {
  var wv = window.chrome && window.chrome.webview;
  var boot = window.__folioBoot = { stage: 'html', at: 0 };
  var errors = window.__folioErrors = [];
  var sent = 0;
  function send(level, msg) {
    if (!wv || sent >= 12) return;
    sent++;
    try { wv.postMessage(JSON.stringify({ m: 'log.write', p: { level: level, msg: String(msg).slice(0, 4000) } })); } catch (e) { }
  }
  function early() { return boot.stage === 'html'; } // main.js reports everything after it started
  window.addEventListener('error', function (e) {
    var where = String(e.filename || '').split('/').pop() + ':' + e.lineno + ':' + e.colno;
    var m = (e.message || 'script error') + ' @ ' + where + (e.error && e.error.stack ? '\n' + e.error.stack : '');
    errors.push(m.slice(0, 600));
    if (early()) send('error', 'page (before start): ' + m);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    var m = 'unhandled: ' + (r && (r.stack || r.message) || String(r));
    errors.push(m.slice(0, 600));
    if (early()) send('error', 'page (before start): ' + m);
  });
  setTimeout(function () {
    if (boot.stage !== 'ready') send('warn', 'page: the start is still at "' + boot.stage + '" after 10 s' + (errors.length ? '; last error: ' + errors[errors.length - 1] : ''));
  }, 10000);
})();
