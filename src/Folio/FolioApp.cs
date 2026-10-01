using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using Folio.Core;
using Folio.Core.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace Folio;

/// <summary>The running app: windows, tray icon, global hotkeys, quick note, second-instance handling, updates.</summary>
internal sealed class FolioApp : ApplicationContext
{
    public StartOptions Options { get; }
    public bool SelfTestMode => Options.SelfTest;
    public string WebViewVersion { get; }
    public SpellService Spell { get; } = new();
    public SelfTest? SelfTest { get; }
    public int ExitCode { get; set; }
    /// <summary>No GPU acceleration and no renderer code-integrity check: for PCs where the window stays white.</summary>
    public bool CompatMode { get; }

    readonly List<MainForm> _windows = new();
    readonly Control _ui = new();
    readonly Stopwatch _started = Stopwatch.StartNew();
    readonly Dictionary<string, string> _strings = new(StringComparer.Ordinal);
    JsonObject _settings;
    NotifyIcon? _tray;
    ContextMenuStrip? _trayMenu;
    Hotkeys? _hotkeys;
    QuickNoteForm? _qn;
    InstancePipe? _pipe;
    Task<CoreWebView2Environment>? _env;
    ReleaseInfo? _release;
    string? _downloaded, _restartArgs;
    bool? _dark;
    List<string> _hotkeyFailed = new();
    bool _quitting, _shutdown, _fatal, _hotkeyWarned, _readyLogged;

    static string StringsFile => Path.Combine(AppPaths.Local, "strings.json");
    static string CompatFlag => Path.Combine(AppPaths.Local, "compat-mode");

    public FolioApp(StartOptions options, string webViewVersion)
    {
        Options = options;
        WebViewVersion = webViewVersion;
        _ui.CreateControl();
        _ = _ui.Handle;
        _settings = JsonStore.LoadNode(AppPaths.Settings) as JsonObject ?? new JsonObject();
        if (options.Compat) WriteCompatFlag(); // --compat is remembered: it is used when the normal start shows nothing
        CompatMode = options.Compat || File.Exists(CompatFlag) || SettingBool("compatMode", false);
        if (CompatMode) Log.Info("Compatibility mode: no GPU acceleration");
        LoadStrings();
        Spell.SetDictionary(DictionaryWords());
        Log.Written += OnLog;

        if (SelfTestMode) SelfTest = new SelfTest(this, options.SelfTestOut);
        else
        {
            _pipe = new InstancePipe();
            _pipe.Start(OnPipe, _ui);
            _hotkeys = new Hotkeys();
            _hotkeyFailed = SetHotkeys(SettingString("hotkeyQuickNote") ?? "Ctrl+Alt+N", SettingString("hotkeyShow") ?? "Win+Alt+F");
            if (SettingBool("trayIcon", true)) SetTray(true);
            if (SettingBool("startWithWindows", false)) SetAutostart(true, quiet: true); // keeps the path right if Folio.exe was moved
        }

        var files = options.AbsoluteFiles();
        bool toTray = (options.Tray || (options.QuickNote && files.Count == 0)) && TrayVisible;
        if (toTray) Log.Info(options.Autostart ? "Started with Windows, waiting in the tray" : "Started in the tray");
        else CreateWindow(true, files, minimized: options.Tray);
        if (options.QuickNote) _ui.BeginInvoke(ShowQuickNote);
        SelfTest?.Start();
    }

    // ------------------------------------------------------------------ windows
    public IReadOnlyList<MainForm> Windows => _windows;
    public MainForm? Primary => _windows.FirstOrDefault(w => w.IsPrimary && !w.IsDisposed);

    MainForm CreateWindow(bool primary, IReadOnlyList<string> files, bool minimized = false)
    {
        var w = new MainForm(this, primary, files, false);
        _windows.Add(w);
        if (minimized) { w.WindowState = FormWindowState.Minimized; w.Show(); }
        else w.ShowAndActivate();
        return w;
    }

