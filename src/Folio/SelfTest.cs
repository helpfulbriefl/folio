using System.Drawing.Imaging;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Folio.Core;

namespace Folio;

/// <summary>Folio.exe --selftest[=dir]: runs the scripted UI tour (web/src/selftest.js) in a throw-away profile,
/// then checks the native window behaviour (drag, double click, resize) and writes screenshots + report.json.</summary>
internal sealed class SelfTest
{
    readonly FolioApp _app;
    readonly object _gate = new();
    readonly JsonArray _checks = new();
    readonly JsonObject _info = new();
    readonly List<string> _shots = new();
    JsonObject? _web;
    FakeAiServer? _ai;
    System.Threading.Timer? _watchdog, _exitTimer;
    bool _done;

    public string OutDir { get; }
    public string FilesRoot { get; }
    public string? AiBaseUrl { get; private set; }

    public SelfTest(FolioApp app, string? outDir)
    {
        _app = app;
        OutDir = Path.GetFullPath(string.IsNullOrWhiteSpace(outDir) ? Path.Combine(AppContext.BaseDirectory, "selftest-out") : outDir);
        Directory.CreateDirectory(OutDir);
        foreach (var f in Directory.GetFiles(OutDir, "*.png")) { try { File.Delete(f); } catch { } }
        FilesRoot = Path.Combine(Path.GetDirectoryName(AppPaths.Roaming)!, "Files");
        Directory.CreateDirectory(FilesRoot);
    }

    public void Start()
    {
        try { _ai = new FakeAiServer(); AiBaseUrl = _ai.Start(); Log.Info("Self-test: fake AI endpoint " + AiBaseUrl); }
        catch (Exception ex) { Log.Warn("Self-test: fake AI server failed: " + ex.Message); }
        _watchdog = new System.Threading.Timer(_ => Fail("timeout: the self-test did not finish in 6 minutes"), null, TimeSpan.FromMinutes(6), Timeout.InfiniteTimeSpan);
        Log.Info("Self-test: output → " + OutDir);
    }

    /// <summary>The samples use C:\Users\Demo\… paths; they are written into the temporary profile instead.</summary>
    public string MapPath(string p)
    {
        const string demo = @"C:\Users\Demo\";
        var rel = p.StartsWith(demo, StringComparison.OrdinalIgnoreCase) ? p[demo.Length..] : Path.GetFileName(p);
        var full = Path.GetFullPath(Path.Combine(FilesRoot, rel));
        if (!full.StartsWith(FilesRoot, StringComparison.OrdinalIgnoreCase)) throw new BridgeException("args", "bad path");
        return full;
    }

