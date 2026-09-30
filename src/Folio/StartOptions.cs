using System.Text.Json.Nodes;

namespace Folio;

/// <summary>Command line: Folio.exe [files…] [--new-window] [--tray] [--quick-note] [--selftest[=dir]] [--devtools]</summary>
internal sealed class StartOptions
{
    public List<string> Files { get; } = new();
    public bool NewWindow, Tray, QuickNote, SelfTest, Restarted, DevTools, Fresh, Autostart;
    public string? SelfTestOut;
    public string Cwd = Environment.CurrentDirectory;

    public static StartOptions Parse(IEnumerable<string> args)
    {
        var o = new StartOptions();
        foreach (var raw in args)
        {
            var a = raw.Trim();
            if (a.Length == 0) continue;
            if (a.StartsWith("--", StringComparison.Ordinal) || (a.StartsWith('/') && a.Length > 1 && !a.Contains('\\') && !a.Contains(':')))
            {
                var k = a.TrimStart('-', '/');
                string? v = null;
                var eq = k.IndexOf('=');
                if (eq > 0) { v = k[(eq + 1)..].Trim('"'); k = k[..eq]; }
                switch (k.ToLowerInvariant())
                {
                    case "new-window": o.NewWindow = true; break;
                    case "tray": case "minimized": o.Tray = true; break;
                    case "autostart": o.Autostart = true; break;
                    case "quick-note": case "quicknote": o.QuickNote = true; break;
                    case "selftest": o.SelfTest = true; o.SelfTestOut = v; break;
                    case "restarted": case "updated": o.Restarted = true; break;
                    case "devtools": o.DevTools = true; break;
                    case "fresh": o.Fresh = true; break;
                }
                continue;
            }
            o.Files.Add(a);
        }
        return o;
    }

    /// <summary>Absolute paths (relative ones are resolved against the directory Folio was started from).</summary>
    public List<string> AbsoluteFiles()
    {
        var r = new List<string>();
        foreach (var f in Files)
        {
            try { r.Add(Path.GetFullPath(Path.IsPathRooted(f) ? f : Path.Combine(Cwd, f))); } catch { }
        }
        return r;
    }

    public JsonObject ToJson() => new()
    {
        ["files"] = new JsonArray(AbsoluteFiles().Select(f => (JsonNode)f).ToArray()),
        ["newWindow"] = NewWindow, ["quickNote"] = QuickNote, ["tray"] = Tray, ["cwd"] = Cwd,
    };

    public static StartOptions FromJson(JsonObject j)
    {
        var o = new StartOptions
        {
            NewWindow = j["newWindow"]?.GetValue<bool>() ?? false,
            QuickNote = j["quickNote"]?.GetValue<bool>() ?? false,
            Tray = j["tray"]?.GetValue<bool>() ?? false,
            Cwd = j["cwd"]?.GetValue<string>() ?? Environment.CurrentDirectory,
        };
        if (j["files"] is JsonArray a) foreach (var f in a) if (f?.GetValue<string>() is { Length: > 0 } s) o.Files.Add(s);
        return o;
    }
}