    public void NewWindow(IReadOnlyList<string> files) => CreateWindow(Primary == null, files);

    public void ShowMain()
    {
        var w = Primary ?? _windows.FirstOrDefault(x => !x.IsDisposed);
        if (w == null) { CreateWindow(true, Array.Empty<string>()); return; }
        w.ShowAndActivate();
    }

    /// <summary>The "show Folio" hotkey: brings the window up, or hides it when it is already in front.</summary>
    void ToggleMain()
    {
        var w = Primary;
        if (w != null && w.Visible && w.WindowState != FormWindowState.Minimized && Native.GetForegroundWindow() == w.Handle)
        {
            if (TrayVisible) Command("app.tray", show: false); else w.WindowState = FormWindowState.Minimized;
            return;
        }
        ShowMain();
    }

    void Command(string id, bool show = true)
    {
        var w = Primary ?? CreateWindow(true, Array.Empty<string>());
        if (show) w.ShowAndActivate();
        w.Emit("app.command", new JsonObject { ["id"] = id });
    }

    public void OpenInPrimary(IReadOnlyList<string> files)
    {
        var w = Primary;
        if (w == null) { CreateWindow(true, files); return; }
        w.ShowAndActivate();
        if (files.Count > 0) w.Emit("app.open", new JsonObject { ["paths"] = new JsonArray(files.Select(f => (JsonNode)f).ToArray()) });
    }

    void OnPipe(StartOptions o)
    {
        if (_shutdown) return;
        var files = o.Files.ToList();
        Log.Info("Folio.exe started again" + (files.Count > 0 ? ": " + string.Join(", ", files.Select(Path.GetFileName)) : ""));
        if (o.QuickNote) { ShowQuickNote(); if (files.Count == 0) return; }
        if (o.NewWindow) { NewWindow(files); return; }
        if (o.Tray && files.Count == 0) return;
        OpenInPrimary(files);
    }

    public void OnWindowReady(MainForm w)
    {
        if (!_readyLogged)
        {
            _readyLogged = true;
            Log.Ok($"Folio {UpdateChecker.CurrentVersion} is ready in {_started.ElapsedMilliseconds} ms (WebView2 {WebViewVersion})");
        }
    }

    /// <summary>app.exit from a window (after the UI saved what it needed). Exit in the main window quits Folio.</summary>
    public void WindowExit(MainForm w)
    {
        if (w.IsPrimary)
        {
            _quitting = true;
            foreach (var s in _windows.Where(x => x != w && !x.IsDisposed).ToList()) s.RequestQuit();
        }
        w.CloseNow();
    }

    public void WindowClosed(MainForm w)
    {
        _windows.Remove(w);
        if (_windows.Count == 0 && (w.IsPrimary || _quitting || !TrayVisible)) Shutdown();
    }

    public void QuitAll(bool force = false)
    {
        _quitting = true;
        var list = _windows.Where(x => !x.IsDisposed).ToList();
        if (list.Count == 0) { Shutdown(); return; }
        var p = Primary;
        p?.RequestQuit(force);
        foreach (var w in list.Where(x => x != p)) w.RequestQuit(force);
    }

    public void Restart(string? extraArgs = null)
    {
        _restartArgs = "--restarted" + (string.IsNullOrEmpty(extraArgs) ? "" : " " + extraArgs);
        QuitAll();
    }

    void Shutdown()
    {
        if (_shutdown) return;
        _shutdown = true;
        Log.Written -= OnLog;
        try { _hotkeys?.Dispose(); } catch { }
        try { if (_tray != null) { _tray.Visible = false; _tray.Dispose(); } } catch { }
        try { _pipe?.Dispose(); } catch { }
        try { _qn?.Dispose(); } catch { }
        try { Spell.Dispose(); } catch { }
        if (_restartArgs != null && Environment.ProcessPath is { } exe)
        {
            try { Process.Start(new ProcessStartInfo(exe, _restartArgs) { UseShellExecute = false }); }
            catch (Exception ex) { Log.Error("Restart failed", ex); }
        }
        Log.Info($"Folio {UpdateChecker.CurrentVersion} exits");
        Log.Flush();
        ExitThread();
    }

