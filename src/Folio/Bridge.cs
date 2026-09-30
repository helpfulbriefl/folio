using System.Diagnostics;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;
using Folio.Core;
using Folio.Core.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace Folio;

/// <summary>Everything the web UI can ask the host to do (see web/src/host.js and web/src/mockhost.js for the shapes).</summary>
internal sealed partial class MainForm
{
    readonly Dictionary<string, CancellationTokenSource> _aiJobs = new();

    static string? S(JsonObject p, string k) => p[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
    static bool B(JsonObject p, string k, bool def = false) => p[k] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : def;
    static double N(JsonObject p, string k, double def = 0)
    {
        if (p[k] is JsonValue v)
        {
            if (v.TryGetValue<double>(out var d)) return d;
            if (v.TryGetValue<long>(out var l)) return l;
            if (v.TryGetValue<int>(out var i)) return i;
        }
        return def;
    }
    static string Need(JsonObject p, string k) => S(p, k) is { Length: > 0 } s ? s : throw new BridgeException("args", $"'{k}' is required");
    static JsonArray Arr(IEnumerable<string> items) => new(items.Select(x => (JsonNode)JsonValue.Create(x)!).ToArray());

    async Task<JsonNode?> Dispatch(string m, JsonObject p)
    {
        switch (m)
        {
            // ---------------------------------------------------------------- app
            case "app.init": return await _app.InitPayload(this, _files);
            case "app.ready":
                WebReady = true;
                FlushEvents();
                SendState();
                _app.OnWindowReady(this);
                return true;
            case "app.exit": _app.WindowExit(this); return true;
            case "app.newWindow": _app.NewWindow(Array.Empty<string>()); return true;
            case "app.restart": _app.Restart(); return true;
            case "app.strings":
                if (p["strings"] is JsonObject strings) _app.SetStrings(S(p, "lang") ?? "", strings);
                return true;

            // ---------------------------------------------------------------- window
            case "win.drag":
                if (_app.SelfTestMode) Log.Info($"self-test: win.drag (button down: {Native.LeftButtonDown()})");
                StartDrag();
                return true;
            case "win.resize": StartResize(S(p, "edge")); return true;
            case "win.sysmenu": ShowSystemMenu(); return true;
            case "win.minimize": WindowState = FormWindowState.Minimized; return true;
            case "win.maximize":
                if (_app.SelfTestMode) Log.Info($"self-test: win.maximize ({S(p, "why") ?? "button"})");
                ToggleMaximize();
                return true;
            case "win.fullscreen": SetFullscreen(B(p, "on")); return true;
            case "win.topmost": TopMost = B(p, "on"); SendState(); return true;
            case "win.hide":
                if (_app.TrayVisible) HideToTray(); else WindowState = FormWindowState.Minimized;
                return true;
            case "win.show": ShowAndActivate(); return true;
            case "win.setTitle": Text = (S(p, "title") ?? "Folio").Replace('\n', ' '); return true;
            case "win.theme":
            {
                bool dark = B(p, "dark");
                var bg = ParseColor(S(p, "bg"), dark ? Color.FromArgb(0x1A, 0x1B, 0x1E) : Color.FromArgb(0xF6, 0xF5, 0xF1));
                ApplyDark(dark);
                BackColor = bg;
                _web.DefaultBackgroundColor = bg;
                _app.ThemeChanged(this, dark, bg);
                return true;
            }
            case "win.uiScale":
                try { _web.ZoomFactor = Math.Clamp(N(p, "factor", 1), 0.75, 2); } catch { }
                return true;

            // ---------------------------------------------------------------- files
            case "file.read":
            {
                var path = Need(p, "path");
                var enc = S(p, "encoding");
                int fallback = _app.FallbackCodePage();
                var r = await Task.Run(() => TextFile.Load(path, string.IsNullOrEmpty(enc) ? null : enc, fallback));
                return new JsonObject
                {
                    ["path"] = r.Path, ["text"] = r.Text, ["encoding"] = r.Encoding, ["bom"] = r.Bom, ["eol"] = r.Eol, ["mixedEol"] = r.MixedEol,
                    ["confidence"] = Math.Round(r.Confidence, 3), ["reason"] = r.Reason,
                    ["candidates"] = new JsonArray(r.Candidates.Select(c => (JsonNode)new JsonObject { ["key"] = c.Key, ["value"] = Math.Round(c.Value, 3) }).ToArray()),
                    ["mtime"] = FileWatch.Ms(r.MtimeUtc), ["size"] = r.Size, ["readOnly"] = r.ReadOnly, ["binary"] = r.Binary, ["invalid"] = r.Invalid,
                };
            }
            case "file.save":
            {
                var path = Need(p, "path");
                var text = S(p, "text") ?? "";
                var enc = S(p, "encoding") ?? "utf-8";
                var bom = B(p, "bom");
                var eol = S(p, "eol") ?? "crlf";
                var r = await Task.Run(() => TextFile.Save(path, text, enc, bom, eol, keepVersion: _app.SettingBool("versions", true)));
                if (!r.Ok)
                {
                    Log.Warn($"Save failed ({r.Error}): {path}: {r.Message}");
                    return new JsonObject { ["ok"] = false, ["error"] = r.Error, ["message"] = r.Message };
                }
                var ms = FileWatch.Ms(r.MtimeUtc);
                _app.NotifySaved(path, ms, r.Size);
                Log.Ok($"Saved {path} ({TextEncodings.DisplayName(enc)}{(bom ? " BOM" : "")}, {eol.ToUpperInvariant()}, {r.Size} B{(r.Replaced > 0 ? $", {r.Replaced} replaced" : "")})");
                return new JsonObject { ["ok"] = true, ["mtime"] = ms, ["size"] = r.Size, ["replaced"] = r.Replaced, ["version"] = r.VersionId };
            }
            case "file.exists":
            {
                var path = S(p, "path");
                return new JsonObject { ["exists"] = !string.IsNullOrEmpty(path) && File.Exists(path) };
            }
            case "file.saveDialog": return SaveDialog(S(p, "name"), S(p, "dir"), B(p, "noOverwritePrompt"));
            case "file.openDialog": return OpenDialog(S(p, "dir"));
            case "file.checkEncodable":
            {
                var text = S(p, "text") ?? "";
                var enc = S(p, "encoding") ?? "utf-8";
                var r = await Task.Run(() => TextFile.CheckEncodable(text, enc));
                return new JsonObject
                {
                    ["count"] = r.Count, ["chars"] = r.Chars,
                    ["positions"] = new JsonArray(r.Positions.Select(x => (JsonNode)new JsonArray(x.Select(v => (JsonNode)v).ToArray())).ToArray()),
                };
            }
            case "file.previews":
            {
                var path = Need(p, "path");
                var ids = (p["ids"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0).ToList() ?? new List<string>();
                var list = await Task.Run(() =>
                {
                    byte[] data;
                    using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    {
                        data = new byte[Math.Min(fs.Length, 16384)];
                        int read = 0, n;
                        while (read < data.Length && (n = fs.Read(data, read, data.Length - read)) > 0) read += n;
                        if (read < data.Length) Array.Resize(ref data, read);
                        if (fs.Length > data.Length) data = TrimPartial(data);
                    }
                    return TextFile.Previews(data, ids);
                });
                return new JsonArray(list.Select(x => (JsonNode)new JsonObject { ["id"] = x.Id, ["name"] = x.Name, ["preview"] = x.Preview, ["bad"] = x.Bad, ["score"] = x.Score }).ToArray());
            }
            case "file.watch":
            {
                var files = new List<(string, long, long)>();
                if (p["files"] is JsonArray arr)
                    foreach (var n in arr.OfType<JsonObject>())
                        if (S(n, "path") is { Length: > 0 } fp) files.Add((fp, (long)N(n, "mtime"), (long)N(n, "size")));
                _watch.Set(files);
                return true;
            }
            case "file.reveal":
            {
                var path = Need(p, "path");
                if (File.Exists(path)) Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = false });
                else if (Path.GetDirectoryName(path) is { } dir && Directory.Exists(dir)) OpenFolder(dir);
                else throw new BridgeException("notFound", "File not found: " + path);
                return true;
            }
            case "file.versions":
            {
                var path = Need(p, "path");
                var list = await Task.Run(() => FileVersions.List(path));
                return new JsonArray(list.Select(v => (JsonNode)new JsonObject
                {
                    ["id"] = v.Id, ["time"] = new DateTimeOffset(v.Time).ToUnixTimeMilliseconds(), ["size"] = v.Size,
                }).ToArray());
            }
            case "file.versionRead":
            {
                var path = Need(p, "path");
                var id = Need(p, "id");
                int fallback = _app.FallbackCodePage();
                var text = await Task.Run(() => TextFile.Decode(FileVersions.Read(path, id), null, fallback).Text);
                return new JsonObject { ["text"] = text };
            }
            case "enc.list":
                return new JsonArray(TextEncodings.All().Select(e => (JsonNode)new JsonObject { ["id"] = e.Id, ["name"] = e.Name, ["group"] = UiGroup(e.Group), ["codePage"] = e.CodePage }).ToArray());

            // ---------------------------------------------------------------- state
            case "recent.save":
                if (p["list"] is JsonArray recent) JsonStore.SaveNode(AppPaths.Recent, recent.DeepClone());
                return true;
            case "settings.save":
                if (p["settings"] is JsonObject so) _app.SaveSettings(so);
                return true;
            case "settings.export": return ExportSettings(p["settings"] as JsonObject);
            case "settings.import": return ImportSettings();
            case "session.save":
                if (IsPrimary && !_app.SelfTestMode && p["session"] is JsonObject session)
                {
                    var copy = (JsonObject)session.DeepClone();
                    await Task.Run(() => SessionStore.Save(copy));
                }
                return true;
            case "dict.save":
            {
                var words = (p["words"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(w => w.Trim().Length > 0).Select(w => w.Trim()).Distinct().ToList() ?? new List<string>();
                _app.Spell.SetDictionary(words);
                try { JsonStore.WriteAtomic(AppPaths.Dictionary, string.Join("\r\n", words) + (words.Count > 0 ? "\r\n" : "")); }
                catch (Exception ex) { Log.Warn("dictionary.txt: " + ex.Message); }
                return true;
            }

            // ---------------------------------------------------------------- clipboard
            case "clipboard.read":
                return new JsonObject { ["text"] = Retry(() => Clipboard.ContainsText() ? Clipboard.GetText() : "") };
            case "clipboard.write":
            {
                var text = S(p, "text") ?? "";
                Retry(() => { if (text.Length == 0) Clipboard.Clear(); else Clipboard.SetText(text, TextDataFormat.UnicodeText); return true; });
                return true;
            }

            // ---------------------------------------------------------------- spelling
            case "spell.langs": return new JsonObject { ["langs"] = Arr(await _app.Spell.LanguagesAsync()) };
            case "spell.words":
            {
                var lang = S(p, "lang") ?? "en-US";
                var words = (p["words"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0).Take(4000).ToList() ?? new List<string>();
                var (bad, missing) = await _app.Spell.CheckWordsAsync(lang, words);
                var o = new JsonObject();
                foreach (var (w, s) in bad) o[w] = Arr(s);
                return new JsonObject { ["bad"] = o, ["missing"] = missing };
            }

            // ---------------------------------------------------------------- AI
            case "ai.hasKey": return new JsonObject { ["has"] = !string.IsNullOrEmpty(Secrets.Get(S(p, "provider"))) };
            case "ai.setKey":
                Secrets.Set(S(p, "provider"), S(p, "key"));
                Log.Info(string.IsNullOrEmpty(S(p, "key")) ? $"AI key removed ({S(p, "provider")})" : $"AI key saved ({S(p, "provider")})");
                return true;
            case "ai.models":
            {
                var provider = S(p, "provider");
                var baseUrl = S(p, "baseUrl") is { Length: > 0 } u ? u : AiDefaults.BaseUrl(provider);
                var list = await AiClient.ModelsAsync(baseUrl, Secrets.Get(provider), CancellationToken.None);
                return new JsonObject { ["models"] = Arr(list) };
            }
            case "ai.request": return await AiRequestAsync(p);
            case "ai.cancel":
                if (S(p, "id") is { } cid && _aiJobs.TryGetValue(cid, out var job)) job.Cancel();
                return true;

            // ---------------------------------------------------------------- updates
            case "update.check":
            {
                var r = await _app.CheckUpdateAsync(B(p, "beta"));
                return new JsonObject
                {
                    ["current"] = UpdateChecker.CurrentVersion, ["latest"] = r?.Version ?? UpdateChecker.CurrentVersion, ["newer"] = UpdateChecker.IsNewer(r),
                    ["notes"] = r?.Notes ?? "", ["url"] = r?.HtmlUrl ?? UpdateChecker.RepoUrl + "/releases",
                    ["published"] = r == null || r.Published == DateTime.MinValue ? null : r.Published.ToUniversalTime().ToString("o"),
                    ["size"] = r?.ExeSize ?? 0, ["name"] = r?.Name, ["prerelease"] = r?.Prerelease ?? false,
                };
            }
            case "update.download":
            {
                try
                {
                    await _app.DownloadUpdateAsync((got, total) => BeginInvokeSafe(() => Emit("update.progress", new JsonObject
                    {
                        ["pct"] = total > 0 ? Math.Round(got * 100.0 / total, 1) : 0, ["received"] = got, ["total"] = total,
                    })));
                    return new JsonObject { ["ok"] = true };
                }
                catch (Exception ex)
                {
                    Log.Error("Update download failed", ex);
                    return new JsonObject { ["ok"] = false, ["message"] = ex.Message };
                }
            }
            case "update.install": _app.InstallUpdate(); return true;

            // ---------------------------------------------------------------- log
            case "log.write":
            {
                var level = (S(p, "level") ?? "info").ToLowerInvariant() switch { "error" => LogLevel.Error, "warn" or "warning" => LogLevel.Warn, "ok" => LogLevel.Ok, _ => LogLevel.Info };
                var msg = S(p, "msg") ?? "";
                if (msg.Length > 4000) msg = msg[..4000];
                Log.Write(level, "[ui] " + msg);
                return true;
            }
            case "log.read":
            {
                int max = (int)Math.Clamp(N(p, "max", 800), 1, 3000);
                var list = Log.Snapshot();
                return new JsonObject
                {
                    ["lines"] = new JsonArray(list.Skip(Math.Max(0, list.Count - max)).Select(e => (JsonNode)LogNode(e)).ToArray()),
                    ["path"] = Path.Combine(Log.Directory, $"folio-{DateTime.Now:yyyy-MM-dd}.log"),
                };
            }
            case "log.clear": Log.Clear(); return true;
            case "log.openFolder": OpenFolder(Log.Directory); return true;

            // ---------------------------------------------------------------- system
            case "sys.fonts": return new JsonObject { ["fonts"] = Arr(await Task.Run(InstalledFonts)) };
            case "sys.openUrl": OpenExternal(S(p, "url")); return true;
            case "sys.openDataDir": OpenFolder(AppPaths.Roaming); return true;
            case "sys.autostart": return new JsonObject { ["ok"] = _app.SetAutostart(B(p, "on")) };
            case "sys.hotkeys":
            {
                var failed = _app.SetHotkeys(S(p, "quickNote"), S(p, "show"));
                return new JsonObject { ["ok"] = failed.Count == 0, ["failed"] = Arr(failed) };
            }
            case "sys.tray": _app.SetTray(B(p, "icon", true)); return true;
            case "tray.balloon": _app.Balloon(S(p, "title") ?? "Folio", S(p, "text") ?? ""); return true;
            case "qn.open": _app.ShowQuickNote(); return true;
            case "lang.import": return ImportLanguage();
            case "lang.exportTemplate": return ExportLanguageTemplate(p["template"] as JsonObject);

            // ---------------------------------------------------------------- self-test
            case "selftest.writeFile":
            {
                var st = _app.SelfTest ?? throw new BridgeException("selftest", "not in self-test mode");
                var real = st.MapPath(Need(p, "path"));
                var text = (S(p, "text") ?? "").Replace("\r\n", "\n");
                var r = TextFile.Save(real, text, S(p, "encoding") ?? "utf-8", B(p, "bom"), "crlf", keepVersion: false);
                if (!r.Ok) throw new BridgeException(r.Error ?? "io", r.Message ?? "write failed");
                return new JsonObject { ["path"] = real };
            }
            case "selftest.shot":
            {
                var st = _app.SelfTest ?? throw new BridgeException("selftest", "not in self-test mode");
                await st.ShotAsync(this, Need(p, "name"));
                return true;
            }
            case "selftest.done":
            {
                var st = _app.SelfTest ?? throw new BridgeException("selftest", "not in self-test mode");
                st.WebDone(this, p["report"] as JsonObject);
                return true;
            }
        }
        throw new BridgeException("unknown", "Unknown method: " + m);
    }

    // ------------------------------------------------------------------ helpers
    void BeginInvokeSafe(Action a)
    {
        try { if (!IsDisposed && IsHandleCreated) BeginInvoke(a); } catch { }
    }

    public static JsonObject LogNode(LogEntry e) => new()
    {
        ["t"] = e.Time.ToString("yyyy-MM-ddTHH:mm:ss.fffzzz"), ["level"] = Log.LevelName(e.Level).ToLowerInvariant(), ["msg"] = e.Message,
    };

    /// <summary>Cuts an incomplete UTF-8 sequence at the end of a sample so previews do not report a false error.</summary>
    static byte[] TrimPartial(byte[] data)
    {
        int end = data.Length;
        int i = end - 1, back = 0;
        while (i >= 0 && back < 3 && (data[i] & 0xC0) == 0x80) { i--; back++; }
        if (i >= 0 && data[i] >= 0xC0)
        {
            int need = data[i] >= 0xF0 ? 4 : data[i] >= 0xE0 ? 3 : 2;
            if (end - i < need) end = i;
        }
        return end == data.Length ? data : data[..end];
    }

    static string UiGroup(string g) => g switch
    {
        "unicode" => "unicode",
        "cyrillic" or "cyrillicDos" or "cyrillicUnix" or "cyrillicIso" => "cyr",
        "western" or "dos" => "west",
        "central" => "central",
        "chinese" or "chineseTrad" or "japanese" or "korean" => "cjk",
        _ => "other",
    };

    static Color ParseColor(string? s, Color fallback)
    {
        if (string.IsNullOrWhiteSpace(s)) return fallback;
        s = s.Trim();
        try
        {
            if (s.StartsWith('#'))
            {
                var h = s[1..];
                if (h.Length == 3) h = string.Concat(h.Select(c => $"{c}{c}"));
                if (h.Length >= 6) return Color.FromArgb(Convert.ToInt32(h[..2], 16), Convert.ToInt32(h.Substring(2, 2), 16), Convert.ToInt32(h.Substring(4, 2), 16));
            }
            var m = System.Text.RegularExpressions.Regex.Match(s, @"rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)");
            if (m.Success) return Color.FromArgb(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value));
        }
        catch { }
        return fallback;
    }

    static T Retry<T>(Func<T> f)
    {
        for (int i = 0; ; i++)
        {
            try { return f(); }
            catch (ExternalException) when (i < 6) { Thread.Sleep(30 + i * 20); }
        }
    }

    static void OpenFolder(string dir)
    {
        try { Directory.CreateDirectory(dir); Process.Start(new ProcessStartInfo("explorer.exe", $"\"{dir}\"") { UseShellExecute = false }); }
        catch (Exception ex) { Log.Warn("Cannot open folder: " + ex.Message); }
    }

    static List<string> InstalledFonts()
    {
        using var fc = new InstalledFontCollection();
        return fc.Families.Select(f => f.Name).Where(n => !n.StartsWith('@')).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList();
    }

    static string ValidDir(string? dir)
    {
        try { if (!string.IsNullOrWhiteSpace(dir) && Directory.Exists(dir)) return dir; } catch { }
        return Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
    }

    string Filter(params (string key, string fallback, string pattern)[] items) =>
        string.Join("|", items.Select(i => $"{_app.Str(i.key, i.fallback)} ({i.pattern.Replace(";", ", ")})|{i.pattern}"));

    const string Supported = "*.txt;*.md;*.markdown;*.log;*.json;*.js;*.ts;*.py;*.cs;*.html;*.css;*.xml;*.yml;*.yaml;*.ini;*.cfg;*.conf;*.csv;*.sql;*.sh;*.bat;*.cmd;*.ps1;*.srt;*.nfo";

    JsonNode SaveDialog(string? name, string? dir, bool noOverwritePrompt)
    {
        name = string.IsNullOrWhiteSpace(name) ? "note.txt" : name.Trim();
        foreach (var ch in Path.GetInvalidFileNameChars()) name = name.Replace(ch, '_');
        var ext = Path.GetExtension(name).ToLowerInvariant();
        using var d = new SaveFileDialog
        {
            FileName = name,
            InitialDirectory = ValidDir(dir),
            Filter = Filter(("dlg.filterText", "Text documents", "*.txt"), ("dlg.filterMd", "Markdown", "*.md"), ("dlg.filterAll", "All files", "*.*")),
            FilterIndex = ext == ".txt" ? 1 : ext is ".md" or ".markdown" ? 2 : ext.Length == 0 ? 1 : 3,
            DefaultExt = ext.Length == 0 ? "txt" : ext.TrimStart('.'),
            AddExtension = true,
            OverwritePrompt = !noOverwritePrompt,
            CheckPathExists = true,
            RestoreDirectory = true,
        };
        if (d.ShowDialog(this) != DialogResult.OK || string.IsNullOrEmpty(d.FileName)) return new JsonObject { ["cancelled"] = true };
        return new JsonObject { ["path"] = d.FileName };
    }

    JsonNode OpenDialog(string? dir)
    {
        using var d = new OpenFileDialog
        {
            InitialDirectory = ValidDir(dir),
            Filter = Filter(("dlg.filterAll", "All files", "*.*"), ("dlg.filterText", "Text documents", "*.txt"), ("dlg.filterMd", "Markdown", "*.md;*.markdown"), ("dlg.filterSupported", "Text and code", Supported)),
            FilterIndex = 1,
            Multiselect = true,
            CheckFileExists = true,
            RestoreDirectory = true,
        };
        if (d.ShowDialog(this) != DialogResult.OK) return new JsonObject { ["paths"] = new JsonArray(), ["cancelled"] = true };
        return new JsonObject { ["paths"] = Arr(d.FileNames) };
    }

    JsonNode ExportSettings(JsonObject? settings)
    {
        using var d = new SaveFileDialog
        {
            FileName = $"folio-settings-{DateTime.Now:yyyy-MM-dd}.json",
            InitialDirectory = ValidDir(null),
            Filter = Filter(("dlg.filterJson", "Folio settings", "*.json")),
            DefaultExt = "json", AddExtension = true, OverwritePrompt = true,
        };
        if (d.ShowDialog(this) != DialogResult.OK) return new JsonObject { ["cancelled"] = true };
        var copy = (JsonObject)(settings ?? _app.SettingsSnapshot()).DeepClone();
        JsonStore.SaveNode(d.FileName, new JsonObject { ["folio"] = "settings", ["version"] = UpdateChecker.CurrentVersion, ["exported"] = DateTime.Now.ToString("o"), ["settings"] = copy });
        Log.Ok("Settings exported to " + d.FileName);
        return new JsonObject { ["path"] = d.FileName };
    }

    JsonNode ImportSettings()
    {
        using var d = new OpenFileDialog { InitialDirectory = ValidDir(null), Filter = Filter(("dlg.filterJson", "Folio settings", "*.json")), CheckFileExists = true };
        if (d.ShowDialog(this) != DialogResult.OK) return new JsonObject { ["cancelled"] = true };
        JsonNode? n;
        try { n = JsonNode.Parse(File.ReadAllText(d.FileName, Encoding.UTF8)); }
        catch (Exception ex) { throw new BridgeException("format", ex.Message); }
        var s = n?["settings"] as JsonObject ?? n as JsonObject;
        if (s == null || s.ContainsKey("folio") && s["settings"] == null) throw new BridgeException("format", "Not a Folio settings file");
        Log.Ok("Settings imported from " + d.FileName);
        return new JsonObject { ["settings"] = s.DeepClone() };
    }

    JsonNode ImportLanguage()
    {
        using var d = new OpenFileDialog { InitialDirectory = ValidDir(null), Filter = Filter(("dlg.filterJson", "Language file", "*.json")), CheckFileExists = true };
        if (d.ShowDialog(this) != DialogResult.OK) return new JsonObject { ["cancelled"] = true };
        JsonObject? o;
        try { o = JsonNode.Parse(File.ReadAllText(d.FileName, Encoding.UTF8)) as JsonObject; }
        catch (Exception ex) { throw new BridgeException("format", ex.Message); }
        var code = o?["code"]?.GetValue<string>()?.Trim().ToLowerInvariant();
        if (o == null || string.IsNullOrEmpty(code) || !System.Text.RegularExpressions.Regex.IsMatch(code, "^[a-z]{2,3}(-[a-z0-9]{2,8})?$") || o["table"] is not JsonObject table)
            throw new BridgeException("format", "A language file needs \"code\" (like \"de\") and \"table\" with the strings");
        var name = o["name"]?.GetValue<string>() ?? code;
        var dir = Path.Combine(AppPaths.Roaming, "lang");
        Directory.CreateDirectory(dir);
        JsonStore.SaveNode(Path.Combine(dir, code + ".json"), new JsonObject { ["code"] = code, ["name"] = name, ["basedOn"] = o["basedOn"]?.DeepClone(), ["table"] = table.DeepClone() });
        Log.Ok($"Language {code} ({name}) imported: {table.Count} strings");
        return new JsonObject { ["code"] = code, ["name"] = name, ["table"] = table.DeepClone() };
    }

    JsonNode ExportLanguageTemplate(JsonObject? template)
    {
        using var d = new SaveFileDialog
        {
            FileName = "folio-language-template.json", InitialDirectory = ValidDir(null),
            Filter = Filter(("dlg.filterJson", "Language file", "*.json")), DefaultExt = "json", AddExtension = true, OverwritePrompt = true,
        };
        if (d.ShowDialog(this) != DialogResult.OK) return new JsonObject { ["cancelled"] = true };
        JsonStore.SaveNode(d.FileName, (template ?? new JsonObject()).DeepClone());
        return new JsonObject { ["path"] = d.FileName };
    }

    async Task<JsonNode?> AiRequestAsync(JsonObject p)
    {
        var id = S(p, "id") ?? Guid.NewGuid().ToString("N");
        var provider = S(p, "provider") ?? "openai";
        var baseUrl = S(p, "baseUrl") is { Length: > 0 } u ? u : AiDefaults.BaseUrl(provider);
        var key = Secrets.Get(provider);
        if (string.IsNullOrEmpty(key) && AiDefaults.NeedsKey(provider)) throw new AiException("auth", "No API key saved for " + provider);
        var req = new AiRequest
        {
            BaseUrl = baseUrl, ApiKey = key, Model = S(p, "model") ?? "", Stream = B(p, "stream", true),
            Temperature = p["temperature"] is JsonValue ? N(p, "temperature", 0.3) : null,
            MaxTokens = N(p, "maxTokens") is var mt && mt > 0 ? (int)mt : null,
        };
        if (p["messages"] is JsonArray msgs)
            foreach (var mo in msgs.OfType<JsonObject>())
                req.Messages.Add(new AiMessage { Role = S(mo, "role") ?? "user", Content = S(mo, "content") ?? "" });
        var cts = new CancellationTokenSource();
        _aiJobs[id] = cts;
        var sw = Stopwatch.StartNew();
        try
        {
            var text = await AiClient.CompleteAsync(req, delta => BeginInvokeSafe(() => Emit("ai.delta", new JsonObject { ["id"] = id, ["text"] = delta })), cts.Token);
            Log.Info($"AI {req.Model}: {text.Length} chars in {sw.ElapsedMilliseconds} ms");
            return new JsonObject { ["text"] = text, ["model"] = req.Model };
        }
        finally
        {
            _aiJobs.Remove(id);
            cts.Dispose();
        }
    }

    /// <summary>Our own save in some window: this window must not report it as an outside change.</summary>
    public void WatchSaved(string path, long mtime, long size) => _watch.Saved(path, mtime, size);

    public WebView2 Web => _web;

    /// <summary>For the self-test: the page as PNG.</summary>
    public async Task CapturePngAsync(Stream target) =>
        await _web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, target);
}

internal static class AiDefaults
{
    static readonly Dictionary<string, string> Urls = new(StringComparer.OrdinalIgnoreCase)
    {
        ["openai"] = "https://api.openai.com/v1", ["openrouter"] = "https://openrouter.ai/api/v1", ["deepseek"] = "https://api.deepseek.com/v1",
        ["groq"] = "https://api.groq.com/openai/v1", ["mistral"] = "https://api.mistral.ai/v1", ["ollama"] = "http://localhost:11434/v1", ["lmstudio"] = "http://localhost:1234/v1",
    };
    public static string BaseUrl(string? provider) => provider != null && Urls.TryGetValue(provider, out var u) ? u : "";
    public static bool NeedsKey(string? provider) => provider is "openai" or "openrouter" or "deepseek" or "groq" or "mistral";
}
