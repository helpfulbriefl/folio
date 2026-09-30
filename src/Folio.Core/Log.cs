using System.Text;

namespace Folio.Core;

public enum LogLevel { Info, Ok, Warn, Error }

public sealed record LogEntry(long Id, DateTime Time, LogLevel Level, string Message);

/// <summary>Tiny thread-safe logger: daily files in %LocalAppData%\Folio\logs + in-memory ring for the log panel.</summary>
public static class Log
{
    const int RingSize = 3000;
    static readonly object Gate = new();
    static readonly Queue<LogEntry> Ring = new();
    static StreamWriter? _writer;
    static DateTime _day;
    static long _seq;
    static string? _dir;

    public static event Action<LogEntry>? Written;
    public static string Directory => _dir ?? "";

    public static void Init(string dir, int keepDays = 14)
    {
        _dir = dir;
        System.IO.Directory.CreateDirectory(dir);
        try
        {
            foreach (var f in System.IO.Directory.GetFiles(dir, "folio-*.log"))
                if (File.GetLastWriteTimeUtc(f) < DateTime.UtcNow.AddDays(-keepDays)) File.Delete(f);
        }
        catch { /* best effort */ }
    }

    public static void Info(string m) => Write(LogLevel.Info, m);
    public static void Ok(string m) => Write(LogLevel.Ok, m);
    public static void Warn(string m) => Write(LogLevel.Warn, m);
    public static void Error(string m, Exception? ex = null) =>
        Write(LogLevel.Error, ex == null ? m : $"{m}: {ex.GetType().Name}: {ex.Message}");

    public static void Write(LogLevel level, string message)
    {
        LogEntry e;
        lock (Gate)
        {
            e = new LogEntry(++_seq, DateTime.Now, level, message.Replace("\r", "").Replace("\n", " ⏎ "));
            Ring.Enqueue(e);
            while (Ring.Count > RingSize) Ring.Dequeue();
            try { WriteFile(e); } catch { /* disk full / locked – never crash because of logging */ }
        }
        try { Written?.Invoke(e); } catch { }
    }

    static void WriteFile(LogEntry e)
    {
        if (_dir == null) return;
        if (_writer == null || e.Time.Date != _day)
        {
            _writer?.Dispose();
            _day = e.Time.Date;
            var path = Path.Combine(_dir, $"folio-{_day:yyyy-MM-dd}.log");
            _writer = new StreamWriter(new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(false)) { AutoFlush = true };
        }
        _writer.WriteLine($"{e.Time:HH:mm:ss.fff} {LevelName(e.Level),-5} {e.Message}");
    }

    public static string LevelName(LogLevel l) => l switch
    {
        LogLevel.Info => "INFO", LogLevel.Ok => "OK", LogLevel.Warn => "WARN", _ => "ERROR"
    };

    public static IReadOnlyList<LogEntry> Snapshot(long afterId = 0)
    {
        lock (Gate) return Ring.Where(x => x.Id > afterId).ToList();
    }

    public static void Flush() { lock (Gate) _writer?.Flush(); }

    /// <summary>Clears the in-memory list shown in the log panel (files on disk stay).</summary>
    public static void Clear() { lock (Gate) Ring.Clear(); }
}