    public void FatalWebView(Exception ex)
    {
        if (_fatal) return;
        _fatal = true;
        if (SelfTestMode) { SelfTest?.Fail("WebView2: " + ex.Message); return; }
        bool ru = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ru";
        var text = ru
            ? $"Не удалось запустить WebView2 — компонент Windows, в котором работает интерфейс Folio.\n\n{ex.Message}\n\nПерезапустите Folio. Если не поможет — переустановите «Microsoft Edge WebView2 Runtime»."
            : $"Could not start WebView2, the Windows component that runs the Folio interface.\n\n{ex.Message}\n\nRestart Folio. If that does not help, reinstall the Microsoft Edge WebView2 Runtime.";
        MessageBox.Show(text, "Folio", MessageBoxButtons.OK, MessageBoxIcon.Error);
        ExitCode = 1;
        var list = _windows.ToList();
        foreach (var w in list) w.CloseNow();
        if (list.Count == 0) Shutdown();
    }

    public Task<CoreWebView2Environment> EnvironmentAsync()
    {
        if (_env != null) return _env;
        var features = "msSmartScreenProtection,msEdgeTranslate" + (CompatMode ? ",RendererCodeIntegrity" : "");
        var args = $"--disable-features={features} --disable-background-timer-throttling" + (CompatMode ? " --disable-gpu --disable-gpu-compositing" : "");
        // a separate profile folder: a WebView2 still running with the other switches must not block the start
        var folder = CompatMode ? AppPaths.WebView + "-compat" : AppPaths.WebView;
        return _env = CoreWebView2Environment.CreateAsync(null, folder, new CoreWebView2EnvironmentOptions { AdditionalBrowserArguments = args });
    }

    /// <summary>The interface did not start: remember the compatibility mode and start Folio again.</summary>
    /// <param name="auto">Folio decided itself (empty window, stopped page process): the UI tells the user after the restart.</param>
    public void RestartCompat(bool auto = false)
    {
        WriteCompatFlag();
        Log.Warn("Restarting in compatibility mode (no GPU acceleration)" + (auto ? ", automatically" : ""));
        Restart(auto ? "--compat=auto" : "--compat"); // also on the command line: a flag file that could not be written must not lead to a restart loop
    }

    static void WriteCompatFlag()
    {
        try { if (!File.Exists(CompatFlag)) { Directory.CreateDirectory(AppPaths.Local); File.WriteAllText(CompatFlag, DateTime.Now.ToString("s")); } }
        catch (Exception ex) { Log.Warn("compat-mode: " + ex.Message); }
    }

