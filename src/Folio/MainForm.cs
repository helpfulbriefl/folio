using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Folio.Core;
using Folio.Core.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Folio;

/// <summary>A Folio window: custom-drawn frame (the title bar is part of the web UI) + WebView2 with the app.</summary>
internal sealed partial class MainForm : Form
{
    readonly FolioApp _app;
    readonly WebView2 _web;
    readonly List<string> _files;
    readonly List<string> _queued = new();
    readonly FileWatch _watch;
    public bool IsPrimary { get; }
    public bool WebReady { get; private set; }
    bool _inited, _allowClose, _exitRequested, _fullscreen, _startHidden;
    Rectangle _preFullBounds;
    FormWindowState _preFullState;
    long _lastDragTick, _lastMaxToggle;
    Point _lastDragPos;
    public bool NativeDrag => false; // WebView2 app-region support is not used (see OnCoreReady)

    public MainForm(FolioApp app, bool primary, IEnumerable<string> files, bool startHidden)
    {
        _app = app;
        IsPrimary = primary;
        _files = files.ToList();
        _startHidden = startHidden;
        Text = "Folio";
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96, 96);
        FormBorderStyle = FormBorderStyle.Sizable;
        StartPosition = FormStartPosition.Manual;
        KeyPreview = false;
        try { using var s = WebAssets.Resource("folio.ico"); if (s != null) Icon = new Icon(s); } catch { }
        var bg = _app.InitialBackground();
        BackColor = bg;
        MinimumSize = new Size(620, 420);
        RestoreBounds0();

