using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using Folio.Core;
using Microsoft.Web.WebView2.Core;

namespace Folio;

internal static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize(); // DPI awareness, visual styles (see Folio.csproj)
        var o = StartOptions.Parse(args);
        if (o.SelfTest)
        {
            // a throw-away profile: settings, session, WebView2 data and the sample files
            var root = Path.Combine(Path.GetTempPath(), "folio-selftest-" + Environment.ProcessId);
            Environment.SetEnvironmentVariable("FOLIO_DATA", root);
        }
        try { AppPaths.Init(); }
        catch (Exception ex)
        {
            MessageBox.Show("Folio cannot create its data folder:\n" + ex.Message, "Folio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        Log.Init(AppPaths.Logs);
        var version = Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "1.0.0";
        UpdateChecker.CurrentVersion = version.Split('+')[0];
        Log.Info($"Folio {UpdateChecker.CurrentVersion} starting · {RuntimeInformation.OSDescription} · {RuntimeInformation.ProcessArchitecture} · .NET {Environment.Version}" +
                 (args.Length > 0 ? " · args: " + string.Join(' ', args) : "") + (AppPaths.Portable ? " · portable" : ""));
        CleanupAfterUpdate();

        Mutex? mutex = null;
        bool owned = false;
        if (!o.SelfTest)
        {
            mutex = new Mutex(false, InstancePipe.MutexName);
            try { owned = mutex.WaitOne(o.Restarted ? TimeSpan.FromSeconds(15) : TimeSpan.Zero); }
            catch (AbandonedMutexException) { owned = true; }
            if (!owned && !o.Restarted)
            {
                // Folio is already running. If it is an older version (an update was downloaded while the old one
                // waits in the tray), the new one replaces it; otherwise the old one would get the command line.
                var r = Takeover.TryReplaceOlder(o.AsVersion ?? UpdateChecker.CurrentVersion, out var running);
                if (r == Takeover.Result.Replaced)
                {
                    try { owned = mutex.WaitOne(TimeSpan.FromSeconds(10)); } catch (AbandonedMutexException) { owned = true; }
                }
                else if (r == Takeover.Result.Failed) Takeover.TellUser(running!, UpdateChecker.CurrentVersion);
            }
            if (!owned)
            {
                // Folio is already running: hand over the command line and quit
                if (InstancePipe.Send(o)) { Log.Flush(); return 0; }
                try { owned = mutex.WaitOne(TimeSpan.FromSeconds(3)); } catch (AbandonedMutexException) { owned = true; }
                if (!owned && InstancePipe.Send(o)) { Log.Flush(); return 0; }
                if (!owned) Log.Warn("The running Folio does not answer; starting another one");
            }
        }

        string? webview = null;
        try { webview = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch (WebView2RuntimeNotFoundException) { }
        catch (Exception ex) { Log.Warn("WebView2 check: " + ex.Message); }
        if (!string.IsNullOrEmpty(webview)) Log.Info("WebView2 Runtime " + webview);
        if (string.IsNullOrEmpty(webview))
        {
            Log.Error("WebView2 Runtime is not installed");
            if (!o.SelfTest) NoWebView();
            ReleaseMutex(mutex, owned);
            return 4;
        }

        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (s, e) => Log.Error("UI thread exception", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (s, e) => { Log.Error("Unhandled exception", e.ExceptionObject as Exception); Log.Flush(); };
        TaskScheduler.UnobservedTaskException += (s, e) => { Log.Warn("Unobserved task exception: " + e.Exception.GetBaseException().Message); e.SetObserved(); };

        int code;
        try
        {
            var app = new FolioApp(o, webview);
            Application.Run(app);
            code = app.ExitCode;
        }
        catch (Exception ex)
        {
            Log.Error("Fatal error", ex);
            Log.Flush();
            if (!o.SelfTest) MessageBox.Show("Folio stopped because of an error:\n\n" + ex.Message + "\n\nDetails are in the log: " + Log.Directory, "Folio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            code = 1;
        }
        ReleaseMutex(mutex, owned);
        Log.Flush();
        return code;
    }

    static void ReleaseMutex(Mutex? m, bool owned)
    {
        if (m == null) return;
        try { if (owned) m.ReleaseMutex(); } catch { }
        m.Dispose();
    }

    /// <summary>After an update the previous exe stays as Folio.old.exe until the next start.</summary>
    static void CleanupAfterUpdate()
    {
        try
        {
            var dir = Path.GetDirectoryName(Environment.ProcessPath);
            if (dir == null) return;
            var old = Path.Combine(dir, "Folio.old.exe");
            for (int i = 0; i < 10 && File.Exists(old); i++)
            {
                try { File.Delete(old); Log.Info("Removed Folio.old.exe after the update"); }
                catch { Thread.Sleep(300); }
            }
            foreach (var f in Directory.GetFiles(AppPaths.Updates, "*.part")) { try { File.Delete(f); } catch { } }
        }
        catch { }
    }

    static void NoWebView()
    {
        bool ru = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ru";
        var text = ru
            ? "Для работы Folio нужен компонент Microsoft Edge WebView2 Runtime (в Windows 11 он уже есть, в Windows 10 обычно тоже).\n\nОткрыть страницу загрузки? Установите «Evergreen Bootstrapper» и запустите Folio снова."
            : "Folio needs the Microsoft Edge WebView2 Runtime (it comes with Windows 11 and most Windows 10 installations).\n\nOpen the download page? Install the \"Evergreen Bootstrapper\" and start Folio again.";
        if (MessageBox.Show(text, "Folio", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
        {
            try { Process.Start(new ProcessStartInfo("https://go.microsoft.com/fwlink/p/?LinkId=2124703") { UseShellExecute = true }); } catch { }
        }
    }
}