    // ------------------------------------------------------------------ init payload for the UI
    public async Task<JsonObject> InitPayload(MainForm w, IReadOnlyList<string> files)
    {
        List<string> langs;
        try { langs = await Spell.LanguagesAsync().WaitAsync(TimeSpan.FromSeconds(4)); }
        catch { langs = new List<string>(); }
        bool firstRun = !File.Exists(AppPaths.Settings);
        JsonNode? session = null;
        if (w.IsPrimary && !Options.Fresh && !SelfTestMode)
        {
            try { session = await Task.Run(SessionStore.Load); }
            catch (Exception ex) { Log.Warn("session.json: " + ex.Message); }
        }
        var recent = JsonStore.LoadNode(AppPaths.Recent) as JsonArray;
        var failed = new JsonArray();
        if (w.IsPrimary && !_hotkeyWarned) { _hotkeyWarned = true; foreach (var k in _hotkeyFailed) failed.Add((JsonNode?)JsonValue.Create(k)); } // not Add<string>: see MainForm.Wire
        return new JsonObject
        {
            ["version"] = UpdateChecker.CurrentVersion,
            ["settings"] = SettingsForUi(firstRun),
            ["recent"] = recent ?? new JsonArray(),
            ["session"] = session,
            ["args"] = new JsonArray(files.Select(f => (JsonNode)f).ToArray()),
            ["locale"] = CultureInfo.CurrentUICulture.Name,
            ["sys"] = new JsonObject
            {
                ["os"] = OsName(), ["build"] = Native.OsBuild, ["win11"] = Native.OsBuild >= 22000, ["portable"] = AppPaths.Portable, ["dblclickMs"] = (int)Native.GetDoubleClickTime(),
                ["dataDir"] = AppPaths.Roaming, ["notesDir"] = AppPaths.DefaultNotesDir, ["webview"] = WebViewVersion,
                ["arch"] = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(), ["primary"] = w.IsPrimary, ["mock"] = false,
                ["nativeDrag"] = w.NativeDrag, ["hotkeyFailed"] = failed, ["selftestAi"] = SelfTest?.AiBaseUrl,
                ["exe"] = Environment.ProcessPath, ["dotnet"] = Environment.Version.ToString(),
            },
            ["spell"] = new JsonObject { ["langs"] = new JsonArray(langs.Select(l => (JsonNode)l).ToArray()) },
            ["flags"] = new JsonObject { ["firstRun"] = firstRun, ["selftest"] = SelfTestMode, ["compatAuto"] = Options.CompatAuto, ["selftestLang"] = Options.SelfTestLang },
            ["langs"] = CustomLanguages(),
            ["hasAiKey"] = !string.IsNullOrEmpty(Secrets.Get(SettingString("ai.provider") ?? "openai")),
        };
    }

    JsonObject? SettingsForUi(bool firstRun)
    {
        var s = firstRun ? null : (JsonObject)_settings.DeepClone();
        if (CompatMode) { s ??= new JsonObject(); s["compatMode"] = true; }
        return s;
    }

