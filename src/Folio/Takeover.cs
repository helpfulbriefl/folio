using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using Folio.Core;

namespace Folio;

/// <summary>
/// A newer Folio.exe replaces an older one that is still running (usually in the tray). Without this, the new exe
/// handed its command line to the old process and quit, so after downloading an update the user kept seeing the old
/// version. The old process is asked to quit the way Windows asks at log-off (WM_QUERYENDSESSION, which every Folio
/// version handles): it saves the session with the unsaved text and exits, and the new one opens the same tabs.
/// </summary>
internal static class Takeover
{
    public enum Result { NotNeeded, Replaced, Failed }

    public static Result TryReplaceOlder(string ourVersion, out string? runningVersion)
    {
        runningVersion = null;
        Process? p = null;
        try
        {
            var pid = InstancePipe.ServerProcessId();
            if (pid <= 0 || pid == Environment.ProcessId) return Result.NotNeeded;
            p = Process.GetProcessById(pid);
            string? path = null;
            try { path = p.MainModule?.FileName; } catch (Exception ex) { Log.Warn("The running Folio: " + ex.Message); }
            var theirs = path != null ? Parse(FileVersionInfo.GetVersionInfo(path).ProductVersion) : null;
            var ours = Parse(ourVersion);
            if (theirs == null || ours == null || theirs >= ours) return Result.NotNeeded;
            runningVersion = theirs.ToString();
            Log.Info($"Folio {theirs} is running ({path}); Folio {ours} replaces it");

            var sw = Stopwatch.StartNew();
            int asked = 0;
            foreach (var h in Native.TopLevelWindows(pid))
            {
                if (Native.TitleOf(h).Length == 0) continue; // the main windows have titles; helper windows do not
                Native.SendMessageTimeout(h, Native.WM_QUERYENDSESSION, IntPtr.Zero, (IntPtr)Native.ENDSESSION_CLOSEAPP, Native.SMTO_ABORTIFHUNG, 3000, out _);
                asked++;
            }
            if (asked > 0 && p.WaitForExit(15000)) Log.Info($"Folio {theirs} saved the session and quit in {sw.ElapsedMilliseconds} ms");
            else
            {
                // no window (waiting in the tray since Windows started): nothing unsaved; or it hangs
                Log.Info(asked > 0 ? $"Folio {theirs} did not quit in 15 s; stopping it" : $"Folio {theirs} has no window open; stopping it");
                p.Kill(entireProcessTree: true);
                p.WaitForExit(5000);
            }
            return Result.Replaced;
        }
        catch (Exception ex)
        {
            Log.Warn("Could not replace the running Folio: " + ex.Message);
            return runningVersion != null ? Result.Failed : Result.NotNeeded;
        }
        finally { p?.Dispose(); }
    }

    /// <summary>"1.0.1+5688268…" → 1.0.1 (three parts, so 1.1.0.0 equals 1.1.0).</summary>
    public static Version? Parse(string? s)
    {
        var m = Regex.Match(s ?? "", @"^\s*v?(\d+)\.(\d+)(?:\.(\d+))?");
        if (!m.Success) return null;
        return new Version(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), m.Groups[3].Success ? int.Parse(m.Groups[3].Value) : 0);
    }

    /// <summary>The old version could not be stopped (for example, it runs as administrator).</summary>
    public static void TellUser(string running, string ours)
    {
        bool ru = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ru";
        var text = ru
            ? $"Уже запущена Folio {running} (значок в трее), и закрыть её не получилось.\n\nЧтобы открыть новую версию {ours}, закройте старую: правый щелчок по значку Folio в трее → «Выход», и запустите Folio.exe ещё раз."
            : $"Folio {running} is already running (tray icon) and could not be closed.\n\nTo open the new version {ours}, quit the old one: right-click the Folio icon in the tray → Exit, then start Folio.exe again.";
        MessageBox.Show(text, "Folio", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
}
