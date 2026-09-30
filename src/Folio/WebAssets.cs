using System.Reflection;

namespace Folio;

/// <summary>The UI files embedded into the exe (web/dist), served as https://app.folio/…</summary>
internal static class WebAssets
{
    public const string Host = "app.folio";
    public const string Origin = "https://" + Host;
    public const string StartUrl = Origin + "/index.html";

    static readonly Lazy<Dictionary<string, byte[]>> Files = new(Load);

    static Dictionary<string, byte[]> Load()
    {
        var asm = Assembly.GetExecutingAssembly();
        var d = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in asm.GetManifestResourceNames())
        {
            var n = name.Replace('\\', '/');
            if (!n.StartsWith("web/", StringComparison.Ordinal)) continue;
            using var s = asm.GetManifestResourceStream(name)!;
            using var ms = new MemoryStream();
            s.CopyTo(ms);
            d[n[4..]] = ms.ToArray();
        }
        return d;
    }

    public static bool TryGet(string uri, out byte[] data, out string mime)
    {
        data = Array.Empty<byte>();
        mime = "application/octet-stream";
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var u) || !u.Host.Equals(Host, StringComparison.OrdinalIgnoreCase)) return false;
        var path = Uri.UnescapeDataString(u.AbsolutePath).TrimStart('/');
        if (path.Length == 0) path = "index.html";
        if (!Files.Value.TryGetValue(path, out var bytes)) return false;
        data = bytes;
        mime = Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            ".ico" => "image/x-icon",
            ".woff2" => "font/woff2",
            ".woff" => "font/woff",
            _ => "application/octet-stream",
        };
        return true;
    }

    public static int Count => Files.Value.Count;

    public static Stream? Resource(string logicalName) => Assembly.GetExecutingAssembly().GetManifestResourceStream(logicalName);
}
