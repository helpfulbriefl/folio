using System.Security.Cryptography;
using System.Text;

namespace Folio.Core;

public sealed record FileVersion(string Id, DateTime Time, long Size);

/// <summary>Before every overwrite the old content of a file is copied to %LocalAppData%\Folio\versions\&lt;hash&gt;\.</summary>
public static class FileVersions
{
    public static int Keep { get; set; } = 20;
    public static long MaxFileSize { get; set; } = 16L * 1024 * 1024;

    public static string DirFor(string path)
    {
        var full = Path.GetFullPath(path).ToLowerInvariant();
        var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(full)))[..16].ToLowerInvariant();
        return Path.Combine(AppPaths.Versions, hash);
    }

    /// <summary>Copies the current file content into the history unless it is identical to the newest snapshot or to the bytes about to be written.</summary>
    public static string? Snapshot(string path, byte[]? upcoming = null)
    {
        var fi = new FileInfo(path);
        if (!fi.Exists || fi.Length == 0 || fi.Length > MaxFileSize) return null;
        var current = File.ReadAllBytes(path);
        if (upcoming != null && current.AsSpan().SequenceEqual(upcoming)) return null;
        var dir = DirFor(path);
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "path.txt"), Path.GetFullPath(path), Encoding.UTF8);
        var newest = Directory.GetFiles(dir, "*.bak").OrderByDescending(f => f, StringComparer.Ordinal).FirstOrDefault();
        if (newest != null && new FileInfo(newest).Length == current.Length && File.ReadAllBytes(newest).AsSpan().SequenceEqual(current))
            return Path.GetFileNameWithoutExtension(newest);
        var id = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff");
        File.WriteAllBytes(Path.Combine(dir, id + ".bak"), current);
        Prune(dir);
        return id;
    }

    static void Prune(string dir)
    {
        var all = Directory.GetFiles(dir, "*.bak").OrderByDescending(f => f, StringComparer.Ordinal).ToList();
        foreach (var f in all.Skip(Math.Max(1, Keep)))
            try { File.Delete(f); } catch { }
    }

    public static IReadOnlyList<FileVersion> List(string path)
    {
        var dir = DirFor(path);
        if (!Directory.Exists(dir)) return Array.Empty<FileVersion>();
        var list = new List<FileVersion>();
        foreach (var f in Directory.GetFiles(dir, "*.bak"))
        {
            var id = Path.GetFileNameWithoutExtension(f);
            if (!DateTime.TryParseExact(id, "yyyyMMdd-HHmmss-fff", null, System.Globalization.DateTimeStyles.None, out var t))
                t = File.GetLastWriteTime(f);
            list.Add(new FileVersion(id, t, new FileInfo(f).Length));
        }
        return list.OrderByDescending(v => v.Id, StringComparer.Ordinal).ToList();
    }

    public static byte[] Read(string path, string id)
    {
        if (id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || id.Contains("..")) throw new ArgumentException("bad id");
        return File.ReadAllBytes(Path.Combine(DirFor(path), id + ".bak"));
    }
}