    static JsonArray CustomLanguages()
    {
        var arr = new JsonArray();
        var dir = Path.Combine(AppPaths.Roaming, "lang");
        if (!Directory.Exists(dir)) return arr;
        foreach (var f in Directory.GetFiles(dir, "*.json").OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
        {
            if (JsonStore.LoadNode(f) is JsonObject o && o["code"] is JsonValue code && o["table"] is JsonObject table)
                arr.Add(new JsonObject { ["code"] = code.DeepClone(), ["name"] = (o["name"] ?? code).DeepClone(), ["table"] = table.DeepClone() });
        }
        return arr;
    }

    static string OsName()
    {
        try
        {
            using var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            var product = k?.GetValue("ProductName") as string ?? "Windows";
            var display = k?.GetValue("DisplayVersion") as string ?? k?.GetValue("ReleaseId") as string ?? "";
            var ubr = k?.GetValue("UBR") is int u ? "." + u : "";
            if (Native.OsBuild >= 22000) product = product.Replace("Windows 10", "Windows 11");
            return $"{product} {display}".Trim() + $" (build {Native.OsBuild}{ubr})";
        }
        catch { return Environment.OSVersion.VersionString; }
    }

    // ------------------------------------------------------------------ settings
    JsonNode? Setting(string path)
    {
        if (_settings.TryGetPropertyValue(path, out var direct)) return direct;
        JsonNode? cur = _settings;
        foreach (var part in path.Split('.'))
            if (cur is not JsonObject o || !o.TryGetPropertyValue(part, out cur)) return null;
        return cur;
    }

    public string? SettingString(string path) => Setting(path) is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
    public double SettingDouble(string path, double def) => Setting(path) is JsonValue v && v.TryGetValue<double>(out var d) ? d : def;
    public bool SettingBool(string path, bool def) => Setting(path) is JsonValue v && v.TryGetValue<bool>(out var b) ? b : def;
    public JsonObject SettingsSnapshot() => _settings;

    public void SaveSettings(JsonObject s)
    {
        _settings = (JsonObject)s.DeepClone();
        if (s["compatMode"] is JsonValue cv && cv.TryGetValue<bool>(out var compat))
        {
            if (compat) WriteCompatFlag();
            else
            {
                try { if (File.Exists(CompatFlag)) { File.Delete(CompatFlag); Log.Info("Compatibility mode is off from the next start"); } }
                catch (Exception ex) { Log.Warn("compat-mode: " + ex.Message); }
            }
        }
        try { JsonStore.SaveNode(AppPaths.Settings, _settings); }
        catch (Exception ex) { Log.Warn("settings.json: " + ex.Message); }
    }

    IEnumerable<string> DictionaryWords()
    {
        if (Setting("dictionary") is JsonArray a)
            return a.Select(x => x is JsonValue v && v.TryGetValue<string>(out var s) ? s : "").Where(s => s.Length > 0).ToList();
        try { if (File.Exists(AppPaths.Dictionary)) return File.ReadAllLines(AppPaths.Dictionary).Select(l => l.Trim()).Where(l => l.Length > 0).ToList(); }
        catch { }
        return Array.Empty<string>();
    }

    /// <summary>Code page for files that are neither Unicode nor recognisable: the "language for non-Unicode programs" of Windows.</summary>
    public int FallbackCodePage()
    {
        var s = SettingString("fallbackEncoding");
        if (!string.IsNullOrEmpty(s) && s != "auto")
        {
            try { var cp = TextEncodings.CodePage(s); if (cp > 0 && cp != 65001) return cp; } catch { }
        }
        int acp = 0;
        try { acp = (int)Native.GetACP(); } catch { }
        if (acp is 0 or 65001) acp = CultureInfo.CurrentCulture.TextInfo.ANSICodePage;
        return acp is 0 or 65001 ? 1252 : acp;
    }

    public void NotifySaved(string path, long mtime, long size)
    {
        foreach (var w in _windows) w.WatchSaved(path, mtime, size);
    }

    // ------------------------------------------------------------------ theme
    static bool RegFlag(string name, bool def)
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return k?.GetValue(name) is int v ? v != 0 : def;
        }
        catch { return def; }
    }

    string ResolvedTheme()
    {
        var th = SettingString("theme") ?? "paper";
        if (th == "system") th = RegFlag("AppsUseLightTheme", true) ? SettingString("themeLight") ?? "paper" : SettingString("themeDark") ?? "graphite";
        return th;
    }

    public bool DarkTheme => _dark ?? ResolvedTheme() == "graphite";

    public string InitialTheme() => ResolvedTheme() is var t && t is "paper" or "graphite" or "sepia" or "glass" ? t : "paper";

    public Color InitialBackground() => ResolvedTheme() switch
    {
        "graphite" => Color.FromArgb(0x1C, 0x1D, 0x21),
        "sepia" => Color.FromArgb(0xEE, 0xE4, 0xCE),
        "glass" => Color.FromArgb(0xC9, 0xCF, 0xFF),
        _ => Color.FromArgb(0xF6, 0xF5, 0xF1),
    };

    public void ThemeChanged(MainForm w, bool dark, Color bg)
    {
        if (w.IsPrimary || Primary == null) _dark = dark;
    }

    public void SystemThemeChanged()
    {
        if (_tray == null) return;
        var old = _tray.Icon;
        _tray.Icon = TrayIcon();
        old?.Dispose();
    }

    // ------------------------------------------------------------------ strings for native UI
    public string Str(string key, string fallback) => _strings.TryGetValue(key, out var s) && !string.IsNullOrEmpty(s) ? s : fallback;

    void LoadStrings()
    {
        try
        {
            if (JsonStore.LoadNode(StringsFile)?["strings"] is JsonObject o)
                foreach (var (k, v) in o)
                    if (v is JsonValue jv && jv.TryGetValue<string>(out var s)) _strings[k] = s;
        }
        catch { }
        if (_strings.Count > 0) return;
        var lang = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
        if (!NativeStrings.Tables.TryGetValue(lang, out var table)) table = NativeStrings.Tables["en"];
        foreach (var (k, v) in table) _strings[k] = v;
    }

    public void SetStrings(string lang, JsonObject strings)
    {
        bool changed = false;
        foreach (var (k, v) in strings)
            if (v is JsonValue jv && jv.TryGetValue<string>(out var s) && (!_strings.TryGetValue(k, out var old) || old != s)) { _strings[k] = s; changed = true; }
        if (!changed) return;
        try { JsonStore.SaveNode(StringsFile, new JsonObject { ["lang"] = lang, ["strings"] = strings.DeepClone() }); } catch { }
        UpdateTrayMenu();
        if (_qn is { IsDisposed: false, Visible: true }) _qn.ApplyStrings();
    }

    // ------------------------------------------------------------------ tray
    public bool TrayVisible => _tray is { Visible: true };

    static Icon TrayIcon()
    {
        // light taskbar → the dark document; dark taskbar → the light one
        using var s = WebAssets.Resource(RegFlag("SystemUsesLightTheme", false) ? "folio.ico" : "folio-light.ico") ?? WebAssets.Resource("folio.ico")!;
        return new Icon(s, SystemInformation.SmallIconSize);
    }

    public void SetTray(bool on)
    {
        if (SelfTestMode) return;
        if (!on)
        {
            if (_tray != null) { _tray.Visible = false; _tray.Dispose(); _tray = null; }
            return;
        }
        if (_tray != null) return;
        _trayMenu = new ContextMenuStrip { ShowImageMargin = false };
        _tray = new NotifyIcon { Icon = TrayIcon(), Text = "Folio", ContextMenuStrip = _trayMenu };
        _tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) ShowMain(); };
        UpdateTrayMenu();
        _tray.Visible = true;
    }

    void UpdateTrayMenu()
    {
        if (_trayMenu == null || _tray == null) return;
        _trayMenu.Items.Clear();
        var show = new ToolStripMenuItem(Str("tray.show", "Show Folio"), null, (s, e) => ShowMain());
        show.Font = new Font(show.Font, FontStyle.Bold);
        _trayMenu.Items.Add(show);
        _trayMenu.Items.Add(new ToolStripMenuItem(Str("tray.quickNote", "Quick note"), null, (s, e) => ShowQuickNote()) { ShortcutKeyDisplayString = SettingString("hotkeyQuickNote") ?? "Ctrl+Alt+N" });
        _trayMenu.Items.Add(new ToolStripMenuItem(Str("tray.newNote", "New note"), null, (s, e) => Command("file.new")));
        _trayMenu.Items.Add(new ToolStripMenuItem(Str("tray.newWindow", "New window"), null, (s, e) => NewWindow(Array.Empty<string>())));
        _trayMenu.Items.Add(new ToolStripSeparator());
        _trayMenu.Items.Add(new ToolStripMenuItem(Str("tray.settings", "Settings"), null, (s, e) => Command("app.settings")));
        _trayMenu.Items.Add(new ToolStripSeparator());
        _trayMenu.Items.Add(new ToolStripMenuItem(Str("tray.quit", "Quit"), null, (s, e) => QuitAll()));
        var tip = Str("tray.tip", "Folio");
        _tray.Text = tip.Length > 63 ? tip[..63] : tip;
    }

    public void Balloon(string title, string text)
    {
        try { _tray?.ShowBalloonTip(6000, title, text, ToolTipIcon.None); } catch { }
    }

    // ------------------------------------------------------------------ hotkeys, quick note, autostart
    public List<string> SetHotkeys(string? quickNote, string? show)
    {
        if (_hotkeys == null) return new List<string>();
        var list = new List<(string, Action)>();
        if (!string.IsNullOrWhiteSpace(quickNote)) list.Add((quickNote, ShowQuickNote));
        if (!string.IsNullOrWhiteSpace(show)) list.Add((show, ToggleMain));
        _hotkeyFailed = _hotkeys.Register(list);
        UpdateTrayMenu();
        return _hotkeyFailed;
    }

    public void ShowQuickNote()
    {
        if (_qn == null || _qn.IsDisposed) _qn = new QuickNoteForm(this);
        _qn.ShowNote();
    }

    public bool SetAutostart(bool on, bool quiet = false)
    {
        if (SelfTestMode) return true;
        try
        {
            using var k = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
            var value = $"\"{Environment.ProcessPath}\" --tray --autostart";
            if (on) { if (k.GetValue("Folio") as string != value) k.SetValue("Folio", value); }
            else if (k.GetValue("Folio") != null) k.DeleteValue("Folio", false);
            if (!quiet) Log.Info(on ? "Folio will start with Windows" : "Folio will not start with Windows");
            return true;
        }
        catch (Exception ex) { Log.Warn("Autostart: " + ex.Message); return false; }
    }

    // ------------------------------------------------------------------ updates
    public async Task<ReleaseInfo?> CheckUpdateAsync(bool beta)
    {
        if (SelfTestMode) return null;
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(25));
        _release = await UpdateChecker.LatestAsync(beta, cts.Token);
        Log.Info(_release == null ? "Update check: no releases yet" : $"Update check: latest {_release.Version}, this is {UpdateChecker.CurrentVersion}");
        return _release;
    }

    public async Task DownloadUpdateAsync(Action<long, long> progress)
    {
        var r = _release ?? await UpdateChecker.LatestAsync(SettingBool("updates.beta", false), CancellationToken.None);
        if (r == null || !UpdateChecker.IsNewer(r)) throw new InvalidOperationException("There is no newer version");
        _release = r;
        using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(20));
        _downloaded = await UpdateChecker.DownloadAsync(r, progress, cts.Token);
        Log.Ok($"Folio {r.Version} downloaded and verified (SHA-256)");
    }

    /// <summary>Swaps Folio.exe for the downloaded build (a running exe can be renamed, not overwritten) and restarts.</summary>
    public void InstallUpdate()
    {
        if (_downloaded == null || !File.Exists(_downloaded)) { Log.Warn("No downloaded update to install"); return; }
        var exe = Environment.ProcessPath!;
        var old = Path.Combine(Path.GetDirectoryName(exe)!, "Folio.old.exe");
        try
        {
            if (File.Exists(old)) File.Delete(old);
            File.Move(exe, old);
            try { File.Copy(_downloaded, exe, true); }
            catch { File.Move(old, exe); throw; }
            Log.Ok($"Update {_release?.Version} installed, restarting");
            _restartArgs = "--updated";
            QuitAll();
        }
        catch (Exception ex)
        {
            Log.Error("Cannot replace Folio.exe", ex);
            bool ru = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ru";
            MessageBox.Show(ru
                ? $"Не получилось заменить Folio.exe ({ex.Message}).\n\nНовая версия скачана сюда:\n{_downloaded}\n\nЗакройте Folio и замените файл вручную."
                : $"Could not replace Folio.exe ({ex.Message}).\n\nThe new version was downloaded to:\n{_downloaded}\n\nClose Folio and replace the file manually.", "Folio", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            try { Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{_downloaded}\"") { UseShellExecute = false }); } catch { }
        }
    }

    // ------------------------------------------------------------------ log → log panels
    void OnLog(LogEntry e)
    {
        if (_shutdown || _ui.IsDisposed || !_ui.IsHandleCreated) return;
        try
        {
            _ui.BeginInvoke(() =>
            {
                if (_shutdown) return;
                foreach (var w in _windows)
                    if (w.WebReady && !w.IsDisposed) w.Emit("log.entry", Folio.MainForm.LogNode(e));
            });
        }
        catch { }
    }
}