    static string Safe(string name) => string.Concat(name.Select(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' ? c : '_'));

    public async Task ShotAsync(MainForm w, string name)
    {
        var file = Path.Combine(OutDir, Safe(name) + ".png");
        using var ms = new MemoryStream();
        await w.CapturePngAsync(ms);
        await File.WriteAllBytesAsync(file, ms.ToArray());
        lock (_gate) _shots.Add(Safe(name));
    }

    void ScreenShot(string name)
    {
        try
        {
            var r = SystemInformation.VirtualScreen;
            using var bmp = new Bitmap(r.Width, r.Height);
            using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(r.Location, Point.Empty, r.Size);
            bmp.Save(Path.Combine(OutDir, Safe(name) + ".png"), ImageFormat.Png);
            lock (_gate) _shots.Add(Safe(name));
        }
        catch (Exception ex) { Check("host.screenshot." + name, false, ex.Message); }
    }

    void Check(string name, bool ok, string detail = "")
    {
        lock (_gate) _checks.Add(new JsonObject { ["name"] = name, ["ok"] = ok, ["detail"] = detail });
        Log.Write(ok ? LogLevel.Ok : LogLevel.Error, $"self-test {(ok ? "PASS" : "FAIL")} {name} {detail}");
    }

    /// <summary>selftest.done from the UI: now the native part.</summary>
    public void WebDone(MainForm w, JsonObject? report)
    {
        lock (_gate) _web = report?.DeepClone() as JsonObject ?? new JsonObject { ["ok"] = false, ["error"] = "no report" };
        Log.Info("Self-test: UI part done: " + (_web["summary"]?.ToString() ?? "?"));
        w.BeginInvoke(new Action(async () =>
        {
            try { await HostChecksAsync(w); }
            catch (Exception ex) { Check("host.exception", false, ex.ToString()); }
            Finish();
        }));
    }

    // ------------------------------------------------------------------ native window checks
    async Task HostChecksAsync(MainForm w)
    {
        _info["nativeDrag"] = w.NativeDrag;
        _info["dpi"] = w.DeviceDpi;
        _info["screen"] = Screen.PrimaryScreen?.Bounds.ToString();
        _info["build"] = Native.OsBuild;
        _info["aiRequests"] = _ai?.Requests ?? 0;

        if (w.WindowState != FormWindowState.Normal) w.WindowState = FormWindowState.Normal;
        var scr = Screen.FromControl(w).WorkingArea;
        int ww = Math.Min(900, scr.Width - 100), hh = Math.Min(600, scr.Height - 120);
        w.Bounds = new Rectangle(scr.Left + 40, scr.Top + 40, ww, hh);
        w.ShowAndActivate();
        await Task.Delay(1500);
        ScreenShot("19-window-frame");

        // 1) dragging by an empty part of the title bar moves the window
        var p = await TitlebarPointAsync(w);
        Check("host.titlebarPoint", p != null, p?.ToString() ?? "no empty title bar area");
        if (p is { } pt)
        {
            var before = w.Location;
            await DragAsync(pt, 140, 70);
            await Task.Delay(500);
            int dx = w.Location.X - before.X, dy = w.Location.Y - before.Y;
            Check("host.drag", Math.Abs(dx - 140) <= 20 && Math.Abs(dy - 70) <= 20, $"moved by {dx},{dy}; native regions: {w.NativeDrag}");

            // 2) double click maximizes, the second one restores
            var p2 = await TitlebarPointAsync(w) ?? pt;
            await DoubleClickAsync(p2);
            await Task.Delay(1000);
            bool max = w.WindowState == FormWindowState.Maximized;
            Check("host.dblclickMaximize", max, w.WindowState.ToString());
            ScreenShot("20-maximized");
            if (max)
            {
                var p3 = await TitlebarPointAsync(w);
                if (p3 is { } q) { await DoubleClickAsync(q); await Task.Delay(1000); }
                Check("host.dblclickRestore", w.WindowState == FormWindowState.Normal, w.WindowState.ToString());
            }
            if (w.WindowState != FormWindowState.Normal) { w.WindowState = FormWindowState.Normal; await Task.Delay(600); }
        }

        // 3) native right border resizes
        var b = w.Bounds;
        await DragAsync(new Point(b.Right - 3, b.Top + b.Height / 2), 100, 0);
        await Task.Delay(500);
        Check("host.resizeRight", w.Width - b.Width >= 60, $"width {b.Width} → {w.Width}");

        // 4) the top edge (a strip in the page → WM_NCLBUTTONDOWN HTTOP)
        b = w.Bounds;
        var top = await ElementPointAsync(w, ".resize-top[data-edge=top]");
        if (top is { } tp)
        {
            await DragAsync(tp, 0, -30);
            await Task.Delay(500);
            Check("host.resizeTop", w.Height - b.Height >= 15, $"height {b.Height} → {w.Height}");
        }
        else Check("host.resizeTop", false, "no .resize-top strip");

        await Task.Delay(400);
        ScreenShot("21-after-window-checks");

        // 5) the native frame with the dark and the glass theme
        await Js(w, "__folio.settings.set('theme', 'graphite')");
        await Task.Delay(1200);
        ScreenShot("22-graphite-frame");
        await Js(w, "__folio.settings.set('theme', 'glass')");
        await Task.Delay(1200);
        ScreenShot("23-glass-frame");
        await Js(w, "__folio.settings.set('theme', 'paper')");
        await Task.Delay(600);
    }

    static async Task Js(MainForm w, string js)
    {
        try { await w.Web.CoreWebView2.ExecuteScriptAsync("try { " + js + " } catch (e) { console.error(e) }"); }
        catch (Exception ex) { Log.Warn("self-test script: " + ex.Message); }
    }

    static async Task<Point?> ScriptPointAsync(MainForm w, string js)
    {
        var res = await w.Web.CoreWebView2.ExecuteScriptAsync(js);
        if (string.IsNullOrEmpty(res) || res == "null") return null;
        var n = JsonNode.Parse(res);
        if (n == null) return null;
        double x = n["x"]!.GetValue<double>(), y = n["y"]!.GetValue<double>(), dpr = n["dpr"]!.GetValue<double>();
        return w.Web.PointToScreen(new Point((int)Math.Round(x * dpr), (int)Math.Round(y * dpr)));
    }

    static Task<Point?> TitlebarPointAsync(MainForm w) => ScriptPointAsync(w, @"(() => {
  const tb = document.querySelector('.titlebar'); if (!tb) return null;
  const r = tb.getBoundingClientRect();
  const right = document.querySelector('.titlebar .tb-right')?.getBoundingClientRect().left ?? (r.right - 220);
  const y = r.top + r.height / 2;
  for (let x = right - 14; x > r.left + 8; x -= 6) {
    const el = document.elementFromPoint(x, y);
    if (!el || !tb.contains(el) || el.closest('.tab, .tab-add, .tb-right, button')) continue;
    return { x, y, dpr: devicePixelRatio };
  }
  return null;
})()");

    static Task<Point?> ElementPointAsync(MainForm w, string selector) => ScriptPointAsync(w, $@"(() => {{
  const el = document.querySelector({JsonSerializer.Serialize(selector)}); if (!el) return null;
  const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;
  return {{ x: r.left + r.width / 2, y: r.top + Math.min(2, r.height / 2), dpr: devicePixelRatio }};
}})()");

    const uint MOUSEEVENTF_MOVE = 0x0001, MOUSEEVENTF_ABSOLUTE = 0x8000;

    static void Send(uint flags, int x = 0, int y = 0)
    {
        var i = new Native.INPUT { type = Native.INPUT_MOUSE, mi = new Native.MOUSEINPUT { dwFlags = flags } };
        if ((flags & MOUSEEVENTF_ABSOLUTE) != 0)
        {
            int sw = Math.Max(2, Native.GetSystemMetrics(0)), sh = Math.Max(2, Native.GetSystemMetrics(1));
            i.mi.dx = (int)Math.Round(x * 65535.0 / (sw - 1));
            i.mi.dy = (int)Math.Round(y * 65535.0 / (sh - 1));
        }
        Native.SendInput(1, new[] { i }, Marshal.SizeOf<Native.INPUT>());
    }

    static void MoveTo(int x, int y) { Native.SetCursorPos(x, y); Send(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, x, y); }

    static async Task DragAsync(Point from, int dx, int dy)
    {
        MoveTo(from.X, from.Y);
        await Task.Delay(150);
        Send(Native.MOUSEEVENTF_LEFTDOWN);
        await Task.Delay(150);
        for (int i = 1; i <= 15; i++)
        {
            MoveTo(from.X + dx * i / 15, from.Y + dy * i / 15);
            await Task.Delay(30);
        }
        await Task.Delay(150);
        Send(Native.MOUSEEVENTF_LEFTUP);
        await Task.Delay(250);
    }

    static async Task DoubleClickAsync(Point p)
    {
        MoveTo(p.X, p.Y);
        await Task.Delay(200);
        Send(Native.MOUSEEVENTF_LEFTDOWN); await Task.Delay(30); Send(Native.MOUSEEVENTF_LEFTUP);
        await Task.Delay(90);
        Send(Native.MOUSEEVENTF_LEFTDOWN); await Task.Delay(30); Send(Native.MOUSEEVENTF_LEFTUP);
    }

    // ------------------------------------------------------------------ report
    void WriteReport(bool ok, string? error)
    {
        JsonObject report;
        lock (_gate)
        {
            report = new JsonObject
            {
                ["ok"] = ok, ["error"] = error, ["version"] = UpdateChecker.CurrentVersion, ["os"] = Environment.OSVersion.VersionString,
                ["webview"] = _app.WebViewVersion, ["finished"] = DateTime.Now.ToString("o"),
                ["host"] = new JsonObject { ["checks"] = _checks.DeepClone(), ["info"] = _info.DeepClone() },
                ["shots"] = new JsonArray(_shots.Select(s => (JsonNode)s).ToArray()),
                ["web"] = _web?.DeepClone(),
                ["log"] = new JsonArray(Log.Snapshot().TakeLast(500).Select(e => (JsonNode)$"{e.Time:HH:mm:ss.fff} {Log.LevelName(e.Level),-5} {e.Message}").ToArray()),
            };
        }
        var opts = new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
        File.WriteAllText(Path.Combine(OutDir, "report.json"), report.ToJsonString(opts), new UTF8Encoding(false));

        var sb = new StringBuilder();
        sb.AppendLine($"Folio {UpdateChecker.CurrentVersion} self-test: {(ok ? "OK" : "FAILED")}{(error != null ? " — " + error : "")}");
        sb.AppendLine($"OS {Environment.OSVersion.Version}, WebView2 {_app.WebViewVersion}");
        sb.AppendLine("UI: " + (_web?["summary"]?.ToString() ?? "no report"));
        if (_web?["checks"] is JsonArray wc)
            foreach (var c in wc.OfType<JsonObject>().Where(c => c["ok"]?.GetValue<bool>() != true))
                sb.AppendLine($"  FAIL {c["name"]}: {c["detail"]}");
        if (_web?["steps"] is JsonArray ws)
            foreach (var s in ws.OfType<JsonObject>().Where(s => s["ok"]?.GetValue<bool>() != true))
                sb.AppendLine($"  STEP {s["name"]}: {s["error"]}");
        if (_web?["errors"] is JsonArray we)
            foreach (var e in we.Take(20)) sb.AppendLine($"  ERROR {e}");
        sb.AppendLine("Window:");
        lock (_gate)
            foreach (var c in _checks.OfType<JsonObject>())
                sb.AppendLine($"  {(c["ok"]?.GetValue<bool>() == true ? "PASS" : "FAIL")} {c["name"]}: {c["detail"]}");
        File.WriteAllText(Path.Combine(OutDir, "summary.txt"), sb.ToString(), new UTF8Encoding(false));
        try
        {
            Log.Flush();
            foreach (var f in Directory.GetFiles(Log.Directory, "folio-*.log"))
                File.Copy(f, Path.Combine(OutDir, Path.GetFileName(f)), true);
        }
        catch { }
    }

    void Finish()
    {
        bool ok;
        lock (_gate)
        {
            if (_done) return;
            _done = true;
            bool webOk = _web?["ok"] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
            bool hostOk = _checks.All(c => c?["ok"]?.GetValue<bool>() == true);
            ok = webOk && hostOk;
        }
        _watchdog?.Dispose();
        Log.Write(ok ? LogLevel.Ok : LogLevel.Error, "Self-test finished: " + (ok ? "OK" : "FAILED"));
        try { WriteReport(ok, null); } catch (Exception ex) { Log.Error("report.json", ex); }
        _app.ExitCode = ok ? 0 : 2;
        _ai?.Dispose();
        _exitTimer = new System.Threading.Timer(_ => { Log.Flush(); Environment.Exit(_app.ExitCode); }, null, 20000, Timeout.Infinite);
        _app.QuitAll(force: true);
    }

    /// <summary>Called from any thread when the test cannot go on (WebView2 failed, watchdog).</summary>
    public void Fail(string message)
    {
        lock (_gate) { if (_done) return; _done = true; }
        Log.Error("Self-test failed: " + message);
        try { WriteReport(false, message); } catch { }
        Log.Flush();
        Environment.Exit(3);
    }
}

