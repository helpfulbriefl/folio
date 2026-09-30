using Folio.Core;

namespace Folio;

/// <summary>Watches the files open in one window and reports outside changes (another program saved or deleted the file).</summary>
internal sealed class FileWatch : IDisposable
{
    sealed record Known(long Mtime, long Size);

    readonly Action<string, Known?> _report;
    readonly Control _ui;
    readonly Dictionary<string, FileSystemWatcher> _dirs = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, Known> _files = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, System.Windows.Forms.Timer> _pending = new(StringComparer.OrdinalIgnoreCase);
    readonly object _gate = new();

    public FileWatch(Control ui, Action<string, long, long> changed, Action<string> deleted)
    {
        _ui = ui;
        _report = (p, k) => { if (k == null) deleted(p); else changed(p, k.Mtime, k.Size); };
    }

    public static long Ms(DateTime utc) => new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    /// <summary>Replaces the watched set. mtime/size are what the window currently shows.</summary>
    public void Set(IEnumerable<(string path, long mtime, long size)> files)
    {
        lock (_gate)
        {
            _files.Clear();
            foreach (var (p, m, s) in files)
            {
                try { _files[Path.GetFullPath(p)] = new Known(m, s); } catch { }
            }
            var dirs = _files.Keys.Select(Path.GetDirectoryName).Where(d => d != null).Cast<string>().ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var d in _dirs.Keys.Where(d => !dirs.Contains(d)).ToList()) { _dirs[d].Dispose(); _dirs.Remove(d); }
            foreach (var d in dirs.Where(d => !_dirs.ContainsKey(d)))
            {
                try
                {
                    if (!Directory.Exists(d)) continue;
                    var w = new FileSystemWatcher(d) { NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName, IncludeSubdirectories = false, InternalBufferSize = 32768 };
                    w.Changed += OnEvent; w.Created += OnEvent; w.Deleted += OnEvent;
                    w.Renamed += (s, e) => { OnPath(e.OldFullPath); OnPath(e.FullPath); };
                    w.Error += (s, e) => Log.Warn("file watcher: " + e.GetException().Message);
                    w.EnableRaisingEvents = true;
                    _dirs[d] = w;
                }
                catch (Exception ex) { Log.Warn($"Cannot watch {d}: {ex.Message}"); }
            }
        }
    }

    /// <summary>Our own save: remember the new state so it is not reported as an outside change.</summary>
    public void Saved(string path, long mtime, long size)
    {
        lock (_gate)
        {
            try { var full = Path.GetFullPath(path); if (_files.ContainsKey(full)) _files[full] = new Known(mtime, size); } catch { }
        }
    }

    void OnEvent(object sender, FileSystemEventArgs e) => OnPath(e.FullPath);

    void OnPath(string path)
    {
        lock (_gate) { if (!_files.ContainsKey(path)) return; }
        if (_ui.IsDisposed || !_ui.IsHandleCreated) return;
        try { _ui.BeginInvoke(() => Debounce(path)); } catch { }
    }

    void Debounce(string path)
    {
        if (_pending.TryGetValue(path, out var t)) { t.Stop(); t.Start(); return; }
        t = new System.Windows.Forms.Timer { Interval = 350 };
        t.Tick += (s, e) => { t.Stop(); t.Dispose(); _pending.Remove(path); Check(path); };
        _pending[path] = t;
        t.Start();
    }

    void Check(string path)
    {
        Known? before;
        lock (_gate) { if (!_files.TryGetValue(path, out before)) return; }
        var fi = new FileInfo(path);
        Known? now = fi.Exists ? new Known(Ms(fi.LastWriteTimeUtc), fi.Length) : null;
        if (now == null)
        {
            // atomic saves by other editors: file disappears for a moment
            var retry = new System.Windows.Forms.Timer { Interval = 700 };
            retry.Tick += (s, e) =>
            {
                retry.Stop(); retry.Dispose();
                if (File.Exists(path)) Check(path);
                else { lock (_gate) { if (!_files.ContainsKey(path)) return; } _report(path, null); }
            };
            retry.Start();
            return;
        }
        if (before != null && before.Mtime == now.Mtime && before.Size == now.Size) return;
        lock (_gate) _files[path] = now;
        _report(path, now);
    }

    public void Dispose()
    {
        lock (_gate)
        {
            foreach (var w in _dirs.Values) w.Dispose();
            _dirs.Clear();
        }
        foreach (var t in _pending.Values) t.Dispose();
        _pending.Clear();
    }
}