        _web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = bg, AllowExternalDrop = true };
        Controls.Add(_web);
        _watch = new FileWatch(this,
            (p, m, s) => Emit("file.changed", new JsonObject { ["path"] = p, ["mtime"] = m, ["size"] = s }),
            p => Emit("file.deleted", new JsonObject { ["path"] = p }));
        Activated += (s, e) => { SendState(); try { _web.Focus(); } catch { } };
        Deactivate += (s, e) => SendState();
        Resize += (s, e) => SendState();
    }

    // ------------------------------------------------------------------ window placement
    void RestoreBounds0()
    {
        var scr = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 800);
        var w = Math.Min(1280, scr.Width - 80); var h = Math.Min(840, scr.Height - 60);
        var r = new Rectangle(scr.Left + (scr.Width - w) / 2, scr.Top + (scr.Height - h) / 2, w, h);
        bool max = false;
        if (_app.SelfTestMode) { r = new Rectangle(0, 0, 1440, 900); }
        else if (IsPrimary)
        {
            try
            {
                if (JsonStore.LoadNode(AppPaths.Window) is JsonObject j)
                {
                    var saved = new Rectangle(j["x"]!.GetValue<int>(), j["y"]!.GetValue<int>(), j["w"]!.GetValue<int>(), j["h"]!.GetValue<int>());
                    max = j["max"]?.GetValue<bool>() ?? false;
                    if (saved.Width >= 400 && saved.Height >= 300 && Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(new Rectangle(saved.X + 40, saved.Y + 10, Math.Max(1, saved.Width - 80), 40)))) r = saved;
                }
            }
            catch { }
        }
        else if (_app.Primary is { } p && !p.IsDisposed)
        {
            var b = p.WindowState == FormWindowState.Normal ? p.Bounds : p.RestoreBounds;
            r = new Rectangle(b.X + 36, b.Y + 36, b.Width, b.Height);
            if (!Screen.AllScreens.Any(s => s.WorkingArea.Contains(new Point(r.X + 60, r.Y + 20)))) r.Offset(-72, -72);
        }
        Bounds = r;
        if (max) WindowState = FormWindowState.Maximized;
    }

    public void SaveBounds()
    {
        if (!IsPrimary || _app.SelfTestMode) return;
        try
        {
            var b = _fullscreen ? _preFullBounds : WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            var max = _fullscreen ? _preFullState == FormWindowState.Maximized : WindowState == FormWindowState.Maximized;
            JsonStore.SaveNode(AppPaths.Window, new JsonObject { ["x"] = b.X, ["y"] = b.Y, ["w"] = b.Width, ["h"] = b.Height, ["max"] = max });
        }
        catch (Exception ex) { Log.Warn("window.json: " + ex.Message); }
    }

    // ------------------------------------------------------------------ frame
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Native.SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE | Native.SWP_FRAMECHANGED);
        ApplyDark(_app.DarkTheme);
        if (!_inited) { _inited = true; BeginInvoke(async () => await InitWebAsync()); }
    }

    int FrameY()
    {
        uint dpi = 96;
        try { dpi = Native.GetDpiForWindow(Handle); } catch { }
        try { return Native.GetSystemMetricsForDpi(Native.SM_CYFRAME, dpi) + Native.GetSystemMetricsForDpi(Native.SM_CXPADDEDBORDER, dpi); }
        catch { return Native.GetSystemMetrics(Native.SM_CYFRAME) + Native.GetSystemMetrics(Native.SM_CXPADDEDBORDER); }
    }

    protected override void WndProc(ref Message m)
    {
        switch (m.Msg)
        {
            case Native.WM_NCCALCSIZE when m.WParam != IntPtr.Zero && FormBorderStyle != FormBorderStyle.None:
            {
                // keep the standard left/right/bottom borders (resizing, snapping, shadow), drop the caption
                var before = Marshal.PtrToStructure<Native.NCCALCSIZE_PARAMS>(m.LParam);
                int top = before.rgrc0.Top;
                base.WndProc(ref m);
                var after = Marshal.PtrToStructure<Native.NCCALCSIZE_PARAMS>(m.LParam);
                after.rgrc0.Top = top + (WindowState == FormWindowState.Maximized ? FrameY() : 0);
                Marshal.StructureToPtr(after, m.LParam, false);
                m.Result = IntPtr.Zero;
                return;
            }
            case Native.WM_GETMINMAXINFO when _app.SelfTestMode:
            {
                base.WndProc(ref m);
                var mmi = Marshal.PtrToStructure<Native.MINMAXINFO>(m.LParam);
                mmi.ptMaxTrackSize.X = Math.Max(mmi.ptMaxTrackSize.X, 3000);
                mmi.ptMaxTrackSize.Y = Math.Max(mmi.ptMaxTrackSize.Y, 2000);
                Marshal.StructureToPtr(mmi, m.LParam, false);
                return;
            }
            case Native.WM_SYSCOMMAND:
            {
                int cmd = m.WParam.ToInt32() & 0xFFF0;
                // Alt / F10 alone: the web UI opens its own menu bar, Windows must not enter menu mode
                if (cmd == Native.SC_KEYMENU && m.LParam == IntPtr.Zero) return;
                break;
            }
            case Native.WM_QUERYENDSESSION:
                if (WebReady) Emit("app.endSession");
                m.Result = (IntPtr)1;
                return;
            case Native.WM_ENDSESSION:
                if (m.WParam != IntPtr.Zero)
                {
                    WaitForExit(TimeSpan.FromSeconds(3));
                    SaveBounds();
                    Log.Info("Windows is shutting down");
                    Log.Flush();
                }
                break;
            case Native.WM_SETTINGCHANGE:
                if (Marshal.PtrToStringUni(m.LParam) == "ImmersiveColorSet") _app.SystemThemeChanged();
                break;
        }
        base.WndProc(ref m);
    }

    void WaitForExit(TimeSpan max)
    {
        var until = DateTime.UtcNow + max;
        while (!_exitRequested && DateTime.UtcNow < until) { Application.DoEvents(); Thread.Sleep(15); }
    }

    public void ApplyDark(bool dark)
    {
        if (!IsHandleCreated) return;
        Native.SetDwm(Handle, Native.OsBuild >= 18985 ? Native.DWMWA_USE_IMMERSIVE_DARK_MODE : Native.DWMWA_USE_IMMERSIVE_DARK_MODE_OLD, dark ? 1 : 0);
    }

    void SendState()
    {
        if (!WebReady) return;
        Emit("win.state", new JsonObject
        {
            ["maximized"] = WindowState == FormWindowState.Maximized && !_fullscreen,
            ["minimized"] = WindowState == FormWindowState.Minimized,
            ["fullscreen"] = _fullscreen,
            ["topmost"] = TopMost,
            ["active"] = ActiveForm == this,
        });
    }

    public void ToggleMaximize()
    {
        var now = Environment.TickCount64;
        if (now - _lastMaxToggle < 450) return; // double-click reported twice (native + web)
        _lastMaxToggle = now;
        if (_fullscreen) SetFullscreen(false);
        WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
    }

    void StartDrag()
    {
        if (_fullscreen || !Native.LeftButtonDown()) return;
        Native.GetCursorPos(out var p);
        var now = Environment.TickCount64;
        int dx = Native.GetSystemMetrics(Native.SM_CXDOUBLECLK), dy = Native.GetSystemMetrics(Native.SM_CYDOUBLECLK);
        if (now - _lastDragTick <= Native.GetDoubleClickTime() && Math.Abs(p.X - _lastDragPos.X) <= dx && Math.Abs(p.Y - _lastDragPos.Y) <= dy)
        {
            _lastDragTick = 0;
            ToggleMaximize();
            return;
        }
        _lastDragTick = now;
        _lastDragPos = new Point(p.X, p.Y);
        Native.ReleaseCapture();
        Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, (IntPtr)Native.HTCAPTION, (IntPtr)((p.Y << 16) | (p.X & 0xFFFF)));
    }

    void StartResize(string? edge)
    {
        if (_fullscreen || WindowState != FormWindowState.Normal || !Native.LeftButtonDown()) return;
        int ht = edge switch { "topleft" => Native.HTTOPLEFT, "topright" => Native.HTTOPRIGHT, _ => Native.HTTOP };
        Native.ReleaseCapture();
        Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, (IntPtr)ht, IntPtr.Zero);
    }

    void ShowSystemMenu()
    {
        Native.GetCursorPos(out var p);
        var menu = Native.GetSystemMenu(Handle, false);
        if (menu == IntPtr.Zero) return;
        bool max = WindowState == FormWindowState.Maximized;
        Native.EnableMenuItem(menu, Native.SC_RESTORE, max ? Native.MF_ENABLED : Native.MF_GRAYED);
        Native.EnableMenuItem(menu, Native.SC_MOVE, max ? Native.MF_GRAYED : Native.MF_ENABLED);
        Native.EnableMenuItem(menu, Native.SC_SIZE, max ? Native.MF_GRAYED : Native.MF_ENABLED);
        Native.EnableMenuItem(menu, Native.SC_MAXIMIZE, max ? Native.MF_GRAYED : Native.MF_ENABLED);
        Native.EnableMenuItem(menu, Native.SC_MINIMIZE, Native.MF_ENABLED);
        int cmd = Native.TrackPopupMenuEx(menu, Native.TPM_RETURNCMD | Native.TPM_RIGHTBUTTON, p.X, p.Y, Handle, IntPtr.Zero);
        if (cmd != 0) Native.PostMessage(Handle, Native.WM_SYSCOMMAND, (IntPtr)cmd, IntPtr.Zero);
    }

    void SetFullscreen(bool on)
    {
        if (on == _fullscreen) return;
        if (on)
        {
            _preFullState = WindowState;
            _preFullBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            var scr = Screen.FromHandle(Handle).Bounds;
            _fullscreen = true;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            Bounds = scr;
        }
        else
        {
            _fullscreen = false;
            FormBorderStyle = FormBorderStyle.Sizable;
            Bounds = _preFullBounds;
            if (_preFullState == FormWindowState.Maximized) WindowState = FormWindowState.Maximized;
        }
        SendState();
    }

    public void ShowAndActivate()
    {
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) Native.ShowWindow(Handle, Native.SW_RESTORE);
        // Windows only lets the foreground app activate windows; borrow the foreground thread's input state for a moment
        var fg = Native.GetForegroundWindow();
        uint fgThread = fg == IntPtr.Zero ? 0 : Native.GetWindowThreadProcessId(fg, out _);
        uint me = Native.GetCurrentThreadId();
        bool attached = fgThread != 0 && fgThread != me && Native.AttachThreadInput(me, fgThread, true);
        try { Native.BringWindowToTop(Handle); Native.SetForegroundWindow(Handle); Activate(); }
        finally { if (attached) Native.AttachThreadInput(me, fgThread, false); }
        if (WebReady) Emit("app.visible", new JsonObject { ["visible"] = true });
    }

    public void HideToTray()
    {
        Hide();
        if (WebReady) Emit("app.visible", new JsonObject { ["visible"] = false });
    }

    // ------------------------------------------------------------------ closing
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_allowClose && WebReady && e.CloseReason is CloseReason.UserClosing or CloseReason.None)
        {
            e.Cancel = true;
            Emit("app.closeRequest");
            return;
        }
        if (!_allowClose && WebReady && e.CloseReason == CloseReason.WindowsShutDown) WaitForExit(TimeSpan.FromSeconds(2));
        SaveBounds();
        base.OnFormClosing(e);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _watch.Dispose();
        foreach (var c in _aiJobs.Values) { try { c.Cancel(); } catch { } }
        base.OnFormClosed(e);
        _app.WindowClosed(this);
    }

    /// <summary>Closes the window for real (after the web UI saved everything).</summary>
    public void CloseNow()
    {
        _exitRequested = true;
        _allowClose = true;
        if (!IsDisposed) BeginInvoke(Close);
    }

    /// <summary>Asks the UI to quit (tray "Quit", update, restart). The UI saves the session and calls app.exit.</summary>
    public void RequestQuit(bool force = false)
    {
        if (!WebReady) { CloseNow(); return; }
        Emit("app.quitRequest", new JsonObject { ["force"] = force });
    }

    // ------------------------------------------------------------------ WebView2
    async Task InitWebAsync()
    {
        try
        {
            var env = await _app.EnvironmentAsync();
            await _web.EnsureCoreWebView2Async(env);
            var core = _web.CoreWebView2;
            var s = core.Settings;
            s.AreDefaultContextMenusEnabled = true;
            s.AreDevToolsEnabled = _app.Options.DevTools || _app.SelfTestMode;
            s.AreBrowserAcceleratorKeysEnabled = false;
            s.IsZoomControlEnabled = false;
            s.IsStatusBarEnabled = false;
            s.IsBuiltInErrorPageEnabled = true;
            s.IsWebMessageEnabled = true;
            s.AreHostObjectsAllowed = false;
            s.IsScriptEnabled = true;
            s.AreDefaultScriptDialogsEnabled = true;
            try { s.IsPinchZoomEnabled = false; } catch { }
            try { s.IsSwipeNavigationEnabled = false; } catch { }
            try { s.IsGeneralAutofillEnabled = false; s.IsPasswordAutosaveEnabled = false; } catch { }
            // the page starts window drags itself (win.drag → WM_NCLBUTTONDOWN); WebView2 app-region support stays off
            try { s.IsNonClientRegionSupportEnabled = false; } catch { }
            core.AddWebResourceRequestedFilter(WebAssets.Origin + "/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += OnResource;
            core.WebMessageReceived += OnWebMessage;
            core.NavigationStarting += OnNavigationStarting;
            core.NewWindowRequested += (o, e) => { e.Handled = true; OpenExternal(e.Uri); };
            core.ContextMenuRequested += OnContextMenu;
            core.DownloadStarting += (o, e) => { e.Cancel = true; };
            core.PermissionRequested += (o, e) => { e.State = CoreWebView2PermissionState.Deny; };
            core.ProcessFailed += OnProcessFailed;
            core.DocumentTitleChanged += (o, e) => { };
            _web.ZoomFactor = Math.Clamp(_app.SettingDouble("uiScale", 1), 0.75, 2);
            core.Navigate(WebAssets.StartUrl);
        }
        catch (Exception ex)
        {
            Log.Error("WebView2 failed to start", ex);
            _app.FatalWebView(ex);
        }
    }

    void OnResource(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var env = _web.CoreWebView2.Environment;
        if (WebAssets.TryGet(e.Request.Uri, out var data, out var mime))
        {
            // the first paint already uses the right theme (no white flash for the dark one)
            if (mime.StartsWith("text/html", StringComparison.Ordinal))
                data = System.Text.Encoding.UTF8.GetBytes(System.Text.Encoding.UTF8.GetString(data).Replace("data-theme=\"paper\"", $"data-theme=\"{_app.InitialTheme()}\""));
            e.Response = env.CreateWebResourceResponse(new MemoryStream(data, false), 200, "OK", $"Content-Type: {mime}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
        }
        else
            e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
    }

    void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        var uri = e.Uri ?? "";
        if (uri.StartsWith(WebAssets.Origin + "/", StringComparison.OrdinalIgnoreCase)) return;
        e.Cancel = true;
        if (uri.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
        {
            // a file dropped somewhere the UI did not catch
            try { var p = new Uri(uri).LocalPath; if (File.Exists(p)) Emit("app.open", new JsonObject { ["paths"] = new JsonArray(p) }); } catch { }
            return;
        }
        OpenExternal(uri);
    }

    static readonly HashSet<string> EditMenuItems = new(StringComparer.OrdinalIgnoreCase) { "undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll", "emoji" };

    void OnContextMenu(object? sender, CoreWebView2ContextMenuRequestedEventArgs e)
    {
        // only editing commands in text fields / copy for selected text; no "Back", "Print", "Inspect"…
        var items = e.MenuItems;
        for (int i = items.Count - 1; i >= 0; i--)
        {
            var it = items[i];
            bool keep = it.Kind != CoreWebView2ContextMenuItemKind.Separator && EditMenuItems.Contains(it.Name) && (e.ContextMenuTarget.IsEditable || it.Name == "copy");
            if (!keep && it.Kind != CoreWebView2ContextMenuItemKind.Separator) items.RemoveAt(i);
        }
        // drop leading / trailing / double separators
        for (int i = items.Count - 1; i >= 0; i--)
        {
            bool sep = items[i].Kind == CoreWebView2ContextMenuItemKind.Separator;
            if (sep && (i == 0 || i == items.Count - 1 || items[i - 1].Kind == CoreWebView2ContextMenuItemKind.Separator)) items.RemoveAt(i);
        }
        if (items.Count == 0) e.Handled = true;
    }

    int _crashes;
    void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        Log.Error($"WebView2 process failed: {e.ProcessFailedKind} ({e.Reason})");
        if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.BrowserProcessExited) { _app.FatalWebView(new Exception("WebView2 browser process exited")); return; }
        if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive && ++_crashes <= 3)
        {
            WebReady = false;
            _pendingEvents.Clear();
            try { _web.CoreWebView2.Reload(); } catch { }
        }
    }

    public static void OpenExternal(string? uri)
    {
        if (string.IsNullOrWhiteSpace(uri)) return;
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var u) || (u.Scheme != "https" && u.Scheme != "http" && u.Scheme != "mailto")) return;
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); }
        catch (Exception ex) { Log.Warn("Cannot open " + uri + ": " + ex.Message); }
    }

    // ------------------------------------------------------------------ messages
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!(e.Source ?? "").StartsWith(WebAssets.Origin + "/", StringComparison.OrdinalIgnoreCase)) return;
        string json;
        try { json = e.TryGetWebMessageAsString(); } catch { return; }
        List<string>? dropped = null;
        if (json.Contains("\"drop.files\"", StringComparison.Ordinal))
        {
            try
            {
                dropped = new List<string>();
                var objs = e.AdditionalObjects;
                if (objs != null) foreach (var o in objs) if (o is CoreWebView2File f && !string.IsNullOrEmpty(f.Path)) dropped.Add(f.Path);
            }
            catch (Exception ex) { Log.Warn("drop: " + ex.Message); }
        }
        // leave the WebView2 event first (dialogs must not run inside it)
        BeginInvoke(async () => await HandleAsync(json, dropped));
    }

    async Task HandleAsync(string json, List<string>? dropped)
    {
        JsonObject? msg;
        try { msg = JsonNode.Parse(json) as JsonObject; } catch { return; }
        if (msg == null) return;
        var m = msg["m"]?.GetValue<string>() ?? "";
        var id = msg["id"]?.DeepClone();
        var p = msg["p"] as JsonObject ?? new JsonObject();
        if (m == "drop.files")
        {
            if (dropped is { Count: > 0 }) Emit("app.open", new JsonObject { ["paths"] = new JsonArray(dropped.Select(x => (JsonNode)x).ToArray()) });
            return;
        }
        JsonObject reply;
        try
        {
            var r = await Dispatch(m, p);
            reply = new JsonObject { ["id"] = id, ["ok"] = true, ["r"] = r };
        }
        catch (Exception ex)
        {
            var (code, message) = ErrorOf(ex);
            if (code != "cancelled" && code != "notFound") Log.Warn($"{m}: {message}");
            reply = new JsonObject { ["id"] = id, ["ok"] = false, ["err"] = new JsonObject { ["code"] = code, ["message"] = message } };
        }
        if (id != null) Post(reply);
    }

    static (string code, string message) ErrorOf(Exception ex) => ex switch
    {
        FolioFileException f => (f.Code, f.Message),
        AiException a => (a.Code, a.Message),
        OperationCanceledException => ("cancelled", "cancelled"),
        HttpRequestException h => ("network", h.Message),
        UnauthorizedAccessException u => ("access", u.Message),
        FileNotFoundException n => ("notFound", n.Message),
        IOException io => ("io", io.Message),
        BridgeException b => (b.Code, b.Message),
        _ => ("error", ex.Message),
    };

    static readonly JsonSerializerOptions Wire = new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    void Post(JsonObject o)
    {
        if (IsDisposed) return;
        try { _web.CoreWebView2?.PostWebMessageAsString(o.ToJsonString(Wire)); }
        catch { /* window is closing; never log here (log entries are posted too) */ }
    }

    /// <summary>Host → UI event. Events sent before the UI finished starting (app.ready) wait in a queue.</summary>
    public void Emit(string ev, JsonNode? data = null)
    {
        var o = new JsonObject { ["ev"] = ev, ["d"] = data };
        if (!WebReady) { if (_pendingEvents.Count < 200) _pendingEvents.Add(o); return; }
        Post(o);
    }

    readonly List<JsonObject> _pendingEvents = new();

    void FlushEvents()
    {
        foreach (var o in _pendingEvents) Post(o);
        _pendingEvents.Clear();
    }

    public static JsonNode? ToNode<T>(T value) => JsonSerializer.SerializeToNode(value, Json);
}

internal sealed class BridgeException : Exception
{
    public string Code { get; }
    public BridgeException(string code, string message) : base(message) => Code = code;
}