/// <summary>A tiny OpenAI-compatible server on 127.0.0.1 for the self-test ("fix" applies the demo corrections).</summary>
internal sealed class FakeAiServer : IDisposable
{
    static readonly (string From, string To)[] Fixes =
    {
        ("Впринципе", "В принципе"), ("вдохновения ,", "вдохновения,"), ("тишина,  полчаса", "тишина, полчаса"), ("по утрам пока", "по утрам, пока"),
        ("recieve", "receive"), ("feedbak", "feedback"), ("teh", "the"),
    };

    readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    readonly CancellationTokenSource _cts = new();
    int _requests;
    public int Requests => _requests;

    public string Start()
    {
        _listener.Start();
        _ = Task.Run(AcceptLoop);
        return $"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}/v1";
    }

    async Task AcceptLoop()
    {
        while (!_cts.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await _listener.AcceptTcpClientAsync(_cts.Token); }
            catch { break; }
            _ = Task.Run(() => HandleAsync(client));
        }
    }

    async Task HandleAsync(TcpClient client)
    {
        using var _ = client;
        try
        {
            var stream = client.GetStream();
            var head = new List<byte>(1024);
            var one = new byte[1];
            while (head.Count < 65536)
            {
                if (await stream.ReadAsync(one) <= 0) return;
                head.Add(one[0]);
                int n = head.Count;
                if (n >= 4 && head[n - 4] == '\r' && head[n - 3] == '\n' && head[n - 2] == '\r' && head[n - 1] == '\n') break;
            }
            var lines = Encoding.ASCII.GetString(head.ToArray()).Split("\r\n");
            var first = lines[0].Split(' ');
            string method = first[0], path = first.Length > 1 ? first[1] : "/";
            int length = 0;
            foreach (var l in lines.Skip(1))
                if (l.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) int.TryParse(l[15..].Trim(), out length);
            var body = new byte[length];
            int read = 0;
            while (read < length) { int k = await stream.ReadAsync(body.AsMemory(read, length - read)); if (k <= 0) break; read += k; }
            Interlocked.Increment(ref _requests);
            if (method == "GET" && path.EndsWith("/models", StringComparison.Ordinal))
                await Json(stream, "{\"object\":\"list\",\"data\":[{\"id\":\"folio-selftest\",\"object\":\"model\"}]}");
            else if (method == "POST" && path.EndsWith("/chat/completions", StringComparison.Ordinal))
                await ChatAsync(stream, Encoding.UTF8.GetString(body));
            else
                await Raw(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }
        catch (Exception ex) { Log.Warn("self-test AI server: " + ex.Message); }
    }

    static async Task ChatAsync(NetworkStream s, string json)
    {
        var req = JsonNode.Parse(json);
        var msgs = (req?["messages"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        string sys = msgs.FirstOrDefault(m => m["role"]?.ToString() == "system")?["content"]?.ToString() ?? "";
        string user = msgs.LastOrDefault(m => m["role"]?.ToString() == "user")?["content"]?.ToString() ?? "";
        var task = Regex.Match(sys, @"Task: (\w+)").Groups[1].Value;
        var m = Regex.Match(user, @"<text>\n?([\s\S]*?)\n?</text>");
        var src = m.Success ? m.Groups[1].Value : "";
        string answer = task switch
        {
            "fix" => Fixes.Aggregate(src, (acc, f) => acc.Replace(f.From, f.To)),
            "chat" or "" => "Folio self-test: the AI connection works.",
            _ => src,
        };
        bool stream = req?["stream"] is JsonValue sv && sv.TryGetValue<bool>(out var st) && st;
        if (!stream)
        {
            await Json(s, new JsonObject { ["choices"] = new JsonArray(new JsonObject { ["message"] = new JsonObject { ["role"] = "assistant", ["content"] = answer } }) }.ToJsonString());
            return;
        }
        await Raw(s, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n");
        for (int i = 0; i < answer.Length;)
        {
            int len = Math.Min(24, answer.Length - i);
            if (i + len < answer.Length && char.IsHighSurrogate(answer[i + len - 1])) len++;
            var chunk = new JsonObject { ["choices"] = new JsonArray(new JsonObject { ["delta"] = new JsonObject { ["content"] = answer.Substring(i, len) } }) };
            i += len;
            await Raw(s, "data: " + chunk.ToJsonString() + "\n\n");
            await Task.Delay(8);
        }
        await Raw(s, "data: [DONE]\n\n");
    }

    static Task Json(NetworkStream s, string json)
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        return Raw(s, $"HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {bytes.Length}\r\nConnection: close\r\n\r\n", bytes);
    }

    static async Task Raw(NetworkStream s, string text, byte[]? tail = null)
    {
        var b = Encoding.UTF8.GetBytes(text);
        await s.WriteAsync(b);
        if (tail != null) await s.WriteAsync(tail);
        await s.FlushAsync();
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { _listener.Stop(); } catch { }
    }
}
